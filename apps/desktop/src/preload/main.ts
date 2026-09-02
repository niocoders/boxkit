import { contextBridge, ipcRenderer } from "electron";
// 注意：沙箱 preload 只允许引入无 Node 内建依赖的子模块（ipc.ts 仅常量）
import { IPC } from "@boxkit/shared/ipc";

/**
 * 主窗/设置窗 preload（沙箱模式：仅 contextBridge + ipcRenderer）。
 * 向渲染层暴露 window.boxkit。
 */
const api = {
  // 搜索
  query: (text: string) => ipcRenderer.invoke(IPC.searchQuery, text),
  execute: (result: unknown) => ipcRenderer.invoke(IPC.searchExecute, result),
  hide: () => ipcRenderer.send(IPC.searchHide),
  openSettings: () => ipcRenderer.send(IPC.uiOpenSettings),
  sendInput: (text: string) => ipcRenderer.send(IPC.searchInput, text),
  onInputCommand: (cb: (command: string, value?: unknown) => void) => {
    const bind = (channel: string) => {
      const l = (_unknown: unknown, value?: unknown) => cb(channel, value);
      ipcRenderer.on(channel, l);
      return () => ipcRenderer.removeListener(channel, l);
    };
    const offs = [
      bind(IPC.searchSetInput),
      bind(IPC.searchInputFocus),
      bind(IPC.searchInputSelect),
      bind(IPC.searchInputBlur),
    ];
    return () => offs.forEach((off) => off());
  },
  exitPlugin: () => ipcRenderer.send(IPC.pluginExit),
  onPluginState: (cb: (s: unknown) => void) => {
    const l = (_: unknown, s: unknown) => cb(s);
    ipcRenderer.on(IPC.pluginState, l);
    return () => ipcRenderer.removeListener(IPC.pluginState, l);
  },
  onPluginChanged: (cb: () => void) => {
    const l = () => cb();
    ipcRenderer.on(IPC.pluginChanged, l);
    return () => ipcRenderer.removeListener(IPC.pluginChanged, l);
  },
  onToast: (cb: (msg: string) => void) => {
    const l = (_: unknown, msg: unknown) => cb(msg as string);
    ipcRenderer.on(IPC.uiToast, l);
    return () => ipcRenderer.removeListener(IPC.uiToast, l);
  },
  onSettingsShowTab: (cb: (payload: unknown) => void) => {
    const l = (_unknown: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(IPC.settingsShowTab, l);
    return () => ipcRenderer.removeListener(IPC.settingsShowTab, l);
  },
  onInstallPreview: (cb: (payload: unknown) => void) => {
    const l = (_unknown: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(IPC.settingsInstallPreview, l);
    return () => ipcRenderer.removeListener(IPC.settingsInstallPreview, l);
  },

  // 配置
  configGet: () => ipcRenderer.invoke(IPC.configGet),
  configSet: (patch: unknown) => ipcRenderer.invoke(IPC.configSet, patch),

  // 插件管理
  plugins: {
    list: () => ipcRenderer.invoke(IPC.pluginList),
    installPreview: () => ipcRenderer.invoke(IPC.pluginInstallPreview),
    installConfirm: (stagingId: string) => ipcRenderer.invoke(IPC.pluginInstallConfirm, stagingId),
    enable: (name: string) => ipcRenderer.send(IPC.pluginEnable, name),
    disable: (name: string) => ipcRenderer.send(IPC.pluginDisable, name),
    uninstall: (name: string) => ipcRenderer.invoke(IPC.pluginUninstall, name),
    addDevPath: () => ipcRenderer.invoke(IPC.pluginAddDevPath),
    removeDevPath: (dir: string) => ipcRenderer.send(IPC.pluginRemoveDevPath, dir),
  },

  // 插件市场
  market: {
    fetch: (keyword: string) => ipcRenderer.invoke(IPC.marketFetch, keyword),
    install: (pluginId: string) => ipcRenderer.invoke(IPC.marketInstall, pluginId),
  },

  // 更新
  updaterState: () => ipcRenderer.invoke(IPC.updaterState),
  checkUpdate: () => ipcRenderer.invoke(IPC.updaterCheck),
  installUpdate: () => ipcRenderer.send(IPC.updaterInstall),
  onUpdateEvent: (cb: (s: unknown) => void) => {
    const l = (_: unknown, s: unknown) => cb(s);
    ipcRenderer.on(IPC.updaterEvent, l);
    return () => ipcRenderer.removeListener(IPC.updaterEvent, l);
  },

  // 应用
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  quit: () => ipcRenderer.send(IPC.appQuit),
  openLogs: () => ipcRenderer.send(IPC.appOpenLogs),
};

contextBridge.exposeInMainWorld("boxkit", api);
