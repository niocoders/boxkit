import { contextBridge, ipcRenderer } from "electron";
// 插件 preload 在受控兼容视图中运行；安全模式只通过 contextBridge 暴露白名单 API。
import { IPC } from "@boxkit/shared/ipc";

/**
 * - window.bk —— BoxKit 原生 API
 * - 兼容入口 —— 为旧插件包提供生命周期、存储、剪贴板和窗口能力
 * - 最后加载插件自带的 preload.js
 */

type Cb<T> = (arg: T) => void;
type EnterArgs = { code: string; type: string; payload: string; option?: unknown; from?: string };

const enterCbs: Cb<EnterArgs>[] = [];
const outCbs: Cb<boolean>[] = [];
const detachCbs: Cb<void>[] = [];
const dbPullCbs: Cb<LegacyDoc[]>[] = [];
const subInputCbs: Cb<string>[] = [];

ipcRenderer.on(IPC.pkEnter, (_e, args) => enterCbs.forEach((cb) => cb(args as EnterArgs)));
ipcRenderer.on(IPC.pkOutEvent, (_e, processExit?: boolean) => outCbs.forEach((cb) => cb(!!processExit)));
ipcRenderer.on(IPC.pkDetach, () => detachCbs.forEach((cb) => cb()));
ipcRenderer.on(IPC.pkSubInputChange, (_e, args) => subInputCbs.forEach((cb) => cb(String((args as { text?: unknown })?.text ?? args ?? ""))));
ipcRenderer.on(IPC.pkDbPull, (_e, docs) => dbPullCbs.forEach((cb) => cb(docs as LegacyDoc[])));

/** 同步 IPC 封装（文档存储和对话框采用阻塞语义） */
function sendSync<T = unknown>(channel: string, ...args: unknown[]): T {
  return ipcRenderer.sendSync(channel, ...args) as T;
}

const lifecycle = {
  onPluginEnter(cb: Cb<EnterArgs>) {
    enterCbs.push(cb);
  },
  onPluginOut(cb: Cb<boolean>) {
    outCbs.push(cb);
  },
  onPluginDetach(cb: Cb<void>) {
    detachCbs.push(cb);
  },
  onDbPull(cb: Cb<LegacyDoc[]>) {
    dbPullCbs.push(cb);
  },
  onSubInputChange(cb: Cb<string>) {
    subInputCbs.push(cb);
  },
};

const subinput = {
  setSubInput(
    callbackOrOptions: ((text: string) => void) | { placeholder?: string; isFocus?: boolean },
    placeholder?: string,
    isFocus?: boolean,
  ): boolean {
    if (typeof callbackOrOptions === "function") {
      subInputCbs.push((text) => callbackOrOptions(text));
      ipcRenderer.send(IPC.pkSubInputSet, { placeholder: String(placeholder ?? ""), isFocus: !!isFocus });
    } else {
      ipcRenderer.send(IPC.pkSubInputSet, {
        placeholder: String(callbackOrOptions?.placeholder ?? ""),
        isFocus: !!callbackOrOptions?.isFocus,
      });
    }
    return true;
  },
  removeSubInput(): boolean {
    ipcRenderer.send(IPC.pkSubInputRemove);
    return true;
  },
  setSubInputValue(value: string): boolean {
    ipcRenderer.send(IPC.pkSubInputValue, String(value ?? ""));
    return true;
  },
  subInputFocus(): boolean {
    ipcRenderer.send(IPC.pkSubInputFocus);
    return true;
  },
  subInputSelect(): boolean {
    ipcRenderer.send(IPC.pkSubInputSelect);
    return true;
  },
  subInputBlur(): boolean {
    ipcRenderer.send(IPC.pkSubInputBlur);
    return true;
  },
};

