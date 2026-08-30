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
  type PluginModeState,
  type PluginPermission,
} from "@boxkit/shared";
import { logger } from "../core/logger.js";
import type { LoadedPlugin } from "./manager.js";
import type { PluginManager } from "./manager.js";
import { getMainWindow } from "../windows/mainWindow.js";
import { getMachineId } from "../services/machine-id.js";

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
  private pendingScreenShot: Buffer | null = null;
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
        // uTools 兼容运行模型：插件页面/预载具备 Node 能力、与 preload 同上下文
        preload: this.preloadPath,
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
        partition,
        spellcheck: false,
        // 链式加载插件自带 preload（绝对路径经 argv 传入，见 preload/plugin.ts）
        additionalArguments: [
          `--boxkit-plugin-preload=${plugin.manifest.preload ? path.join(plugin.dir, plugin.manifest.preload) : ""}`,
        ],
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

    // uTools 兼容：剪贴板图片（PNG buffer）
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

    // ————— uTools 兼容：screenCapture（区域裁剪） —————
    // 流程：抓主屏全图 → 隐藏主窗 → 全屏遮罩拖拽选区 → 按选区裁剪 → PNG 回调；Esc 取消
    ipcMain.handle(IPC.pkScreenCapture, async (e) => {
      this.requirePermission(this.senderPlugin(e), "screen");
      const dataUrl = await this.grabPrimaryScreen();
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
      let settled = false;
      const done = (b: Buffer) => {
        if (!settled) {
          settled = true;
          overlay.destroy();
          if (wasVisible) main?.show();
        }
        return Buffer.alloc(0);
      };
      const resultP = new Promise<Buffer>((resolve) => {
        ipcMain.once("pk:screen-capture-result", (_ev, buf: Buffer) => {
          settled = true;
          resolve(Buffer.from(buf));
          overlay.destroy();
          if (wasVisible) main?.show();
        });
        overlay.on("closed", () => {
          if (!settled) {
            settled = true;
            resolve(this.pendingScreenShot ?? Buffer.alloc(0));
            if (wasVisible) main?.show();
          }
        });
      });
      await overlay.loadURL(this.screenCaptureOverlayHtml(dataUrl));
      overlay.show();
      const png = await resultP;
      return png;
    });

    // ————— uTools 兼容：simulateKeyboardTap —————
    // PowerShell SendKeys 注入组合键（作用于当前焦点窗口）
    ipcMain.handle(IPC.pkKeyboardTap, async (_e, key: string, modifiers: string[]) => {
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

    // ————— uTools 兼容：createBrowserWindow —————
    const childWindows = new Map<number, BrowserWindow>();

    ipcMain.handle(
      IPC.pkCreateBrowserWindow,
      (e, args: { url?: string; options?: { width?: number; height?: number; preload?: string; nodeIntegration?: boolean } }) => {
        const p = this.requirePermission(this.senderPlugin(e), "window");
        if (!args?.url) throw new Error("缺少 url");
        const url = args.url.startsWith("bk-plugin://")
          ? args.url
          : `bk-plugin://${p.manifest.name}/${String(args.url).replace(/^\/+/, "")}`;
        const opts = args.options ?? {};
        const preloadAbs = opts.preload ? path.join(p.dir, opts.preload) : undefined;
        if (preloadAbs && !fs.existsSync(preloadAbs)) throw new Error("preload 文件不存在");
        const win = new BrowserWindow({
          width: opts.width ?? 800,
          height: opts.height ?? 600,
          show: true,
          autoHideMenuBar: true,
          webPreferences: {
            nodeIntegration: opts.nodeIntegration ?? true,
            contextIsolation: false,
            preload: preloadAbs,
          },
        });
        childWindows.set(win.id, win);
        win.on("closed", () => childWindows.delete(win.id));
        void win.loadURL(url);
        return { id: win.id };
      },
    );

    // 向子窗口 webContents 转发消息（createBrowserWindow 回调句柄的 send 即此通道）
    ipcMain.on(IPC.pkBwSend, (_e, id: number, channel: string, data: unknown) => {
      const w = childWindows.get(Number(id));
      w?.webContents.send(String(channel), data);
    });

    // ————— uTools 兼容：redirect（跳转到其他插件/关键字） —————
    ipcMain.handle(IPC.pkRedirect, (_e, input: { cmd?: string; payload?: string }) => {
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

    // ————— uTools 兼容：fetchUserServerToken（BoxKit 本地用户令牌） —————
    // uTools 返回其账号体系令牌；BoxKit 无账号体系，签发基于设备指纹的本地稳定令牌。
    ipcMain.handle(IPC.pkUserToken, (e) => {
      const p = this.requirePermission(this.senderPlugin(e), "shell");
      const mid = getMachineId();
      const token = crypto
        .createHmac("sha256", "boxkit-user-token")
        .update(`${mid}:${p.manifest.name}`)
        .digest("hex");
      return { token, userId: mid, pluginId: p.manifest.name };
    });

    // ————— uTools 兼容：screenCapture 区域裁剪（overlay 选区回传） —————
    ipcMain.on(IPC.pkScreenCaptureRegion, (e, rect: { x: number; y: number; width: number; height: number }) => {
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
    return crop.toPNG();
  }

  /** 抓取主屏全图（screenCapture 第一步），返回 data URL 供 overlay 背景 */
  private async grabPrimaryScreen(): Promise<string> {
    const primary = screen.getPrimaryDisplay();
    const { desktopCapturer } = await import("electron");
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: primary.size.width, height: primary.size.height },
    });
    const src = sources.find((s) => s.display_id === String(primary.id)) ?? sources[0];
    if (!src) throw new Error("找不到可截取的屏幕");
    this.pendingScreenShot = src.thumbnail.toPNG();
    return `data:image/png;base64,${this.pendingScreenShot.toString("base64")}`;
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
