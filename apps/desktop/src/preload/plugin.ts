import { ipcRenderer } from "electron";
// 注意：本 preload 运行在 nodeIntegration 开启的插件环境（与 uTools 一致），
// 可以直接挂 window 全局（contextIsolation 关闭，页面与 preload 同一上下文）。
import { IPC } from "@boxkit/shared/ipc";

/**
 * 插件 preload：
 * - window.utools —— uTools 兼容 API（生命周期/子输入框/pouchdb 风格同步 db/剪贴板/窗口控制…）
 * - window.bk    —— BoxKit 原生 API（保持向后兼容）
 * - 最后加载插件自带的 preload.js（uTools 插件代码零改动运行的关键）
 */

type Cb<T> = (arg: T) => void;

const enterCbs: Cb<{ code: string; type: string; payload: string }>[] = [];
const outCbs: Cb<void>[] = [];
const subInputCbs: Cb<{ text: string }>[] = [];

ipcRenderer.on(IPC.pkEnter, (_e, args) => enterCbs.forEach((cb) => cb(args)));
ipcRenderer.on(IPC.pkOutEvent, () => outCbs.forEach((cb) => cb()));
ipcRenderer.on(IPC.pkSubInputChange, (_e, args) => subInputCbs.forEach((cb) => cb(args)));

/** 同步 IPC 封装（uTools db/对话框是阻塞语义） */
function sendSync<T = unknown>(channel: string, ...args: unknown[]): T {
  return ipcRenderer.sendSync(channel, ...args) as T;
}

const lifecycle = {
  onPluginEnter(cb: Cb<{ code: string; type: string; payload: string }>) {
    enterCbs.push(cb);
  },
  onPluginOut(cb: Cb<void>) {
    outCbs.push(cb);
  },
  onSubInputChange(cb: Cb<{ text: string }>) {
    subInputCbs.push(cb);
  },
};

const subinput = {
  setSubInput(options: { placeholder: string; isFocus?: boolean }) {
    ipcRenderer.send(IPC.pkSubInputSet, {
      placeholder: String(options?.placeholder ?? ""),
      isFocus: !!options?.isFocus,
    });
  },
  removeSubInput() {
    ipcRenderer.send(IPC.pkSubInputRemove);
  },
};

/** pouchdb 风格文档存储：doc = { _id, _rev, data }，键前缀隔离 */
interface UtoolsDoc {
  _id: string;
  _rev?: string;
  data?: unknown;
}
const DOC_PREFIX = "_doc:";
const dbDocs = {
  get(id: string): UtoolsDoc | null {
    return sendSync(IPC.pkDbDocGet, DOC_PREFIX + String(id));
  },
  put(doc: UtoolsDoc): { ok: true; id: string; rev: string } | { ok: false; error: string } {
    return sendSync(IPC.pkDbDocPut, DOC_PREFIX + String(doc?._id ?? ""), doc);
  },
  post(data: unknown): { ok: true; id: string; rev: string } {
    const id = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return sendSync(IPC.pkDbDocPut, DOC_PREFIX + id, { _id: id, data }) as never;
  },
  remove(doc: UtoolsDoc): { ok: true } | { ok: false; error: string } {
    return sendSync(IPC.pkDbDocRemove, DOC_PREFIX + String(doc?._id ?? ""), doc);
  },
  allDocs(): UtoolsDoc[] {
    return sendSync(IPC.pkDbDocAll);
  },
};

const bk = {
  ...lifecycle,
  ...subinput,
  outPlugin() {
    ipcRenderer.send(IPC.pkOut);
  },
  notify(body: string) {
    ipcRenderer.send(IPC.pkNotify, String(body ?? ""));
  },
  copyText(text: string) {
    void ipcRenderer.invoke(IPC.pkClipboardWrite, String(text ?? ""));
  },
  readClipboardText(): Promise<string> {
    return ipcRenderer.invoke(IPC.pkClipboardRead);
  },
  writeClipboardText(text: string): Promise<void> {
    return ipcRenderer.invoke(IPC.pkClipboardWrite, String(text ?? ""));
  },
  db: {
    get<T = unknown>(key: string): Promise<T | null> {
      return ipcRenderer.invoke(IPC.pkDbGet, String(key));
    },
    put(key: string, value: unknown): Promise<void> {
      return ipcRenderer.invoke(IPC.pkDbPut, String(key), value);
    },
    remove(key: string): Promise<void> {
      return ipcRenderer.invoke(IPC.pkDbRemove, String(key));
    },
    all(): Promise<{ key: string; value: unknown; updateAt: number }[]> {
      return ipcRenderer.invoke(IPC.pkDbAll);
    },
  },
  openExternal(url: string): Promise<void> {
    return ipcRenderer.invoke(IPC.pkOpenExternal, String(url ?? ""));
  },
  setViewHeightRatio(ratio: number) {
    ipcRenderer.send(IPC.pkResize, Number(ratio));
  },
  getPrimaryDisplaySize(): Promise<{ width: number; height: number }> {
    return ipcRenderer.invoke(IPC.pkDisplaySize);
  },
  info(): Promise<{
    name: string;
    displayName: string;
    version: string;
    permissions: string[];
    path: string;
  } | null> {
    return ipcRenderer.invoke(IPC.pkInfo);
  },
  hostVersion(): string {
    return navigator.userAgent.match(/BoxKit\/([\d.]+)/)?.[1] ?? "unknown";
  },
};

