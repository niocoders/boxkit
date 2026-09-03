/** BoxKit 全局共享类型（主进程 / 渲染层 / 插件 SDK 三方一致）。 */

/** 当前插件输入协议版本。 */
export const INPUT_PAYLOAD_VERSION = 1 as const;
export type InputPayloadVersion = typeof INPUT_PAYLOAD_VERSION;
export type InputTextSource = "typed" | "paste" | "selection";

export interface TextInputPayload {
  type: "text";
  text: string;
  source: InputTextSource;
}

export interface ImageInputPayload {
  type: "img";
  mime: string;
  size: number;
  /** 宿主临时文件/句柄引用，不是图片内容本身。 */
  tempRef: string;
  /** 小图片可作为一次性内存 payload 传递，禁止持久化。 */
  data?: Uint8Array;
}

export interface FileInputItem {
  path: string;
  name: string;
  kind: "file" | "directory";
}

export interface FilesInputPayload {
  type: "files";
  files: FileInputItem[];
}

/** 插件搜索和启动时使用的 typed 输入。 */
export type InputPayload = TextInputPayload | ImageInputPayload | FilesInputPayload;
export interface VersionedInputPayload {
  version: InputPayloadVersion;
  payload: InputPayload;
}

/** feature 命令的命中类型；img/files 表示对应的 typed input。 */
export type PluginCommandType = "text" | "regex" | "over" | "img" | "files";

export const PLUGIN_PERMISSIONS = [
  "clipboard",
  "db",
  "notify",
  "network",
  "shell",
  "screen",
  "window",
] as const;
export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

/** 插件运行安全档位。sandbox 是默认档位；legacy-trusted 明确允许 Node/preload。 */
export const PLUGIN_SECURITY_MODES = ["sandbox", "legacy-trusted"] as const;
export type PluginSecurityMode = (typeof PLUGIN_SECURITY_MODES)[number];

export const PLUGIN_SECURITY_MODE_EXPLAIN: Record<PluginSecurityMode, string> = {
  sandbox: "安全模式：Node 集成关闭，context isolation 与 Chromium sandbox 已开启",
  "legacy-trusted": "完全信任模式：插件可执行 Node/preload 本地代码，不提供安全沙箱",
};

export const PERMISSION_EXPLAIN: Record<PluginPermission, string> = {
  clipboard: "读取和写入系统剪贴板",
  db: "在本地存储插件数据",
  notify: "发送系统通知",
  network: "访问网络",
  shell: "打开外部链接与应用",
  screen: "获取屏幕尺寸信息",
  window: "调整插件窗口大小",
};

/** 搜索结果条目（主进程搜索管道的统一产物）。 */
export interface SearchResult {
  id: string;
  title: string;
  subtitle?: string;
  /** 图标：data URL（主进程已转 base64）或内置图标名 */
  icon?: string;
  iconKind?: "data-url" | "builtin";
  builtinIcon?: string;
  kind: "app" | "command" | "plugin" | "web" | "file" | "clipboard";
  score: number;
  /** 是否已收藏/固定（只由主进程根据持久化 ID 标记） */
  pinned?: boolean;
  /** kind=file 时有效 */
  filePath?: string;
  /** kind=clipboard 时有效 */
  clipboardId?: string;
  /** kind=plugin 时有效 */
  pluginId?: string;
  featureCode?: string;
  /** 命中方式：text=关键字片段 over=关键字全匹配 regex=正则命中。 */
  cmdType?: PluginCommandType;
  /** kind=plugin 时的原始文本查询，用于异步刷新后的 payload 兜底。 */
  queryText?: string;
  /** kind=web 时有效：搜索词 */
  webQuery?: string;
  /** kind=plugin 时有效：该 feature 的全部关键字（兼容副命令，→ 展开候选） */
  pluginCmds?: string[];
  /**
   * kind=plugin 时的原始输入。typed 查询保留调用方传入的对象引用，
   * 旧字符串查询保留原始字符串，供启动适配层兼容 legacy 插件。
   */
  payload?: InputPayload | string;
  /** 当输入是 typed payload 时使用；旧插件仍读取 payload 字符串。 */
  input?: VersionedInputPayload;
  /** 空态网格分组：recent=最近使用 pinned=已固定 plugin=插件功能 market=市场精选 */
  section?: "recent" | "pinned" | "plugin" | "market";
}

export type SearchMode = "search" | "plugin";

/** 独立插件窗口宿主工具栏固定高度，单位为 DIP。 */
export const DETACH_TOOLBAR_HEIGHT = 40;

export interface DetachSubInputState {
  placeholder: string;
  value: string;
}

export interface DetachHostState {
  pluginName: string;
  displayName: string;
  subinput: DetachSubInputState | null;
  alwaysOnTop: boolean;
  zoomFactor: number;
}

/** 设置窗口导航目标；pluginId 用于直达单个已安装插件的设置。 */
export interface SettingsRoute {
  tab: string;
  view?: "installed" | "market";
  pluginId?: string;
}

