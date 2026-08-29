/** BoxKit 插件 API 类型定义。插件运行环境通过沙箱 preload 暴露 `window.bk`。 */

export interface PluginEnterArgs {
  /** 命中的 feature code */
  code: string;
  type: "text" | "regex" | "over";
  /** 命中关键字时的原始输入 */
  payload: string;
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
