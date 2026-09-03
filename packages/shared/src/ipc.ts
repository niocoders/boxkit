/**
 * 全部 IPC 通道名的唯一定义。
 * 命名约定：<域>:<动作>，渲染层/插件层只允许调用这里列出的通道。
 */
export const IPC_FORBIDDEN = "FORBIDDEN" as const;

export interface IpcForbidden {
  ok: false;
  code: typeof IPC_FORBIDDEN;
  message: string;
}

export function forbidden(message = "IPC 调用者无权执行此操作"): IpcForbidden {
  return { ok: false, code: IPC_FORBIDDEN, message };
}

export type IpcRole = "search" | "settings" | "profile" | "detach-host" | `plugin:${string}`;

/** 从受信任窗口页面 URL 推导页面角色；远程/未知页面一律无角色。 */
export function ipcRoleForUrl(rawUrl: string): IpcRole | null {
  if (typeof rawUrl !== "string" || !rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === "bk-plugin:" && parsed.hostname) return `plugin:${parsed.hostname}`;
    if (parsed.protocol !== "file:" && parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const page = decodeURIComponent(parsed.pathname).replace(/\\/g, "/").toLowerCase();
    if (page.endsWith("/renderer/search/index.html") || page.endsWith("/search/index.html")) return "search";
    if (page.endsWith("/renderer/settings/index.html") || page.endsWith("/settings/index.html")) return "settings";
    if (page.endsWith("/renderer/profile/index.html") || page.endsWith("/profile/index.html")) return "profile";
    if (page.endsWith("/renderer/detach/index.html") || page.endsWith("/detach/index.html")) return "detach-host";
  } catch {
    return null;
  }
  return null;
}

/** 应用页面的最小通道角色矩阵；插件角色默认不在应用 IPC 白名单内。 */
export function isIpcRoleAllowed(role: IpcRole, channel: string): boolean {
  if (role.startsWith("plugin:")) return false;
  const commonSearch = new Set<string>([
    IPC.searchQuery, IPC.searchExecute, IPC.searchHide, IPC.searchInput,
    IPC.favoritesGet, IPC.favoritesPin, IPC.favoritesUnpin,
    IPC.clipboardHistoryQuery, IPC.clipboardHistoryCapture, IPC.clipboardHistoryClear,
    IPC.uiOpenSettings, IPC.uiOpenProfile, IPC.pluginExit, IPC.pluginDetach, IPC.pluginReattach,
  ]);
  if (role === "search") return commonSearch.has(channel);
  if (role === "settings") {
    return new Set<string>([
      IPC.configGet, IPC.configSet, IPC.appsList,
      IPC.overviewData, IPC.overviewOpenApp,
      IPC.pluginList, IPC.pluginInstallPreview, IPC.pluginInstallConfirm,
      IPC.pluginEnable, IPC.pluginDisable, IPC.pluginUninstall,
      IPC.pluginAddDevPath, IPC.pluginRemoveDevPath,
      IPC.settingsReady, IPC.marketFetch, IPC.marketInstall,
      IPC.updaterState, IPC.updaterCheck, IPC.updaterInstall,
      IPC.appInfo, IPC.appQuit, IPC.appOpenLogs,
    ]).has(channel);
  }
  if (role === "profile") return false;
  if (role === "detach-host") {
    return new Set<string>([
      IPC.detachGetState, IPC.detachInput, IPC.detachReattach, IPC.detachClose,
      IPC.detachToggleAlwaysOnTop, IPC.detachSetZoom,
      IPC.uiOpenSettings,
    ]).has(channel);
  }
  return false;
}