/** 主窗推送的插件模式状态。 */
export interface PluginModeState {
  mode: SearchMode;
  plugin?: {
    name: string;
    displayName: string;
    logo?: string;
    featureExplain?: string;
  };
  subinput?: { placeholder: string } | null;
}

export interface PluginListItem {
  name: string;
  displayName: string;
  version: string;
  description?: string;
  logo?: string;
  source: "installed" | "dev";
  path: string;
  enabled: boolean;
  permissions: string[];
  /** 由 manifest 归一化得到；旧 IPC 客户端缺失时必须按未知档位处理。 */
  securityMode?: PluginSecurityMode;
  features: { code: string; explain: string; cmds: string[] }[];
}

export interface InstallPreview {
  stagingId: string;
  displayName: string;
  name: string;
  version: string;
  description?: string;
  permissions: PluginPermission[];
  /** 由 manifest 归一化得到；缺失时安装界面不得假定 legacy 或无风险。 */
  securityMode?: PluginSecurityMode;
  /** logo data URL，供确认弹窗展示 */
  logo?: string;
}

export interface FavoriteState {
  /** 仅保存可复现的结果 ID，不保存插件执行 payload。 */
  ids: string[];
}

export interface FileSearchEntry {
  path: string;
  name: string;
  isDirectory?: boolean;
  size?: number;
  modifiedAt?: number;
}

export type ClipboardHistoryKind = "text" | "image" | "file";

export interface ClipboardHistoryItem {
  id: string;
  kind: ClipboardHistoryKind;
  text?: string;
  /** image kind 的 PNG data URL；受主进程大小限制。 */
  imageDataUrl?: string;
  /** file kind 只保存路径，不读取或保存文件内容。 */
  paths?: string[];
  createdAt: number;
  size: number;
}

export interface ClipboardHistoryQuery {
  text?: string;
  limit?: number;
}

/** search renderer 粘贴/拖放传给主进程的受限数据。 */
export interface ClipboardCapture {
  text?: string;
  paths?: string[];
  image?: Uint8Array;
}

/** 本地概览数据：仅来自本机统计和已安装应用。 */
export interface LocalOverviewData {
  version: string;
  firstLaunchAt: number;
  topApps: { name: string; path: string; icon?: string; count: number }[];
}

/** 快捷键注册目标：主面板或自身插件的 feature。 */
export type HotkeyTarget = "main" | `plugin:${string}:${string}`;

export interface AppSettings {
  hotkey: string;
  autostart: boolean;
  sentryEnabled: boolean;
  /** null = 使用内置默认 feed；可在设置页覆盖 */
  updateFeed: string | null;
  firstLaunchAt: number;
  disabledPlugins: string[];
  devPluginPaths: string[];
  /** 插件市场服务地址；null = 内置默认（GitHub Pages 静态市场） */
  marketUrl: string | null;
  /** 搜索结果 ID 的持久化收藏列表。 */
  pinnedIds: string[];
  /** 剪贴板历史监听总开关，默认关闭以避免意外保存敏感数据。 */
  clipboardHistoryEnabled: boolean;
  /** 剪贴板历史最大条数，主进程仍会执行硬上限。 */
  clipboardHistoryLimit: number;
  /** 插件快捷键：`plugin:<插件名>:<featureCode>` → 全局快捷键。 */
  pluginHotkeys: Record<string, string>;
  /** 旧版本应用快捷键配置，仅为迁移兼容保留，不再注册或展示。 */
  appHotkeys?: Record<string, string>;
}

/** configSet 的返回：设置 + 快捷键应用结果（冲突时给出提示） */
export interface ConfigSetResult {
  settings: AppSettings;
  hotkeyError: string | null;
}

/**
 * 插件市场条目（公开仓 boxkit-market Pages 的 manifest.json plugins[] 项）。
 * fileUrl / logoUrl 在清单里是相对路径，客户端会规范为基于市场地址的绝对 URL。
 */
export interface MarketPlugin {
  pluginId: string;
  displayName: string;
  version: string;
  description?: string;
  author?: string;
  /** logo 路径（清单内相对路径） */
  logoUrl?: string;
  /** .bkx 包下载地址（清单内相对路径） */
  fileUrl: string;
  /** .bkx 文件大小（字节），用于展示 */
  fileSize?: number;
  /** .bkx 的 sha256，市场清单必须提供 64 位十六进制值 */
  sha256: string;
  license?: string;
  maintainer?: string;
  sourceUrl?: string;
  /** 关键字（features.cmds 汇总），供市场搜索 */
  keywords?: string[];
  /** 相对客户端已安装版本的状态（客户端本地比对后覆盖） */
  installed?: boolean;
  updatable?: boolean;
  localVersion?: string;
}

export interface UpdateState {
  status: "idle" | "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";
  info?: { version: string; releaseNotes?: string };
  progress?: number;
  error?: string;
  feedUrl?: string;
}
