/**
 * 全部 IPC 通道名的唯一定义。
 * 命名约定：<域>:<动作>，渲染层/插件层只允许调用这里列出的通道。
 */
export const IPC = {
  // —— 主搜索窗（search renderer ↔ main）——
  searchQuery: "search:query",
  searchExecute: "search:execute",
  searchHide: "search:hide",
  searchInput: "search:input", // renderer → main：插件模式下转发输入框内容
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

  // —— 授权（settings renderer ↔ main）——
  licenseState: "license:state",
  licenseActivate: "license:activate",
  licenseDeactivate: "license:deactivate",

  settingsShowTab: "settings:show-tab", // main → settings renderer：打开并切换 tab/视图

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
  pkSubInputSet: "pk:subinput:set", // plugin → main
  pkSubInputRemove: "pk:subinput:remove", // plugin → main
  pkSubInputChange: "pk:subinput:change", // main → plugin
  pkDbGet: "pk:db:get",
  pkDbPut: "pk:db:put",
  pkDbRemove: "pk:db:remove",
  pkDbAll: "pk:db:all",
  pkClipboardRead: "pk:clipboard:read",
  pkClipboardWrite: "pk:clipboard:write",
  pkClipboardWriteImage: "pk:clipboard:write-image", // utools.copyImage(pngBuffer)
  pkClipboardReadImage: "pk:clipboard:read-image", // utools.readClipboardImage()
  pkScreenCapture: "pk:screen-capture", // utools.screenCapture（区域裁剪）
  pkScreenCaptureRegion: "pk:screen-capture-region", // 选区确认（overlay → main）
  pkRedirect: "pk:redirect", // utools.redirect({cmd,payload})
  pkUserToken: "pk:user-token", // utools.fetchUserServerToken
  pkNotify: "pk:notify",
  pkOpenExternal: "pk:open-external",
  pkResize: "pk:resize",
  pkDisplaySize: "pk:display-size",
  // —— uTools 兼容层（window.utools）——
  pkHideMain: "pk:hide-main", // utools.hideMainWindow()
  pkShowMain: "pk:show-main", // utools.showMainWindow()
  pkOpenPath: "pk:open-path", // utools.openPath(path)
  pkDisplayFull: "pk:display-full", // utools.getPrimaryDisplay()/getAllDisplays()
  pkDbDocGet: "pk:db-doc:get", // utools.db.get(id)（同步 IPC）
  pkDbDocPut: "pk:db-doc:put", // utools.db.put(doc)（同步 IPC）
  pkDbDocRemove: "pk:db-doc:remove", // utools.db.remove(doc)（同步 IPC）
  pkDbDocAll: "pk:db-doc:all", // utools.db.allDocs()（同步 IPC）
  pkKeyboardTap: "pk:keyboard-tap", // utools.simulateKeyboardTap
  pkCreateBrowserWindow: "pk:bw:create", // utools.createBrowserWindow
  pkBwSend: "pk:bw:send", // 向已创建的子窗口 webContents 发消息
  pkDialogOpenSync: "pk:dialog:open-sync", // utools.showOpenDialog（同步 IPC）
  pkDialogSaveSync: "pk:dialog:save-sync", // utools.showSaveDialog（同步 IPC）
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
