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
  pkNotify: "pk:notify",
  pkOpenExternal: "pk:open-external",
  pkResize: "pk:resize",
  pkDisplaySize: "pk:display-size",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