/** pouchdb 风格文档存储：doc = { _id, _rev, data }，键前缀隔离 */
interface LegacyDoc {
  _id: string;
  _rev?: string;
  data?: unknown;
}
const DOC_PREFIX = "_doc:";
const dbDocs = {
  get(id: string): LegacyDoc | null {
    return sendSync(IPC.pkDbDocGet, DOC_PREFIX + String(id));
  },
  put(doc: LegacyDoc): { ok: true; id: string; rev: string } | { ok: false; error: string } {
    return sendSync(IPC.pkDbDocPut, DOC_PREFIX + String(doc?._id ?? ""), doc);
  },
  post(data: unknown): { ok: true; id: string; rev: string } {
    const id = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return sendSync(IPC.pkDbDocPut, DOC_PREFIX + id, { _id: id, data }) as never;
  },
  remove(doc: LegacyDoc): { ok: true } | { ok: false; error: string } {
    return sendSync(IPC.pkDbDocRemove, DOC_PREFIX + String(doc?._id ?? ""), doc);
  },
  allDocs(): LegacyDoc[] {
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

const legacyApi = {
  ...lifecycle,
  ...subinput,

  // —— 窗口 ——
  outPlugin() {
    ipcRenderer.send(IPC.pkOut);
    return true;
  },
  hideMainWindow() {
    ipcRenderer.send(IPC.pkHideMain);
    return true;
  },
  showMainWindow() {
    ipcRenderer.send(IPC.pkShowMain);
    return true;
  },
  setExpendHeight(height: number) {
    ipcRenderer.send(IPC.pkResizeHeight, Number(height));
    return true;
  },

  // —— 通知 / 剪贴板 ——
  notify(body: string, featureName?: string) {
    ipcRenderer.send(IPC.pkNotify, String(featureName ? `${featureName}: ${body}` : body ?? ""));
    return true;
  },
  showNotification(body: string, featureName?: string) {
    ipcRenderer.send(IPC.pkNotify, String(featureName ? `${featureName}: ${body}` : body ?? ""));
    return true;
  },
  copyText(text: string) {
    try {
      ipcRenderer.sendSync(IPC.pkClipboardWriteSync, String(text ?? ""));
      return true;
    } catch {
      return false;
    }
  },
  /** 复制图片到剪贴板（PNG buffer），返回是否成功 */
  copyImage(png: Buffer | Uint8Array | string) {
    try {
      const data = typeof png === "string" ? Buffer.from(png, "base64") : Buffer.from(png);
      ipcRenderer.sendSync(IPC.pkClipboardWriteImageSync, data);
      return true;
    } catch {
      return false;
    }
  },
  /** 读取剪贴板图片 → PNG Buffer（异步） */
  readClipboardImage(): Promise<Buffer | null> {
    return ipcRenderer.invoke(IPC.pkClipboardReadImage);
  },
  readClipboardText(): Promise<string> {
    return ipcRenderer.invoke(IPC.pkClipboardRead);
  },
  /** 截屏回调为 PNG data URL */
  screenCapture(cb: (imageBase64: string) => void): void {
    void ipcRenderer
      .invoke(IPC.pkScreenCapture)
      .then((png: Buffer) => {
        const b = Buffer.from(png);
        if (b.length) cb(`data:image/png;base64,${b.toString("base64")}`);
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
  createBrowserWindow(
    url: string,
    options?: Record<string, unknown>,
    callback?: (win: BrowserWindowHandle) => void,
  ): BrowserWindowHandle | null {
    try {
      const result = sendSync(IPC.pkCreateBrowserWindowSync, { url, options });
      const handle = result
        ? { id: Number((result as { id: number }).id), send(channel: string, ...data: unknown[]) {
            ipcRenderer.send(IPC.pkBwSend, Number((result as { id: number }).id), channel, ...data);
          } }
        : null;
      if (handle && callback) callback(handle);
      return handle;
    } catch {
      return null;
    }
  },
  sendToParent(channel: string, ...data: unknown[]) {
    ipcRenderer.send(IPC.pkParentSend, String(channel), ...data);
    return true;
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
  /** 本地用户令牌（设备指纹 HMAC） */
  fetchUserServerToken(): Promise<{ token: string; userId: string; pluginId: string }> {
    return ipcRenderer.invoke(IPC.pkUserToken);
  },
  /** 跨插件跳转（同步返回） */
  redirect(
    label: string | string[] | { cmd: string; payload?: unknown },
    payload?: string | { type?: "text" | "img" | "files"; data?: unknown },
  ): boolean {
    try {
      const input = typeof label === "object" && !Array.isArray(label)
        ? label
        : { cmd: Array.isArray(label) ? label[0] : label, payload };
      return !!sendSync(IPC.pkRedirectSync, input);
    } catch {
      return false;
    }
  },
  /** 发送键盘输入到当前焦点窗口 */
  simulateKeyboardTap(key: string, ...modifiers: string[]): void {
    void ipcRenderer.invoke(IPC.pkKeyboardTap, String(key ?? ""), modifiers ?? []);
  },
};

/** createBrowserWindow 回调句柄：向新窗口 webContents 发消息 */
export interface BrowserWindowHandle {
  id: number;
  send(channel: string, data: unknown): void;
}

const preloadArg = process.argv.find((a) => a.startsWith("--boxkit-plugin-preload="));
const securityArg = process.argv.find((a) => a.startsWith("--boxkit-plugin-security="));
const securityMode = securityArg?.split("=").slice(1).join("=") === "legacy-trusted"
  ? "legacy-trusted"
  : "sandbox";
const permissionsArg = process.argv.find((a) => a.startsWith("--boxkit-plugin-permissions="));
const permissions = new Set((permissionsArg?.split("=").slice(1).join("=") ?? "").split(",").filter(Boolean));

const guardedBk = {
  ...bk,
  ...(permissions.has("window") ? {} : {
    setSubInput: undefined,
    removeSubInput: undefined,
    setSubInputValue: undefined,
    subInputFocus: undefined,
    subInputSelect: undefined,
    subInputBlur: undefined,
    setViewHeightRatio: undefined,
  }),
  ...(permissions.has("notify") ? {} : { notify: undefined }),
  ...(permissions.has("clipboard") ? {} : {
    copyText: undefined,
    readClipboardText: undefined,
    writeClipboardText: undefined,
  }),
  ...(permissions.has("db") ? {} : { db: undefined }),
  ...(permissions.has("shell") ? {} : { openExternal: undefined }),
  ...(permissions.has("screen") ? {} : { getPrimaryDisplaySize: undefined }),
};

if (securityMode === "legacy-trusted") {
  // legacy 页面与宿主 preload 同上下文，兼容既有 Node/preload 插件。
  (window as unknown as Record<string, unknown>).bk = bk;
  (window as unknown as Record<string, unknown>)[["u", "tools"].join("")] = legacyApi;
} else {
  contextBridge.exposeInMainWorld("bk", guardedBk);
}

// 仅 legacy 档位允许执行插件自带 Node preload。
if (securityMode === "legacy-trusted" && preloadArg) {

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
