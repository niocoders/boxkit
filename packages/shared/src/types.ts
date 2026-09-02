/** BoxKit 全局共享类型（主进程 / 渲染层 / 插件 SDK 三方一致）。 */

/** 插件权限清单：未在 plugin.json 声明的权限，主进程一律拒绝调用。 */
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
  kind: "app" | "command" | "plugin" | "web";
  score: number;
  /** kind=plugin 时有效 */
  pluginId?: string;
  featureCode?: string;
  /** 命中方式：text=关键字片段 over=关键字全匹配 regex=正则命中 */
  cmdType?: "text" | "regex" | "over";
  /** kind=web 时有效：搜索词 */
  webQuery?: string;
  /** kind=plugin 时有效：该 feature 的全部关键字（uTools 式副命令，→ 展开候选） */
  pluginCmds?: string[];
  /** 执行时透传给插件的 payload（副命令选中时为其关键字文本） */
  payload?: string;
  /** 空态网格分组：recent=最近使用 plugin=插件功能 market=市场精选 */
  section?: "recent" | "plugin" | "market";
}

export type SearchMode = "search" | "plugin";

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
  features: { code: string; explain: string; cmds: string[] }[];
}

export interface InstallPreview {
  stagingId: string;
  displayName: string;
  name: string;
  version: string;
  description?: string;
  permissions: PluginPermission[];
  /** logo data URL，供确认弹窗展示 */
  logo?: string;
}

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
  /** .bkx 的 sha256（客户端下载后校验） */
  sha256?: string;
  /** 关键字（features.cmds 汇总），供市场搜索 */
  keywords?: string[];
  /** 相对客户端已安装版本的状态（客户端本地比对后覆盖） */
  installed?: boolean;
  updatable?: boolean;
  localVersion?: string;
}

export type LicenseMode = "trial" | "trial-expired" | "licensed" | "license-expired";

export interface LicenseState {
  mode: LicenseMode;
  /** trial 剩余天数（向上取整）；licensed 为剩余有效期天数，null = 永久 */
  daysLeft: number | null;
  email?: string;
  plan?: string;
  expiresAt?: number | null;
  trialStartedAt?: number;
}

export interface UpdateState {
  status: "idle" | "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";
  info?: { version: string; releaseNotes?: string };
  progress?: number;
  error?: string;
  feedUrl?: string;
}
