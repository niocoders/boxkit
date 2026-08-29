import {
  BrowserWindow,
  WebContentsView,
  clipboard,
  ipcMain,
  screen,
  session,
  shell,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  IPC,
  type PluginModeState,
  type PluginPermission,
} from "@boxkit/shared";
import { logger } from "../core/logger.js";
import type { LoadedPlugin } from "./manager.js";
import type { PluginManager } from "./manager.js";
import { getMainWindow } from "../windows/mainWindow.js";

const HEADER_HEIGHT = 64;
const PLUGIN_WIN = { width: 880, height: 640 };
const SEARCH_WIN = { width: 720, height: 560 };

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
  type: "text" | "regex" | "over";
  payload: string;
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
  private currentName: string | null = null;
  private subinput: { placeholder: string } | null = null;
  private pendingEnter = new Map<string, EnterPayload>();
  private prePluginSize: { width: number; height: number } | null = null;
  private stateListeners = new Set<(s: PluginModeState) => void>();

  constructor(
    private readonly manager: PluginManager,
    private readonly canUsePlugins: () => boolean,
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
    if (!this.canUsePlugins()) {
      this.toast("试用期已结束，请在设置中激活授权");
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
    this.layoutView(view, win);
    this.pushState();

    if (view.webContents.isLoadingMainFrame()) {
      this.pendingEnter.set(plugin.manifest.name, enter);
    } else {
      view.webContents.send(IPC.pkEnter, enter);
    }
    logger.info("plugins", `打开插件 ${plugin.manifest.name} [${enter.code}]`);
  }

  outPlugin(): void {
    if (!this.currentName) return;
    const win = getMainWindow();
    const name = this.currentName;
    const view = this.views.get(name);
    view?.webContents.send(IPC.pkOutEvent);
    this.detachCurrent(true);
    logger.info("plugins", `退出插件 ${name}`);
    if (win) {
      win.webContents.focus();
    }
  }

  private detachCurrent(notifySearch: boolean): void {
    const win = getMainWindow();
    const prev = this.currentName ? this.views.get(this.currentName) : null;
    if (prev && win) win.contentView.removeChildView(prev);
    if (this.currentName && win && this.prePluginSize) {
      const { width, height } = this.prePluginSize;
      win.setSize(width, height);
      this.prePluginSize = null;
    }
    this.currentName = null;
    this.subinput = null;
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

  /** bk.setViewHeightRatio：调整视图高度占比（0.2 ~ 1） */
  setViewHeightRatio(ratio: number): void {
    const win = getMainWindow();
    const view = this.currentName ? this.views.get(this.currentName) : null;
    if (!win || !view) return;
    const [w, h] = win.getContentSize();
    const clamped = Math.min(1, Math.max(0.2, ratio));
    view.setBounds({
      x: 0,
      y: HEADER_HEIGHT,
      width: w,
      height: Math.max(80, Math.round((h - HEADER_HEIGHT) * clamped)),
    });
  }

  forwardSubInput(text: string): void {
    const view = this.currentName ? this.views.get(this.currentName) : null;
    view?.webContents.send(IPC.pkSubInputChange, { text });
  }

  setSubInput(placeholder: string, isFocus: boolean): void {
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

    const view = new WebContentsView({
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition,
        spellcheck: false,
      },
    });
    view.setBackgroundColor("#00000000");

    const wc = view.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      logger.warn("plugins", `插件尝试 window.open，已拦截: ${url}`);
      return { action: "deny" };
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
      if (input.type === "keyDown" && input.key === "Escape") {
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
    if (this.currentName === name) this.detachCurrent(true);
    // 非附着状态的视图交由 GC 回收；分区存储保留（重开插件不丢数据）
    if (view) {
      try {
        view.webContents.stop();
      } catch {
        /* ignore */
      }
    }
    this.views.delete(name);
    this.pendingEnter.delete(name);
  }

  destroyAll(): void {
    for (const name of [...this.views.keys()]) this.destroyView(name);
  }

  // ————— 沙箱 IPC（权限校验） —————

  private senderPlugin(e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): LoadedPlugin | null {
    const name = this.currentName;
    if (!name) return null;
    const view = this.views.get(name);
    if (view && !view.webContents.isDestroyed() && view.webContents.id === e.sender.id) {
      return this.manager.get(name);
    }
    // 兜底：遍历缓存视图
    for (const [n, v] of this.views) {
      if (!v.webContents.isDestroyed() && v.webContents.id === e.sender.id) {
        return this.manager.get(n);
      }
    }
    return null;
  }

  private requirePermission(p: LoadedPlugin | null, perm: PluginPermission): LoadedPlugin {
    if (!p) throw new Error("不在有效的插件环境中");
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
        permissions: [...p.manifest.permissions],
        path: p.dir,
      };
    });

    ipcMain.on(IPC.pkOut, () => this.outPlugin());

    ipcMain.on(IPC.pkSubInputSet, (_e, args: { placeholder?: string; isFocus?: boolean }) => {
      this.setSubInput(args?.placeholder ?? "", !!args?.isFocus);
    });
    ipcMain.on(IPC.pkSubInputRemove, () => this.setSubInput("", false));

    ipcMain.handle(IPC.pkDbGet, (e, key: string) => {
      const p = this.senderPlugin(e);
      if (!p) throw new Error("不在有效的插件环境中");
      return this.manager.db(p.manifest.name).get(String(key));
    });
    ipcMain.handle(IPC.pkDbPut, (e, key: string, value: unknown) => {
      const p = this.senderPlugin(e);
      if (!p) throw new Error("不在有效的插件环境中");
      this.manager.db(p.manifest.name).put(String(key), value);
    });
    ipcMain.handle(IPC.pkDbRemove, (e, key: string) => {
      const p = this.senderPlugin(e);
      if (!p) throw new Error("不在有效的插件环境中");
      this.manager.db(p.manifest.name).remove(String(key));
    });
    ipcMain.handle(IPC.pkDbAll, (e) => {
      const p = this.senderPlugin(e);
      if (!p) throw new Error("不在有效的插件环境中");
      return this.manager.db(p.manifest.name).all();
    });

    ipcMain.handle(IPC.pkClipboardRead, (e) => {
      this.requirePermission(this.senderPlugin(e), "clipboard");
      return clipboard.readText();
    });
    ipcMain.handle(IPC.pkClipboardWrite, (e, text: string) => {
      this.requirePermission(this.senderPlugin(e), "clipboard");
      clipboard.writeText(String(text));
    });

    ipcMain.on(IPC.pkNotify, (e, body: string) => {
      const p = this.requirePermission(this.senderPlugin(e), "notify");
      this.toast(`[${p.manifest.displayName}] ${String(body).slice(0, 120)}`);
    });

    ipcMain.handle(IPC.pkOpenExternal, (e, url: string) => {
      this.requirePermission(this.senderPlugin(e), "shell");
      const u = String(url);
      if (!/^https?:\/\//i.test(u)) throw new Error("仅允许 http/https 链接");
      void shell.openExternal(u);
    });

    ipcMain.on(IPC.pkResize, (_e, ratio: number) => {
      this.setViewHeightRatio(Number(ratio));
    });

    ipcMain.handle(IPC.pkDisplaySize, (e) => {
      this.requirePermission(this.senderPlugin(e), "screen");
      return screen.getPrimaryDisplay().workAreaSize;
    });
  }
}
