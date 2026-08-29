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
