import {
  BrowserWindow,
  WebContentsView,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  Notification,
  screen,
  session,
  shell,
} from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  IPC,
  DETACH_TOOLBAR_HEIGHT,
  type DetachHostState,
  type InputPayload,
  type InputPayloadVersion,
  type PluginCommandType,
  type PluginModeState,
  type PluginPermission,
} from "@boxkit/shared";
import { getPluginSecurityMode } from "@boxkit/shared/manifest";
import { logger } from "../core/logger.js";
import type { LoadedPlugin } from "./manager.js";
import type { PluginManager } from "./manager.js";
import { getMainWindow, showMainWindow } from "../windows/mainWindow.js";
import { getDetachedWindow, reattachPluginWindow, updateDetachedSubInput } from "../windows/pluginDetachWindow.js";
import { getMachineId } from "../services/machine-id.js";

const HEADER_HEIGHT = 64;
const PLUGIN_WIN = { width: 880, height: 640 };
const SEARCH_WIN = { width: 720, height: 560 };

function safePluginRelative(root: string, value: string): string {
  const clean = String(value ?? "").replace(/\\/g, "/");
  if (!clean || clean.startsWith("/") || /^[a-zA-Z]:\//.test(clean) || clean.split("/").includes("..")) {
    throw new Error("插件路径必须是根目录内的相对路径");
  }
  const full = path.resolve(root, clean);
  const base = path.resolve(root);
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error("插件路径越界");
  return full;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

interface EnterPayload {
  code: string;
  type: PluginCommandType;
  payload: string | InputPayload;
  input?: { version: InputPayloadVersion; payload: InputPayload };
}

/**
 * 插件宿主：把插件渲染为主窗口内的 WebContentsView（沙箱）。
 * - 每插件独立 session partition（存储/缓存隔离）
 * - bk-plugin://<name>/<file> 自定义协议从插件目录读文件（防目录穿越）
 * - 所有 bk.* API 经 IPC 白名单 + manifest 权限双重校验
 */
export class PluginHost {
  private views = new Map<string, WebContentsView>();
  private protocolsReady = new Set<string>();
  /** 当前主搜索窗中打开的插件名；独立窗口插件不占用此状态。 */
  private currentName: string | null = null;
  private detachedNames = new Set<string>();
  private subinput: { placeholder: string } | null = null;
  private currentInput: InputPayload | null = null;
  private pendingEnter = new Map<string, EnterPayload>();
  private prePluginSize: { width: number; height: number } | null = null;
  private pendingScreenShot: Buffer | null = null;
  private pendingScreenShotOwner: string | null = null;
  private screenCaptureOwners = new Map<number, string>();
  private childOwners = new Map<number, string>();
  private childWindows = new Map<number, BrowserWindow>();
  private stateListeners = new Set<(s: PluginModeState) => void>();

  constructor(
    private readonly manager: PluginManager,
    private readonly toast: (msg: string) => void,
    private readonly preloadPath: string,
  ) {}

  // ————— 状态推送 —————

  onStateChange(l: (s: PluginModeState) => void): () => void {
    this.stateListeners.add(l);
    return () => this.stateListeners.delete(l);
  }

  private pushState(): void {
    const plugin = this.currentName ? this.manager.get(this.currentName) : null;
    const state: PluginModeState = this.currentName
      ? {
          mode: "plugin",
          plugin: plugin
            ? {
                name: plugin.manifest.name,
                displayName: plugin.manifest.displayName,
                logo: plugin.logoDataUrl,
                featureExplain: undefined,
              }
            : undefined,
          subinput: this.subinput,
        }
      : { mode: "search", subinput: null };
    for (const l of this.stateListeners) l(state);
  }

  isPluginOpen(): boolean {
    return this.currentName !== null;
  }

  // ————— 打开 / 退出 —————

  openPlugin(plugin: LoadedPlugin, enter: EnterPayload): void {
    if (!plugin.enabled) {
      this.toast(`插件「${plugin.manifest.displayName}」已被禁用`);
      return;
    }
    const win = getMainWindow();
    if (!win) return;

    // 同插件重复进入：直接补发 enter 事件
    if (this.currentName === plugin.manifest.name) {
      const view = this.views.get(plugin.manifest.name);
      view?.webContents.send(IPC.pkEnter, enter);
      win.show();
      win.focus();
      return;
    }

    this.detachCurrent(false);

    if (!this.prePluginSize) {
      const [w, h] = win.getSize();
      this.prePluginSize = { width: w, height: h };
    }
    if (win.getSize()[0] < PLUGIN_WIN.width || win.getSize()[1] < PLUGIN_WIN.height) {
      win.setSize(PLUGIN_WIN.width, PLUGIN_WIN.height);
    }

    const view = this.ensureView(plugin);
    win.contentView.addChildView(view);
    this.currentName = plugin.manifest.name;
    this.subinput = null;
    this.currentInput = enter.input?.payload ?? null;
    this.layoutView(view, win);
    this.pushState();

    if (view.webContents.isLoadingMainFrame()) {
      this.pendingEnter.set(plugin.manifest.name, enter);
    } else {
      view.webContents.send(IPC.pkEnter, enter);
    }
    logger.info("plugins", `打开插件 ${plugin.manifest.name} [${enter.code}]`);
  }

  outPlugin(name = this.currentName): void {
    if (!name) return;
    if (this.detachedNames.has(name)) {
      reattachPluginWindow(this, name);
      logger.info("plugins", `退出独立插件 ${name}`);
      return;
    }
    if (this.currentName !== name) return;
    const win = getMainWindow();
    this.detachCurrent(true, false);
    logger.info("plugins", `退出插件 ${name}`);
    if (win) {
      win.webContents.focus();
    }
  }

  private pluginView(name: string): WebContentsView | null {
    const view = this.views.get(name);
    return view && !view.webContents.isDestroyed() ? view : null;
  }

  private detachedWindow(name: string): BrowserWindow | null {
    const win = getDetachedWindow(name);
    return win && !win.isDestroyed() ? win : null;
  }

  private detachCurrent(notifySearch: boolean, processExit = true): void {
    const win = getMainWindow();
    if (this.currentName && win) {
      const previous = this.views.get(this.currentName);
      if (processExit) previous?.webContents.send(IPC.pkOutEvent, true);
      else previous?.webContents.send(IPC.pkOutEvent, false);
      if (processExit) previous?.webContents.send(IPC.pkDetach);
    }
    const prev = this.currentName ? this.views.get(this.currentName) : null;
    if (prev && win) win.contentView.removeChildView(prev);
    if (this.currentName && win && this.prePluginSize) {
      const { width, height } = this.prePluginSize;
      win.setSize(width, height);
      this.prePluginSize = null;
    }
    this.currentName = null;
    this.subinput = null;
    this.currentInput = null;
    if (notifySearch) this.pushState();
  }

  /** 窗口 resize 时同步视图边界 */
  layout(win: BrowserWindow): void {
    const view = this.currentName ? this.views.get(this.currentName) : null;
    if (view) this.layoutView(view, win);
  }

  private layoutView(view: WebContentsView, win: BrowserWindow): void {
    const [w, h] = win.getContentSize();
    view.setBounds({
      x: 0,
      y: HEADER_HEIGHT,
      width: w,
      height: Math.max(80, h - HEADER_HEIGHT),
    });
  }

  /** bk.setViewHeightRatio：调整插件视图高度占比（0.2 ~ 1）。 */
  setViewHeightRatio(ratio: number, name = this.currentName): void {
    if (!name) return;
    const view = this.pluginView(name);
    const isDetached = this.detachedNames.has(name);
    const win = isDetached ? this.detachedWindow(name) : getMainWindow();
    if (!win || !view) return;
    const [w, h] = win.getContentSize();
    const clamped = Math.min(1, Math.max(0.2, ratio));
    const top = isDetached ? DETACH_TOOLBAR_HEIGHT : HEADER_HEIGHT;
    view.setBounds({
      x: 0,
      y: top,
      width: w,
      height: Math.max(80, Math.round((h - top) * clamped)),
    });
  }

  forwardSubInput(text: string): void {
    const view = this.currentName ? this.pluginView(this.currentName) : null;
    view?.webContents.send(IPC.pkSubInputChange, { text });
  }

  forwardDetachedSubInput(name: string, text: string): void {
    const view = this.pluginView(name);
    view?.webContents.send(IPC.pkSubInputChange, { text });
  }

  setSubInput(placeholder: string, isFocus: boolean, name = this.currentName): void {
    if (name && this.detachedNames.has(name)) {
      updateDetachedSubInput(name, { placeholder });
      return;
    }
    this.subinput = placeholder ? { placeholder } : null;
    this.pushState();
    if (isFocus) {
      const win = getMainWindow();
      win?.show();
      win?.webContents.focus();
    }
  }

  // ————— 视图创建与沙箱协议 —————

  private ensureView(plugin: LoadedPlugin): WebContentsView {
    const name = plugin.manifest.name;
    const existing = this.views.get(name);
    if (existing && !existing.webContents.isDestroyed()) return existing;

    const partition = `persist:pk-${name}`;
    const ses = session.fromPartition(partition);
    this.registerPluginProtocol(ses, plugin);

    const mode = getPluginSecurityMode(plugin.manifest);
    const isLegacyTrusted = mode === "legacy-trusted";
    const webPreferences: Electron.WebPreferences = {
      preload: this.preloadPath,
      nodeIntegration: isLegacyTrusted,
      contextIsolation: !isLegacyTrusted,
      sandbox: !isLegacyTrusted,
      partition,
      spellcheck: false,
      additionalArguments: [
        `--boxkit-plugin-security=${mode}`,
        `--boxkit-plugin-permissions=${plugin.manifest.permissions.join(",")}`,
        `--boxkit-plugin-preload=${isLegacyTrusted && plugin.manifest.preload ? path.join(plugin.dir, plugin.manifest.preload) : ""}`,
      ],
    };
    const view = new WebContentsView({ webPreferences });
    view.setBackgroundColor("#00000000");

    const wc = view.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      logger.warn("plugins", `插件尝试 window.open，已拦截: ${url}`);
      return { action: "deny" };
    });
    wc.on("will-navigate", (event, url) => {
      if (!url.startsWith(`bk-plugin://${name}/`)) {
        event.preventDefault();
        logger.warn("plugins", `插件导航已拦截: ${url}`);
      }
    });
    wc.on("did-finish-load", () => {
      const pending = this.pendingEnter.get(name);
      if (pending && this.currentName === name) {
        this.pendingEnter.delete(name);
        wc.send(IPC.pkEnter, pending);
      }
    });
    wc.on("render-process-gone", (_e, details) => {
      logger.error("plugins", `插件渲染进程崩溃(${name}): ${details.reason}`);
      this.destroyView(name);
      this.toast(`插件「${plugin.manifest.displayName}」异常退出`);
    });
    // Esc 退出插件
    wc.on("before-input-event", (event, input) => {
      if (input.type === "keyDown" && input.key === "Escape" && !input.control && !input.meta) {
        event.preventDefault();
        this.outPlugin();
      }
    });

    this.views.set(name, view);
    void wc.loadURL(`bk-plugin://${name}/${plugin.manifest.main}`);
    // 开发目录插件（或显式开启）自动弹 DevTools，便于插件调试
    if (plugin.source === "dev" || process.env.BOXKIT_PLUGIN_DEVTOOLS === "1") {
      wc.openDevTools({ mode: "detach" });
    }
    return view;
  }

  private registerPluginProtocol(
    ses: Electron.Session,
    plugin: LoadedPlugin,
  ): void {
    const name = plugin.manifest.name;
    if (this.protocolsReady.has(name)) return;
    const root = path.resolve(plugin.dir);
    ses.protocol.handle("bk-plugin", (request) => {
      try {
        const url = new URL(request.url);
        const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
        const full = path.resolve(root, rel);
        if (full !== root && !full.startsWith(root + path.sep)) {
          return new Response("forbidden", { status: 403 });
        }
        const data = fs.readFileSync(full);
        const mime = MIME[path.extname(full).toLowerCase()] ?? "application/octet-stream";
        return new Response(new Uint8Array(data), {
          headers: { "Content-Type": mime },
        });
      } catch {
        return new Response("not found", { status: 404 });
      }
    });
    this.protocolsReady.add(name);
  }

  destroyView(name: string): void {
    const view = this.views.get(name);
    const wasCurrent = this.currentName === name;
    if (wasCurrent) {
      this.detachCurrent(true, true);
      try { view?.webContents.close(); } catch { /* ignore */ }
    }
    if (view && !wasCurrent) {
      try {
        view.webContents.send(IPC.pkOutEvent, true);
        view.webContents.send(IPC.pkDetach);
        view.webContents.stop();
      } finally {
        try { view.webContents.close(); } catch { /* ignore */ }
      }
    }
    this.childWindows.forEach((child, id) => {
        if (this.childOwners.get(child.webContents.id) === name) {
          this.childOwners.delete(child.webContents.id);
          this.childWindows.delete(id);
          if (!child.isDestroyed()) child.destroy();
        }
      });
    this.views.delete(name);
    try { session.fromPartition(`persist:pk-${name}`).protocol.unhandle("bk-plugin"); } catch { /* ignore */ }
    this.protocolsReady.delete(name);
    this.pendingEnter.delete(name);
  }

  /** 脱离为独立窗口前：把视图从主窗摘下并清理主窗的插件模式状态。 */
  detachForDetachWindow(name: string): { ok: boolean; restoreSize: { width: number; height: number } | null } {
    const win = getMainWindow();
    const view = this.views.get(name);
    if (!view || view.webContents.isDestroyed() || this.currentName !== name || !win) {
      return { ok: false, restoreSize: null };
    }
    const restoreSize = this.prePluginSize ? { ...this.prePluginSize } : null;
    try {
      view.webContents.send(IPC.pkOutEvent, false);
    } catch {
      /* ignore */
    }
    win.contentView.removeChildView(view);
    if (restoreSize) {
      win.setSize(restoreSize.width, restoreSize.height);
      this.prePluginSize = null;
    }
    this.currentName = null;
    this.subinput = null;
    this.currentInput = null;
    this.pushState();
    return { ok: true, restoreSize };
  }

  /** 把已有插件视图挂到独立窗口。 */
  attachToDetachedWindow(name: string, hostWindow: BrowserWindow): void {
    const view = this.views.get(name);
    if (!view || view.webContents.isDestroyed() || hostWindow.isDestroyed()) return;
    if (hostWindow.contentView.children.includes(view)) return;
    this.detachedNames.add(name);
    hostWindow.contentView.addChildView(view);
    const [w, h] = hostWindow.getContentSize();
    view.setBounds({ x: 0, y: DETACH_TOOLBAR_HEIGHT, width: w, height: Math.max(80, h - DETACH_TOOLBAR_HEIGHT) });
  }

  /** 独立窗口 resize 时同步插件视图边界。 */
  layoutDetachedWindow(name: string, hostWindow: BrowserWindow): void {
    const view = this.views.get(name);
    if (!view || view.webContents.isDestroyed() || hostWindow.isDestroyed()) return;
    const [w, h] = hostWindow.getContentSize();
    view.setBounds({ x: 0, y: DETACH_TOOLBAR_HEIGHT, width: w, height: Math.max(80, h - DETACH_TOOLBAR_HEIGHT) });
  }

  detachedHostState(name: string): DetachHostState {
    const plugin = this.manager.get(name);
    return {
      pluginName: name,
      displayName: plugin?.manifest.displayName ?? name,
      subinput: this.subinput ? { ...this.subinput, value: "" } : null,
      alwaysOnTop: false,
      zoomFactor: 1,
    };
  }

  setDetachedWindow(_name: string, _window: BrowserWindow): void {
    // The detached-window module owns the BrowserWindow registry. This method
    // is kept as a narrow host hook for lifecycle coordination.
  }

  /** 从独立窗口取回视图，等待归还主窗。 */
  reattachFromDetachedWindow(name: string): void {
    const view = this.views.get(name);
    try {
      view?.webContents.send(IPC.pkOutEvent, true);
      view?.webContents.send(IPC.pkDetach);
      view?.webContents.stop();
    } catch {
      /* ignore */
    }
  }

  /** 独立窗口关闭时：确保视图从窗口摘除，之后可由主窗重新打开。 */
  releaseDetachedWindow(name: string, hostWindow: BrowserWindow): void {
    const view = this.views.get(name);
    if (!view) return;
    try {
      hostWindow.contentView.removeChildView(view);
    } catch {
      /* ignore */
    }
    if (this.currentName === name) this.currentName = null;
    this.detachedNames.delete(name);
  }

  destroyAll(): void {
    for (const name of [...this.views.keys()]) this.destroyView(name);
  }

  // ————— 沙箱 IPC（权限校验） —————

  private senderPlugin(e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): LoadedPlugin | null {
    for (const [n, v] of this.views) {
      if (!v.webContents.isDestroyed() && v.webContents.id === e.sender.id) {
        return this.manager.get(n);
      }
    }
    const owner = this.childOwners.get(e.sender.id);
    return owner ? this.manager.get(owner) : null;
  }

  private requirePermission(p: LoadedPlugin | null, perm: PluginPermission): LoadedPlugin {
    if (!p) throw new Error("不在有效的插件环境中");
    // 权限由每个 IPC handler 再次校验；这里仅返回插件自己的声明。
    if (!p.manifest.permissions.includes(perm)) {
      throw new Error(`插件未声明权限: ${perm}`);
    }
    return p;
  }

  registerIpc(): void {
    ipcMain.handle(IPC.pkInfo, (e) => {
      const p = this.senderPlugin(e);
      if (!p) return null;
      return {
        name: p.manifest.name,
        displayName: p.manifest.displayName,
        version: p.manifest.version,
        securityMode: getPluginSecurityMode(p.manifest),
        permissions: [...p.manifest.permissions],
        path: p.dir,
      };
    });

    ipcMain.on(IPC.pkOut, (e) => {
      const owner = this.senderPlugin(e);
      if (owner) this.outPlugin(owner.manifest.name);
    });

    ipcMain.on(IPC.pkSubInputSet, (e, args: { placeholder?: string; isFocus?: boolean }) => {
      const owner = this.requirePermission(this.senderPlugin(e), "window");
      this.setSubInput(args?.placeholder ?? "", !!args?.isFocus, owner.manifest.name);
    });
    ipcMain.on(IPC.pkSubInputRemove, (e) => {
      const owner = this.requirePermission(this.senderPlugin(e), "window");
      this.setSubInput("", false, owner.manifest.name);
    });
    ipcMain.on(IPC.pkSubInputValue, (e, value: unknown) => {
      this.requirePermission(this.senderPlugin(e), "window");
      getMainWindow()?.webContents.send(IPC.searchSetInput, String(value ?? ""));
    });
    ipcMain.on(IPC.pkSubInputFocus, (e) => {
      this.requirePermission(this.senderPlugin(e), "window");
      getMainWindow()?.webContents.send(IPC.searchInputFocus, "focus");
    });
    ipcMain.on(IPC.pkSubInputSelect, (e) => {
      this.requirePermission(this.senderPlugin(e), "window");
      getMainWindow()?.webContents.send(IPC.searchInputSelect, "select");
    });
    ipcMain.on(IPC.pkSubInputBlur, (e) => {
      this.requirePermission(this.senderPlugin(e), "window");
      getMainWindow()?.webContents.send(IPC.searchInputBlur, "blur");
    });

    ipcMain.handle(IPC.pkDbGet, (e, key: string) => {
      const p = this.requirePermission(this.senderPlugin(e), "db");
      return this.manager.db(p.manifest.name).get(String(key));
    });
    ipcMain.handle(IPC.pkDbPut, (e, key: string, value: unknown) => {
      const p = this.requirePermission(this.senderPlugin(e), "db");
      this.manager.db(p.manifest.name).put(String(key), value);
    });
    ipcMain.handle(IPC.pkDbRemove, (e, key: string) => {
      const p = this.requirePermission(this.senderPlugin(e), "db");
      this.manager.db(p.manifest.name).remove(String(key));
    });
    ipcMain.handle(IPC.pkDbAll, (e) => {
      const p = this.requirePermission(this.senderPlugin(e), "db");
      return this.manager.db(p.manifest.name).all();
    });

    // 同步文档存储：保留文档字段并提供轻量 _rev 冲突检测。
    ipcMain.on(IPC.pkDbDocGet, (e, key: string) => {
      const p = this.requirePermission(this.senderPlugin(e), "db");
      e.returnValue = this.manager.db(p.manifest.name).get(String(key));
    });
    ipcMain.on(IPC.pkDbDocPut, (e, key: string, rawDoc: unknown) => {
      const p = this.requirePermission(this.senderPlugin(e), "db");
      const id = String(key ?? "").replace(/^_doc:/, "");
      if (!id || !rawDoc || typeof rawDoc !== "object") {
        e.returnValue = { ok: false, error: "文档必须包含 _id" };
        return;
      }
      const doc = { ...(rawDoc as Record<string, unknown>), _id: id } as Record<string, unknown> & { _id: string; _rev?: string };
      const store = this.manager.db(p.manifest.name);
      const current = store.get(`_doc:${id}`) as { _rev?: string } | null;
      const requestedRev = typeof doc._rev === "string" ? doc._rev : undefined;
      if (current?._rev && requestedRev && requestedRev !== current._rev) {
        e.returnValue = { ok: false, error: "文档版本冲突" };
        return;
      }
      const rev = crypto.createHash("sha1").update(`${id}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 12);
      const saved = { ...doc, _rev: rev };
      store.put(`_doc:${id}`, saved);
      e.returnValue = { ok: true, id, rev };
    });
    ipcMain.on(IPC.pkDbDocRemove, (e, key: string, rawDoc: unknown) => {
      const p = this.requirePermission(this.senderPlugin(e), "db");
      const id = String(key ?? "").replace(/^_doc:/, "");
      const store = this.manager.db(p.manifest.name);
      const current = store.get(`_doc:${id}`) as { _rev?: string } | null;
      const requestedRev = rawDoc && typeof rawDoc === "object" && typeof (rawDoc as { _rev?: unknown })._rev === "string"
        ? (rawDoc as { _rev: string })._rev
        : undefined;
      if (current?._rev && requestedRev && requestedRev !== current._rev) {
        e.returnValue = { ok: false, error: "文档版本冲突" };
        return;
      }
      store.remove(`_doc:${id}`);
      e.returnValue = { ok: true };
    });
    ipcMain.on(IPC.pkDbDocAll, (e) => {
      const p = this.requirePermission(this.senderPlugin(e), "db");
      e.returnValue = this.manager.db(p.manifest.name).all()
        .filter((item) => item.key.startsWith("_doc:"))
        .map((item) => item.value);
    });

    ipcMain.on(IPC.pkNotify, (e, body: unknown) => {
      const p = this.requirePermission(this.senderPlugin(e), "notify");
      new Notification({ title: p.manifest.displayName, body: String(body ?? "") }).show();
    });
    ipcMain.handle(IPC.pkOpenExternal, async (e, url: unknown) => {
      this.requirePermission(this.senderPlugin(e), "shell");
      const value = String(url ?? "");
      if (!/^https?:\/\//i.test(value)) throw new Error("仅允许打开 http(s) 外部链接");
      await shell.openExternal(value);
    });
    ipcMain.handle(IPC.pkOpenPath, async (e, target: unknown) => {
      this.requirePermission(this.senderPlugin(e), "shell");
      return shell.openPath(String(target ?? ""));
    });
    ipcMain.on(IPC.pkHideMain, (e) => {
      this.requirePermission(this.senderPlugin(e), "window");
      getMainWindow()?.hide();
    });
    ipcMain.on(IPC.pkShowMain, (e) => {
      this.requirePermission(this.senderPlugin(e), "window");
      showMainWindow();
    });
    ipcMain.on(IPC.pkResize, (e, ratio: unknown) => {
      const owner = this.requirePermission(this.senderPlugin(e), "window");
      this.setViewHeightRatio(Number(ratio), owner.manifest.name);
    });
    ipcMain.on(IPC.pkResizeHeight, (e, height: unknown) => {
      this.requirePermission(this.senderPlugin(e), "window");
      const win = getMainWindow();
      if (win) {
        const [width] = win.getContentSize();
        const nextHeight = Math.max(80, Math.min(1600, Math.round(Number(height) || 0)));
        win.setContentSize(width, nextHeight);
        win.setSize(win.getSize()[0], Math.max(nextHeight + HEADER_HEIGHT, win.getSize()[1]));
      }
    });
    ipcMain.handle(IPC.pkDisplaySize, (e) => {
      this.requirePermission(this.senderPlugin(e), "screen");
      const d = screen.getPrimaryDisplay();
      return { width: d.size.width, height: d.size.height };
    });
    ipcMain.on(IPC.pkDisplayFull, (e, which: unknown) => {
      this.requirePermission(this.senderPlugin(e), "screen");
      const displays = screen.getAllDisplays().map((d) => ({
        id: String(d.id),
        bounds: d.bounds,
        workArea: d.workArea,
        size: d.size,
        scaleFactor: d.scaleFactor,
      }));
      e.returnValue = which === "all" ? displays : displays.find((d) => d.id === String(screen.getPrimaryDisplay().id)) ?? displays[0];
    });
    ipcMain.on(IPC.pkDialogOpenSync, (e, args: { options?: Electron.OpenDialogOptions }) => {
      const p = this.requirePermission(this.senderPlugin(e), "shell");
      const parent = getMainWindow();
      const opts = { ...(args?.options ?? {}), title: args?.options?.title ?? `选择文件（${p.manifest.displayName}）` };
      const result = parent ? dialog.showOpenDialogSync(parent, opts) : dialog.showOpenDialogSync(opts);
      e.returnValue = result;
    });
    ipcMain.on(IPC.pkDialogSaveSync, (e, args: { options?: Electron.SaveDialogOptions }) => {
      this.requirePermission(this.senderPlugin(e), "shell");
      const parent = getMainWindow();
      const opts = args?.options ?? {};
      const result = parent ? dialog.showSaveDialogSync(parent, opts) : dialog.showSaveDialogSync(opts);
      e.returnValue = result;
    });
    ipcMain.handle(IPC.pkClipboardRead, (e) => {
      this.requirePermission(this.senderPlugin(e), "clipboard");
      return clipboard.readText();
    });
    ipcMain.handle(IPC.pkClipboardWrite, (e, text: string) => {
      this.requirePermission(this.senderPlugin(e), "clipboard");
      clipboard.writeText(String(text));
    });
    ipcMain.on(IPC.pkClipboardWriteSync, (e, text: unknown) => {
      this.requirePermission(this.senderPlugin(e), "clipboard");
      clipboard.writeText(String(text ?? ""));
      e.returnValue = true;
    });
    ipcMain.on(IPC.pkClipboardReadSync, (e) => {
      this.requirePermission(this.senderPlugin(e), "clipboard");
      e.returnValue = clipboard.readText();
    });

    ipcMain.on(IPC.pkClipboardWriteImageSync, (e, png: Buffer) => {
      this.requirePermission(this.senderPlugin(e), "clipboard");
      const img = nativeImage.createFromBuffer(Buffer.from(png));
      e.returnValue = !img.isEmpty();
      if (!img.isEmpty()) (clipboard as unknown as { writeImage(i: Electron.NativeImage): void }).writeImage(img);
    });

    // 兼容图片能力
    ipcMain.handle(IPC.pkClipboardWriteImage, (e, png: Buffer) => {
      this.requirePermission(this.senderPlugin(e), "clipboard");
      const img = nativeImage.createFromBuffer(Buffer.from(png));
      if (img.isEmpty()) throw new Error("无效的图片数据");
      (clipboard as unknown as { writeImage(i: Electron.NativeImage): void }).writeImage(img);
    });
    ipcMain.handle(IPC.pkClipboardReadImage, (e) => {
      this.requirePermission(this.senderPlugin(e), "clipboard");
      const img = (clipboard as unknown as { readImage(): Electron.NativeImage }).readImage();
      return img.isEmpty() ? null : img.toPNG();
    });

    // 区域截图能力：抓取全屏图后显示遮罩供用户选择
    ipcMain.handle(IPC.pkScreenCapture, async (e) => {
      const owner = this.requirePermission(this.senderPlugin(e), "screen");
      this.pendingScreenShot = await this.grabScreenBuffer();
      this.pendingScreenShotOwner = owner.manifest.name;
      const dataUrl = `data:image/png;base64,${this.pendingScreenShot.toString("base64")}`;
      const main = getMainWindow();
      const wasVisible = main?.isVisible() ?? false;
      main?.hide();
      const primary = screen.getPrimaryDisplay();
      const overlay = new BrowserWindow({
        x: primary.bounds.x,
        y: primary.bounds.y,
        width: primary.size.width,
        height: primary.size.height,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        webPreferences: { nodeIntegration: true, contextIsolation: false },
      });
      this.screenCaptureOwners.set(overlay.webContents.id, owner.manifest.name);
      let settled = false;
      const done = (b: Buffer) => {
        if (!settled) {
          settled = true;
          overlay.destroy();
          if (wasVisible) main?.show();
        }
        return Buffer.alloc(0);
      };
      let removeResultListener = () => {};
      const resultP = new Promise<Buffer>((resolve) => {
        const onResult = (event: Electron.IpcMainEvent, buf: Buffer) => {
          if (event.sender !== overlay.webContents) return;
          removeResultListener();
          settled = true;
          resolve(Buffer.from(buf));
          this.screenCaptureOwners.delete(overlay.webContents.id);
          this.pendingScreenShot = null;
          this.pendingScreenShotOwner = null;
          overlay.destroy();
          if (wasVisible) main?.show();
        };
        ipcMain.on("pk:screen-capture-result", onResult);
        removeResultListener = () => ipcMain.removeListener("pk:screen-capture-result", onResult);
        overlay.on("closed", () => {
          removeResultListener();
          if (!settled) {
            settled = true;
            this.screenCaptureOwners.delete(overlay.webContents.id);
            this.pendingScreenShot = null;
            this.pendingScreenShotOwner = null;
            resolve(Buffer.alloc(0));
            if (wasVisible) main?.show();
          }
        });
      });
      try {
        await overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(this.screenCaptureOverlayHtml(dataUrl))}`);
        overlay.show();
      } catch (error) {
        removeResultListener();
        this.screenCaptureOwners.delete(overlay.webContents.id);
        this.pendingScreenShot = null;
        this.pendingScreenShotOwner = null;
        overlay.destroy();
        if (wasVisible) main?.show();
        throw error;
      }
      const png = await resultP;
      return png;
    });

    // 兼容键盘输入能力
    ipcMain.handle(IPC.pkKeyboardTap, async (e, key: string, modifiers: string[]) => {
      this.requirePermission(this.senderPlugin(e), "window");
      if (process.platform !== "win32") throw new Error("当前平台不支持键盘模拟");
      const mod = Array.isArray(modifiers) ? modifiers.map((m) => String(m).toLowerCase()) : [];
      let seq = "";
      if (mod.includes("ctrl")) seq += "^";
      if (mod.includes("alt")) seq += "%";
      if (mod.includes("shift")) seq += "+";
      const k = String(key ?? "");
      const special: Record<string, string> = {
        enter: "{ENTER}", tab: "{TAB}", esc: "{ESC}", escape: "{ESC}",
        up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}",
        backspace: "{BACKSPACE}", delete: "{DELETE}", home: "{HOME}", end: "{END}",
        pageup: "{PGUP}", pagedown: "{PGDN}", space: " ",
      };
      const lower = k.toLowerCase();
      if (special[lower] !== undefined) seq += special[lower];
      else if (/^[a-z0-9]$/.test(lower)) seq += lower.toUpperCase();
      else if (/^F([1-9]|1[0-6])$/.test(k)) seq += `{${k}}`;
      else if (k.length === 1) seq += k;
      else throw new Error(`不支持的按键: ${k}`);
      const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${seq.replace(/'/g, "''")}')`;
      const { execFile } = await import("node:child_process");
      await new Promise<void>((resolve, reject) => {
        execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 5000, windowsHide: true }, (err) =>
          err ? reject(new Error("按键注入失败")) : resolve(),
        );
      });
    });

    // 创建归属当前插件的子窗口

    const createChildWindow = (
      e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
      args: { url?: string; options?: { width?: number; height?: number; preload?: string; nodeIntegration?: boolean } },
    ) => {
      const p = this.requirePermission(this.senderPlugin(e), "window");
      if (!args?.url) throw new Error("缺少 url");
      const rawUrl = String(args.url);
      const url = rawUrl.startsWith("bk-plugin://")
        ? (() => {
            const parsed = new URL(rawUrl);
            if (parsed.hostname !== p.manifest.name) throw new Error("子窗口 URL 不属于当前插件");
            safePluginRelative(p.dir, parsed.pathname.replace(/^\/+/, ""));
            return rawUrl;
          })()
        : `bk-plugin://${p.manifest.name}/${String(args.url).replace(/^\/+/, "")}`;
      const opts = args.options ?? {};
      const preloadAbs = opts.preload ? safePluginRelative(p.dir, opts.preload) : undefined;
      if (preloadAbs && !fs.existsSync(preloadAbs)) throw new Error("preload 文件不存在");
      const win = new BrowserWindow({
        width: Math.max(320, Math.min(2400, Number(opts.width) || 800)),
        height: Math.max(200, Math.min(1800, Number(opts.height) || 600)),
        show: true,
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
          sandbox: false,
          preload: this.preloadPath,
          additionalArguments: [
            `--boxkit-plugin-preload=${preloadAbs ?? ""}`,
          ],
        },
      });
      this.childWindows.set(win.id, win);
      this.childOwners.set(win.webContents.id, p.manifest.name);
      win.on("closed", () => {
        this.childWindows.delete(win.id);
        this.childOwners.delete(win.webContents.id);
      });
      void win.loadURL(url);
      return { id: win.id };
    };

    ipcMain.on(IPC.pkCreateBrowserWindowSync, (e, args) => {
      try {
        e.returnValue = createChildWindow(e, args);
      } catch (error) {
        e.returnValue = null;
        logger.warn("plugins", "创建子窗口失败", error);
      }
    });

    ipcMain.handle(
      IPC.pkCreateBrowserWindow,
      (e, args: { url?: string; options?: { width?: number; height?: number; preload?: string; nodeIntegration?: boolean } }) =>
        createChildWindow(e, args),
    );

    // 向子窗口 webContents 转发消息（createBrowserWindow 回调句柄的 send 即此通道）
    ipcMain.on(IPC.pkBwSend, (e, id: number, channel: string, data: unknown) => {
      const owner = this.senderPlugin(e);
      const w = this.childWindows.get(Number(id));
      if (!owner || !w || this.childOwners.get(w.webContents.id) !== owner.manifest.name) return;
      w.webContents.send(String(channel), data);
    });

    ipcMain.on(IPC.pkParentSend, (e, channel: string, ...data: unknown[]) => {
      const owner = this.senderPlugin(e);
      if (!owner) return;
      // 主窗口插件页可监听自定义事件；消息只发送给当前 owner 的视图。
      const view = this.views.get(owner.manifest.name);
      if (view && !view.webContents.isDestroyed()) view.webContents.send(String(channel), ...data);
    });

    ipcMain.on(IPC.pkRedirectSync, (e, input: { cmd?: string; payload?: unknown }) => {
      const owner = this.requirePermission(this.senderPlugin(e), "window");
      const cmd = String(input?.cmd ?? "").trim();
      if (!cmd) {
        e.returnValue = false;
        return;
      }
      const feature = this.manager
        .enabledPlugins()
        .flatMap((p) => p.manifest.features.map((f) => ({ p, f })))
        .find(({ f }) => f.cmds.some((c) => (typeof c === "string" ? c : c.label ?? c.explain ?? f.explain) === cmd));
      if (!feature) {
        this.toast(`未找到功能：${cmd}`);
        e.returnValue = false;
        return;
      }
      const rawPayload = input?.payload;
      const payload = typeof rawPayload === "string" ? rawPayload : JSON.stringify(rawPayload ?? cmd);
      this.openPlugin(feature.p, { code: feature.f.code, type: "over", payload });
      e.returnValue = owner.manifest.name !== "";
    });

    // BoxKit 旧对象形状仍保留给已有插件。
    ipcMain.handle(IPC.pkRedirect, (e, input: { cmd?: string; payload?: string }) => {
      this.requirePermission(this.senderPlugin(e), "window");
      const cmd = String(input?.cmd ?? "").trim();
      const payload = String(input?.payload ?? "");
      if (!cmd) throw new Error("redirect 缺少 cmd");
      const feat = this.manager
        .enabledPlugins()
        .flatMap((p) => p.manifest.features.map((f) => ({ p, f })))
        .find(({ f }) =>
          f.cmds.some((c) => (typeof c === "string" ? c : (c.explain ?? f.explain)) === cmd),
        );
      if (!feat) {
        this.toast(`未找到功能：${cmd}`);
        return { ok: false };
      }
      this.openPlugin(feat.p, { code: feat.f.code, type: "over", payload: payload || cmd });
      return { ok: true };
    });

    // 本地用户令牌：设备指纹 HMAC
    ipcMain.handle(IPC.pkUserToken, (e) => {
      const p = this.requirePermission(this.senderPlugin(e), "shell");
      const mid = getMachineId();
      const token = crypto
        .createHmac("sha256", "boxkit-user-token")
        .update(`${mid}:${p.manifest.name}`)
        .digest("hex");
      return { token, userId: mid, pluginId: p.manifest.name };
    });

    // 选区回传：只接受与当前遮罩绑定的 sender
    ipcMain.on(IPC.pkScreenCaptureRegion, (e, rect: { x: number; y: number; width: number; height: number }) => {
      const owner = this.screenCaptureOwners.get(e.sender.id);
      if (!owner || owner !== this.pendingScreenShotOwner) {
        e.returnValue = Buffer.alloc(0);
        return;
      }
      e.returnValue = this.resolveScreenCaptureRegion(rect);
    });
  }

  /** 用 overlay 选区裁剪已抓取的全屏图（物理像素按 DPR 换算） */
  private resolveScreenCaptureRegion(rect: { x: number; y: number; width: number; height: number }): Buffer {
    if (!this.pendingScreenShot) throw new Error("没有待裁剪的屏幕图像");
    const img = nativeImage.createFromBuffer(this.pendingScreenShot);
    const dpr = img.getSize().width / (screen.getPrimaryDisplay().size.width || 1);
    const crop = img.crop({
      x: Math.max(0, Math.round(rect.x * dpr)),
      y: Math.max(0, Math.round(rect.y * dpr)),
      width: Math.max(1, Math.round(rect.width * dpr)),
      height: Math.max(1, Math.round(rect.height * dpr)),
    });
    this.pendingScreenShot = null;
    this.pendingScreenShotOwner = null;
    return crop.toPNG();
  }

  /** 抓取主屏全图（screenCapture/自检共用），返回 PNG Buffer */
  async grabScreenBuffer(): Promise<Buffer> {
    const primary = screen.getPrimaryDisplay();
    const { desktopCapturer } = await import("electron");
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: primary.size.width, height: primary.size.height },
    });
    const src = sources.find((s) => s.display_id === String(primary.id)) ?? sources[0];
    if (!src) throw new Error("找不到可截取的屏幕");
    return src.thumbnail.toPNG();
  }

  /** 调试/无头自检入口 */
  async debugGrabScreen(): Promise<Buffer> {
    return this.grabScreenBuffer();
  }

  /** 调试/无头自检入口：按逻辑坐标裁剪指定缓冲 */
  debugCropRect(rect: { x: number; y: number; width: number; height: number }, buf?: Buffer): Buffer {
    this.pendingScreenShot = buf ?? this.pendingScreenShot;
    return this.resolveScreenCaptureRegion(rect);
  }

  /** 选区遮罩页（内联，无构建依赖；nodeIntegration 打开以便回传选区） */
  private screenCaptureOverlayHtml(dataUrl: string): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;overflow:hidden;cursor:crosshair;user-select:none}
      #bg{position:fixed;inset:0;width:100vw;height:100vh}
      #box{position:fixed;border:2px solid #4a90d9;background:rgba(74,144,217,0.15);display:none}
      #tip{position:fixed;top:14px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.65);color:#fff;padding:6px 14px;border-radius:6px;font:13px/1 sans-serif}
    </style></head><body>
    <img id="bg" src="${dataUrl}">
    <div id="box"></div><div id="tip">拖拽选择区域，松开确认，Esc 取消</div>
    <script>
      const { ipcRenderer } = require("electron");
      let sx = 0, sy = 0, dragging = false;
      const box = document.getElementById("box");
      document.addEventListener("mousedown", (e) => {
        dragging = true; sx = e.clientX; sy = e.clientY;
        box.style.display = "block"; box.style.left = sx + "px"; box.style.top = sy + "px";
        box.style.width = "0"; box.style.height = "0";
      });
      document.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        box.style.left = Math.min(sx, e.clientX) + "px";
        box.style.top = Math.min(sy, e.clientY) + "px";
        box.style.width = Math.abs(e.clientX - sx) + "px";
        box.style.height = Math.abs(e.clientY - sy) + "px";
      });
      document.addEventListener("mouseup", (e) => {
        if (!dragging) return;
        dragging = false;
        const w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
        if (w < 4 || h < 4) { window.close(); return; }
        const rect = { x: Math.min(sx, e.clientX), y: Math.min(sy, e.clientY), width: w, height: h };
        const cropped = ipcRenderer.sendSync("pk:screen-capture-region", rect);
        ipcRenderer.send("pk:screen-capture-result", cropped);
        window.close();
      });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") window.close(); });
    </script></body></html>`;
  }
}
