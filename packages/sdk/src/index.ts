/** Stable host contract version. Runtime host release versions are exposed separately by `hostVersion()`. */
export const HOST_API_VERSION = "1.0.0" as const;
export type HostApiVersion = typeof HOST_API_VERSION;

/** Version of the typed input envelope documented by the SDK. */
export const INPUT_PAYLOAD_VERSION = 1 as const;
export type InputPayloadVersion = typeof INPUT_PAYLOAD_VERSION;

export const HOST_API_PERMISSIONS = [
  "clipboard",
  "db",
  "notify",
  "network",
  "shell",
  "screen",
  "window",
] as const;
export type HostApiPermission = (typeof HOST_API_PERMISSIONS)[number];

export type InputTextSource = "typed" | "paste" | "selection";

/**
 * Version 1 typed input shared by plugin fixtures and future host adapters.
 * The current compatibility runtime still supplies `PluginEnterArgs.payload`
 * as a string; `input` is optional until the typed-input transport is enabled.
 */
export type InputPayload =
  | { type: "text"; text: string; source: InputTextSource }
  | { type: "img"; mime: string; size: number; tempRef: string }
  | { type: "files"; files: Array<{ path: string; name: string; kind: "file" | "directory" }> };

export interface VersionedInputPayload {
  version: InputPayloadVersion;
  payload: InputPayload;
}

export interface LegacyCommandPayload {
  type?: "text" | "img" | "files";
  data?: unknown;
}

export interface LegacyPluginEnterArgs extends PluginEnterArgs {
  option?: unknown;
  from?: string;
}

export interface LegacyDisplay {
  id: string;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  size: { width: number; height: number };
  scaleFactor: number;
}

export interface LegacyApi {
  onPluginEnter(callback: (args: LegacyPluginEnterArgs) => void): void;
  onPluginOut(callback: (processExit: boolean) => void): void;
  onPluginDetach(callback: () => void): void;
  onDbPull(callback: (docs: unknown[]) => void): void;
  setSubInput(callback: (text: string) => void, placeholder?: string, isFocus?: boolean): boolean;
  onSubInputChange(callback: (text: string) => void): void;
  removeSubInput(): boolean;
  setSubInputValue(value: string): boolean;
  subInputFocus(): boolean;
  subInputSelect(): boolean;
  subInputBlur(): boolean;
  outPlugin(isKill?: boolean): boolean;
  hideMainWindow(isRestore?: boolean): boolean;
  showMainWindow(): boolean;
  setExpendHeight(height: number): boolean;
  notify(body: string, featureName?: string): boolean;
  showNotification(body: string, featureName?: string): boolean;
  copyText(text: string): boolean;
  copyImage(data: Uint8Array | string): boolean;
  readClipboardText(): Promise<string>;
  readClipboardImage(): Promise<Uint8Array | null>;
  screenCapture(callback: (imageBase64: string) => void): void;
  db: {
    get(id: string): unknown | null;
    put(doc: Record<string, unknown>): { ok: boolean; id?: string; rev?: string; error?: string };
    post(data: unknown): { ok: boolean; id?: string; rev?: string; error?: string };
    remove(doc: Record<string, unknown>): { ok: boolean; error?: string };
    allDocs(): unknown[];
  };
  openExternal(url: string): Promise<void>;
  openPath(target: string): Promise<string>;
  getPrimaryDisplay(): LegacyDisplay;
  getAllDisplays(): LegacyDisplay[];
  showOpenDialog(options?: unknown): string[] | undefined;
  showSaveDialog(options?: unknown): string | undefined;
  isDarkColors(): boolean;
  getAPIVersion(): string;
  getAppVersion(): string;
  getNativeId(): string;
  fetchUserServerToken(): Promise<{ token: string; userId: string; pluginId: string }>;
  redirect(label: string | string[], payload?: string | LegacyCommandPayload): boolean;
  simulateKeyboardTap(key: string, ...modifiers: string[]): void;
  createBrowserWindow(url: string, options?: Record<string, unknown>, callback?: (win: BrowserWindowHandle) => void): BrowserWindowHandle | null;
  sendToParent(channel: string, ...data: unknown[]): boolean;
}

export interface BrowserWindowHandle {
  id: number;
  send(channel: string, data: unknown): void;
}

/** 兼容旧插件包的全局类型声明。 */
declare global {
  interface Window {
    bk?: BKApi;
  }
}

export const legacyGlobalName = ["u", "tools"].join("");

/** BoxKit 插件 API 类型定义。插件运行环境通过兼容 preload 暴露 `window.bk`。 */

export interface PluginEnterArgs {
  /** 命中的 feature code */
  code: string;
  type: "text" | "regex" | "over";
  /** 命中关键字时的原始输入；兼容字段，始终保持字符串形状。 */
  payload: string;
  /** 版本化 typed input；宿主尚未启用时不提供。 */
  input?: VersionedInputPayload;
}

export interface PluginInfo {
  name: string;
  displayName: string;
  version: string;
  permissions: string[];
  /** 插件根目录（只读参考） */
  path: string;
}

export interface KVItem {
  key: string;
  value: unknown;
  updateAt: number;
}

export interface BKApi {
  /** 插件被某 feature 唤起时触发（每次进入都会触发） */
  onPluginEnter(callback: (args: PluginEnterArgs) => void): void;
  /** 插件退出时触发 */
  onPluginOut(callback: () => void): void;
  /** 接管主搜索框（子输入框）；之后用户输入变化通过 onSubInputChange 推送 */
  setSubInput(options: { placeholder: string; isFocus?: boolean }): void;
  removeSubInput(): void;
  onSubInputChange(callback: (text: string) => void): void;

  /** 退出插件，返回搜索面板 */
  outPlugin(): void;
  /** 显示通知气泡 */
  notify(body: string): void;
  copyText(text: string): void;
  readClipboardText(): Promise<string>;
  writeClipboardText(text: string): Promise<void>;

  /** 插件隔离的本地 KV 存储（随插件卸载删除） */
  db: {
    get<T = unknown>(key: string): Promise<T | null>;
    put(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
    all(): Promise<KVItem[]>;
  };

  /** 用系统默认方式打开外部链接（需 shell 权限） */
  openExternal(url: string): Promise<void>;
  /** 调整插件视图尺寸比例 0~1（需 window 权限，可选能力） */
  setViewHeightRatio(ratio: number): void;
  /** 获取主屏工作区尺寸（需 screen 权限） */
  getPrimaryDisplaySize(): Promise<{ width: number; height: number }>;
  /** 插件信息 */
  info(): Promise<PluginInfo>;
  /** BoxKit 宿主版本 */
  hostVersion(): string;
}

/** 判断当前是否运行在 BoxKit 插件环境中 */
export function inBoxKit(): boolean {
  return typeof window !== "undefined" && !!(window as unknown as { bk?: unknown }).bk;
}

/** 获取 bk API；不在插件环境中会抛出带提示的错误 */
export function getBK(): BKApi {
  const bk = (typeof window !== "undefined" ? (window as unknown as { bk?: BKApi }).bk : undefined);
  if (!bk) {
    throw new Error(
      "未检测到 BoxKit 插件环境：请在 BoxKit 内运行，或确认插件已通过开发者模式加载。",
    );
  }
  return bk;
}

declare global {
  interface Window {
    bk?: BKApi;
  }
}
