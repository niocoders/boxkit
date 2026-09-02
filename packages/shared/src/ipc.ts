/**
 * 全部 IPC 通道名的唯一定义。
 * 命名约定：<域>:<动作>，渲染层/插件层只允许调用这里列出的通道。
 */
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