const utools = {
  ...lifecycle,
  ...subinput,

  // —— 窗口 ——
  outPlugin() {
    ipcRenderer.send(IPC.pkOut);
  },
  hideMainWindow() {
    ipcRenderer.send(IPC.pkHideMain);
  },
  showMainWindow() {
    ipcRenderer.send(IPC.pkShowMain);
  },

  // —— 通知 / 剪贴板 ——
  notify(body: string) {
    ipcRenderer.send(IPC.pkNotify, String(body ?? ""));
  },
  copyText(text: string) {
    void ipcRenderer.invoke(IPC.pkClipboardWrite, String(text ?? ""));
  },
  /** 复制图片到剪贴板（PNG buffer，同步语义 fire-and-forget） */
  copyImage(png: Buffer) {
    void ipcRenderer.invoke(IPC.pkClipboardWriteImage, Buffer.from(png as unknown as ArrayBuffer));
  },
  /** 读取剪贴板图片 → PNG Buffer（异步） */
  readClipboardImage(): Promise<Buffer | null> {
    return ipcRenderer.invoke(IPC.pkClipboardReadImage);
  },
  readClipboardText(): Promise<string> {
    return ipcRenderer.invoke(IPC.pkClipboardRead);
  },
  /** 截屏 → PNG Buffer（当前为全屏兜底实现，经回调返回） */
  screenCapture(cb: (png: Buffer) => void): void {
    void ipcRenderer
      .invoke(IPC.pkScreenCapture)
      .then((png: Buffer) => {
        const b = Buffer.from(png);
        if (b.length) cb(b); // 空缓冲 = 用户取消
      })
      .catch((err: unknown) => console.error("[boxkit] screenCapture 失败:", err));
  },

  // —— 文档存储（pouchdb 风格，同步） ——
  db: dbDocs,

  // —— 系统 ——
  openExternal(url: string): Promise<void> {
    return ipcRenderer.invoke(IPC.pkOpenExternal, String(url ?? ""));
  },
  openPath(path: string): Promise<string> {
    return ipcRenderer.invoke(IPC.pkOpenPath, String(path ?? ""));
  },
  getPrimaryDisplay() {
    return sendSync(IPC.pkDisplayFull, "primary");
  },
  getAllDisplays() {
    return sendSync(IPC.pkDisplayFull, "all");
  },
  showOpenDialog(options: unknown) {
    return sendSync(IPC.pkDialogOpenSync, { kind: "open", options });
  },
  showSaveDialog(options: unknown) {
    return sendSync(IPC.pkDialogSaveSync, { kind: "save", options });
  },

  // —— 环境 ——
  isDarkColors(): boolean {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  },
  getAPIVersion(): string {
    return navigator.userAgent.match(/BoxKit\/([\d.]+)/)?.[1] ?? "unknown";
  },
  getAppVersion(): string {
    return navigator.userAgent.match(/BoxKit\/([\d.]+)/)?.[1] ?? "unknown";
  },
  getNativeId(): string {
    // 兼容占位：设备标识由宿主统一管理，插件层不暴露
    return "boxkit";
  },
  /** BoxKit 本地用户令牌（设备指纹 HMAC；uTools 版返回其账号体系令牌） */
  fetchUserServerToken(): Promise<{ token: string; userId: string; pluginId: string }> {
    return ipcRenderer.invoke(IPC.pkUserToken);
  },
  /** 重定向到其他插件功能：utools.redirect({ cmd: "关键字", payload? }) */
  redirect(redirectInput: { cmd: string; payload?: string }): Promise<{ ok: boolean }> {
    return ipcRenderer.invoke(IPC.pkRedirect, redirectInput);
  },
  /** 模拟按键（作用于当前焦点窗口）：utools.simulateKeyboardTap('a', 'ctrl') */
  simulateKeyboardTap(key: string, ...modifiers: string[]): void {
    void ipcRenderer.invoke(IPC.pkKeyboardTap, String(key ?? ""), modifiers ?? []);
  },
};

/** createBrowserWindow 回调句柄：向新窗口 webContents 发消息 */
export interface BrowserWindowHandle {
  id: number;
  send(channel: string, data: unknown): void;
}

// —— 挂全局（contextIsolation 关闭：页面与 preload 同上下文） ——
(window as unknown as Record<string, unknown>).bk = bk;
(window as unknown as Record<string, unknown>).utools = utools;

// —— 链式加载插件自带 preload（uTools 插件零改动运行的关键） ——
// 主进程通过 webPreferences.additionalArguments 传入插件 preload 绝对路径
const preloadArg = process.argv.find((a) => a.startsWith("--boxkit-plugin-preload="));
if (preloadArg) {
  const pluginPreload = preloadArg.split("=").slice(1).join("=");
  try {
    if (pluginPreload) {
      delete require.cache[require.resolve(pluginPreload)];
      require(pluginPreload);
    }
  } catch (e) {
    console.error("[boxkit] 插件 preload 加载失败:", e);
  }
}