export const IPC = {
  // —— 主搜索窗（search renderer ↔ main）——
  searchQuery: "search:query",
  searchExecute: "search:execute",
  searchHide: "search:hide",
  searchDataChanged: "search:data-changed", // main → search renderer：应用/收藏/剪贴板数据变化
  searchInput: "search:input", // renderer → main：插件模式下转发输入框内容
  searchSetInput: "search:set-input", // main → renderer：兼容子输入值
  searchInputFocus: "search:input-focus", // main → renderer
  searchInputSelect: "search:input-select", // main → renderer
  searchInputBlur: "search:input-blur", // main → renderer
  favoritesGet: "favorites:get",
  favoritesPin: "favorites:pin",
  favoritesUnpin: "favorites:unpin",
  clipboardHistoryQuery: "clipboard:history:query",
  clipboardHistoryCapture: "clipboard:history:capture",
  clipboardHistoryClear: "clipboard:history:clear",
  clipboardHistoryChanged: "clipboard:history:changed", // main → search renderer
  pluginExit: "plugin:exit", // renderer → main：点击返回按钮退出插件
  pluginState: "plugin:state", // main → search renderer：搜索/插件模式切换
  uiToast: "ui:toast", // main → renderer：气泡通知
  uiOpenSettings: "ui:open-settings", // renderer → main：底栏入口打开设置窗
  uiOpenProfile: "ui:open-profile", // renderer → main：头像入口打开本地概览

  // —— 应用（search/settings renderer ↔ main）——
  appsList: "apps:list", // invoke：已扫描应用列表
  appsChanged: "apps:changed", // main → settings renderer：应用扫描完成
  pluginDetach: "plugin:detach", // plugin mode renderer → main：插件脱离为独立窗口
  pluginReattach: "plugin:reattach",
  detachGetState: "detach:get-state", // detach preload → main：读取独立窗口状态
  detachState: "detach:state", // main → detach preload：独立窗口状态变化
  detachInput: "detach:input", // detach preload → main：独立窗口子输入
  detachFocusInput: "detach:focus-input", // main → detach preload
  detachSelectInput: "detach:select-input", // main → detach preload
  detachBlurInput: "detach:blur-input", // main → detach preload
  detachReattach: "detach:reattach", // detach preload → main：归还主面板
  detachClose: "detach:close", // detach preload → main：关闭并归还
  detachToggleAlwaysOnTop: "detach:toggle-always-on-top", // detach preload → main
  detachSetZoom: "detach:set-zoom", // detach preload → main

  // —— 配置（settings renderer ↔ main，search 也会读取）——
  configGet: "config:get",
  configSet: "config:set",

  // —— 插件管理（settings renderer ↔ main）——
  pluginList: "plugin:list",
  pluginInstallPreview: "plugin:install:preview",
  pluginInstallConfirm: "plugin:install:confirm",
  pluginEnable: "plugin:enable",
  pluginDisable: "plugin:disable",
  pluginUninstall: "plugin:uninstall",
  pluginAddDevPath: "plugin:add-dev-path",
  pluginRemoveDevPath: "plugin:remove-dev-path",
  pluginChanged: "plugin:changed", // main → search renderer：插件集合变化，需要刷新

  settingsReady: "settings:ready", // settings renderer → main：页面监听器已就绪
  settingsShowTab: "settings:show-tab", // main → settings renderer：打开并切换 tab/视图
  settingsInstallPreview: "settings:install-preview", // main → settings renderer：协议导入待确认安装

  // —— 插件市场（settings renderer ↔ main）——
  marketFetch: "market:fetch", // invoke：拉取市场列表（keyword 参数）
  marketInstall: "market:install", // invoke：下载市场插件并进入暂存，返回 InstallPreview

  // —— 更新（settings renderer ↔ main）——
  updaterState: "updater:state", // invoke：当前状态快照
  updaterCheck: "updater:check",
  updaterInstall: "updater:install",
  updaterEvent: "updater:event", // main → settings renderer：进度/结果事件

  // —— 应用（settings renderer ↔ main）——
  appInfo: "app:info",
  appQuit: "app:quit",
  appOpenLogs: "app:open-logs",
  overviewData: "overview:data",
  overviewOpenApp: "overview:open-app",

  // —— 插件沙箱（plugin preload ↔ main，经白名单校验）——
  pkInfo: "pk:info",
  pkEnter: "pk:enter", // main → plugin：进入事件 {code,type,payload}
  pkOut: "pk:out", // plugin → main：退出插件
  pkOutEvent: "pk:out-event", // main → plugin：已退出通知
  pkDetach: "pk:detach", // main → plugin：插件视图被卸载
  pkSubInputSet: "pk:subinput:set", // plugin → main
  pkSubInputRemove: "pk:subinput:remove", // plugin → main
  pkSubInputValue: "pk:subinput:value", // 兼容子输入赋值
  pkSubInputFocus: "pk:subinput:focus", // 兼容子输入聚焦
  pkSubInputSelect: "pk:subinput:select", // 兼容子输入选择
  pkSubInputBlur: "pk:subinput:blur", // 兼容子输入失焦
  pkSubInputChange: "pk:subinput:change", // main → plugin
  pkParentSend: "pk:parent:send", // 兼容父窗口消息
  pkSubInputCommand: "pk:subinput:command", // 插件 → 主窗口命令
  pkDbGet: "pk:db:get",
  pkDbPut: "pk:db:put",
  pkDbRemove: "pk:db:remove",
  pkDbAll: "pk:db:all",
  pkClipboardRead: "pk:clipboard:read",
  pkClipboardWrite: "pk:clipboard:write",
  pkClipboardWriteImage: "pk:clipboard:write-image", // 兼容图片写入
  pkClipboardWriteImageSync: "pk:clipboard:write-image-sync", // 兼容同步图片写入
  pkClipboardReadImage: "pk:clipboard:read-image", // 兼容图片读取
  pkClipboardWriteSync: "pk:clipboard:write-sync", // 兼容同步文本写入
  pkClipboardReadSync: "pk:clipboard:read-sync", // 兼容同步读文本
  pkScreenCapture: "pk:screen-capture", // 兼容区域截图
  pkScreenCaptureRegion: "pk:screen-capture-region", // 选区确认（overlay → main）
  pkRedirect: "pk:redirect", // 兼容跳转对象
  pkRedirectSync: "pk:redirect-sync", // 兼容同步跳转
  pkUserToken: "pk:user-token", // 兼容本地令牌
  pkNotify: "pk:notify",
  pkOpenExternal: "pk:open-external",
  pkResize: "pk:resize",
  pkResizeHeight: "pk:resize-height", // 兼容窗口高度调整
  pkDisplaySize: "pk:display-size",
  // —— 兼容 API 通道 ——
  pkHideMain: "pk:hide-main", // 隐藏主窗口
  pkShowMain: "pk:show-main", // 显示主窗口
  pkOpenPath: "pk:open-path", // 打开路径
  pkDisplayFull: "pk:display-full", // 显示器信息
  pkDbDocGet: "pk:db-doc:get", // 同步文档读取
  pkDbDocPut: "pk:db-doc:put", // 同步文档写入
  pkDbDocRemove: "pk:db-doc:remove", // 同步文档删除
  pkDbDocAll: "pk:db-doc:all", // 同步文档列表
  pkDbPull: "pk:db-pull", // 文档变化通知
  pkKeyboardTap: "pk:keyboard-tap", // 键盘模拟
  pkCreateBrowserWindow: "pk:bw:create", // 创建子窗口
  pkCreateBrowserWindowSync: "pk:bw:create-sync", // 同步创建子窗口
  pkBwSend: "pk:bw:send", // 向已创建的子窗口 webContents 发消息
  pkDialogOpenSync: "pk:dialog:open-sync", // 同步打开对话框
  pkDialogSaveSync: "pk:dialog:save-sync", // 同步保存对话框
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
