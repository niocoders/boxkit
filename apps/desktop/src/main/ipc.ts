import { BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell } from "electron";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  IPC,
  isIpcRoleAllowed,
  ipcRoleForUrl,
  type IpcRole,
  type ConfigSetResult,
  type InputPayload,
  type PluginCommandType,
  type InstallPreview,
  type SearchResult,
  type SettingsRoute,
} from "@boxkit/shared";
import { logger } from "./core/logger.js";
import { getPluginSecurityMode } from "@boxkit/shared/manifest";
import { settings } from "./core/config.js";
import { logsDir } from "./core/paths.js";
import { usageAll, usageRecord } from "./core/usage.js";
import { marketService } from "./services/market.js";
import { appProvider } from "./providers/apps.js";
import { getSystemCommands, runSystemCommand } from "./providers/commands.js";
import { searchQuery, type EngineDeps } from "./providers/searchEngine.js";
import { fileProvider } from "./providers/files.js";
import { clipboardHistoryProvider } from "./providers/clipboardHistory.js";
import { getPinnedIds, pin, unpin } from "./providers/favorites.js";
import { pluginManager } from "./plugins/manager.js";
import { stageInstall, commitInstall, discardInstall } from "./plugins/staging.js";
import type { PluginHost } from "./plugins/host.js";
import { checkForUpdates, installUpdate, onUpdateEvent, updaterState, hostInfo } from "./services/updater.js";
import { applyConfiguredHotkeys, unregisterAll, setExtraHotkeyHandlers } from "./services/hotkey.js";
import { applyAutostart } from "./services/autostart.js";
import { getMainWindow } from "./windows/mainWindow.js";
import { showMainWindow } from "./windows/mainWindow.js";
import { getSettingsWindow, openSettingsWindow, queueSettingsShowTab, markSettingsReady } from "./windows/settingsWindow.js";
import {
  detachPluginWindow,
  reattachPluginWindow,
  getDetachedWindow,
  detachStateForWindow,
  findDetachedHostBySender,
  updateDetachedWindowState,
} from "./windows/pluginDetachWindow.js";

const execFileP = promisify(execFile);
let configuredHotkeySync: (() => string | null) | null = null;

export function refreshConfiguredHotkeys(): string | null {
  return configuredHotkeySync?.() ?? null;
}

const WEB_ENGINES: Record<string, (q: string) => string> = {
  google: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  baidu: (q) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`,
};

function engineDeps(input?: InputPayload): EngineDeps {
  return {
    apps: appProvider.getApps(),
    commands: getSystemCommands(),
    features: pluginManager.enabledPlugins().flatMap((p) =>
      p.manifest.features.map((f) => ({
        pluginId: p.manifest.name,
        displayName: p.manifest.displayName,
        logo: p.logoDataUrl,
        feature: f,
      })),
    ),
    files: fileProvider.getFiles(),
    clipboard: clipboardHistoryProvider.getItems({ limit: settings.get().clipboardHistoryLimit }),
    pinnedIds: getPinnedIds(),
    usage: usageAll(),
    input,
  };
}

export function sendToMainWindow(channel: string, payload: unknown): void {
  getMainWindow()?.webContents.send(channel, payload);
}

export function sendToSettings(channel: string, payload: unknown): void {
  getSettingsWindow()?.webContents.send(channel, payload);
}

export function toast(msg: string): void {
  sendToMainWindow(IPC.uiToast, msg);
}

function senderRole(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): IpcRole | null {
  return ipcRoleForUrl(event.sender.getURL());
}

function requireRole(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent, channel: string): boolean {
  const role = senderRole(event);
  if (!role || !isIpcRoleAllowed(role, channel)) {
    logger.warn("ipc", `拒绝未授权 IPC: ${channel}`);
    return false;
  }
  return true;
}

type InvokeListener = (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any;
type EventListener = (event: Electron.IpcMainEvent, ...args: any[]) => void;

function guardedHandle(channel: string, listener: InvokeListener): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!requireRole(event, channel)) return { ok: false, code: "FORBIDDEN", message: "IPC 调用者无权执行此操作" };
    return listener(event, ...args);
  });
}

function guardedOn(channel: string, listener: EventListener): void {
  ipcMain.on(channel, (event, ...args) => {
    if (!requireRole(event, channel)) return;
    listener(event, ...args);
  });
}

export interface IpcDeps {
  pluginHost: PluginHost;
  onQuitRequest: () => void;
}

export function registerIpc(deps: IpcDeps): void {
  const { pluginHost } = deps;

  // ————— 搜索 —————
  guardedOn(IPC.settingsReady, () => {
    markSettingsReady();
  });

  guardedHandle(IPC.searchQuery, (_e, text: string | InputPayload): SearchResult[] =>
    searchQuery(text, engineDeps(typeof text === "string" ? undefined : text)),
  );

  guardedHandle(IPC.favoritesGet, () => ({ ids: getPinnedIds() }));
  guardedHandle(IPC.favoritesPin, (_e, id: unknown) => {
    const ids = pin(String(id ?? ""));
    sendToMainWindow(IPC.searchDataChanged, null);
    return { ids };
  });
  guardedHandle(IPC.favoritesUnpin, (_e, id: unknown) => {
    const ids = unpin(String(id ?? ""));
    sendToMainWindow(IPC.searchDataChanged, null);
    return { ids };
  });

  guardedHandle(IPC.clipboardHistoryQuery, (_e, query: unknown) => {
    const input = query && typeof query === "object" ? query as { text?: unknown; limit?: unknown } : {};
    return clipboardHistoryProvider.getItems({
      text: typeof input.text === "string" ? input.text : undefined,
      limit: typeof input.limit === "number" ? input.limit : undefined,
    });
  });
  guardedHandle(IPC.clipboardHistoryCapture, (_e, capture: unknown) => {
    if (!capture || typeof capture !== "object") return null;
    const value = capture as { text?: unknown; paths?: unknown; image?: unknown };
    const item = clipboardHistoryProvider.capture({
      text: typeof value.text === "string" ? value.text : undefined,
      paths: Array.isArray(value.paths) ? value.paths.filter((p): p is string => typeof p === "string") : undefined,
      image: value.image instanceof Uint8Array ? value.image : undefined,
    });
    if (item) sendToMainWindow(IPC.clipboardHistoryChanged, null);
    return item;
  });
  guardedHandle(IPC.clipboardHistoryClear, () => {
    clipboardHistoryProvider.clear();
    sendToMainWindow(IPC.clipboardHistoryChanged, null);
    return { ok: true };
  });

  guardedHandle(IPC.searchExecute, async (_e, result: SearchResult) => {
    if (!result || typeof result.id !== "string") return { ok: false };
    try {
      usageRecord(result.id);
      switch (result.kind) {
        case "app": {
          if (!result.id.startsWith("app:")) return { ok: false };
          const appPath = result.id.slice(4);
          if (!appProvider.getApps().some((app) => app.path === appPath)) {
            return { ok: false, message: "应用已不存在，请刷新索引" };
          }
          const error = process.platform === "linux"
            ? await execFileP("gio", ["launch", appPath], { timeout: 5000 }).then(() => null).catch((err: unknown) => String(err))
            : await shell.openPath(appPath);
          if (error) return { ok: false, message: error };
          return { ok: true };
        }
        case "file": {
          const filePath = result.id.startsWith("file:") ? result.id.slice(5) : "";
          if (!filePath || !fileProvider.getFiles().some((file) => file.path === filePath)) return { ok: false, message: "文件已不存在，请刷新索引" };
          const error = await shell.openPath(filePath);
          return error ? { ok: false, message: error } : { ok: true };
        }
        case "clipboard": {
          const item = clipboardHistoryProvider.getItems({ limit: 200 }).find((entry) => entry.id === result.clipboardId);
          if (!item) return { ok: false, message: "剪贴板内容已过期" };
          if (item.kind === "text") clipboard.writeText(item.text ?? "");
          else if (item.kind === "image" && item.imageDataUrl) {
            const image = nativeImage.createFromDataURL(item.imageDataUrl);
            if (image.isEmpty()) return { ok: false, message: "剪贴板图片已损坏" };
            (clipboard as unknown as { writeImage(image: Electron.NativeImage): void }).writeImage(image);
          } else if (item.kind === "file") {
            clipboard.writeText((item.paths ?? []).join("\n"));
          }
          return { ok: true };
        }
        case "command": {
          const id = result.id.startsWith("cmd:") ? result.id.slice(4) : result.id;
          if (id === "settings") {
            openSettingsWindow();
            return { ok: true };
          }
          if (id === "open:market") {
            queueSettingsShowTab({ tab: "plugins", view: "market" });
            return { ok: true };
          }
          if (id === "quit") {
            deps.onQuitRequest();
            return { ok: true };
          }
          const r = await runSystemCommand(id, (cid) =>
            getSystemCommands().find((c) => c.id === cid),
          );
          if (!r.ok && r.message) toast(r.message);
          return r;
        }
        case "plugin": {
          if (!result.pluginId || !result.featureCode) return { ok: false };
          const p = pluginManager.get(result.pluginId);
          if (!p) {
            toast("插件不存在或已被卸载");
            return { ok: false };
          }
          const feature = p.manifest.features.find((f) => f.code === result.featureCode);
          if (!feature) return { ok: false };
          const payload = result.payload ?? result.queryText ?? result.webQuery ?? "";
          const input = payload && typeof payload === "object" && "type" in payload
            ? { version: 1 as const, payload: payload as InputPayload }
            : undefined;
          pluginHost.openPlugin(p, {
            code: feature.code,
            type: (result.cmdType ?? "text") as PluginCommandType,
            payload: typeof payload === "string" ? payload : JSON.stringify(payload),
            input,
          });
          return { ok: true };
        }
        case "web": {
          const engine = result.id.startsWith("web:")
            ? result.id.slice(4)
            : "google";
          const build = WEB_ENGINES[engine] ?? WEB_ENGINES.google;
          void shell.openExternal(build(result.webQuery ?? ""));
          return { ok: true };
        }
        default:
          return { ok: false };
      }
    } catch (e) {
      logger.error("ipc", "执行搜索结果失败", e);
      return { ok: false, message: String(e) };
    }
  });

  guardedOn(IPC.searchHide, () => getMainWindow()?.hide());
  guardedOn(IPC.uiOpenSettings, (_event, route: unknown) => {
    if (!route || typeof route !== "object") {
      openSettingsWindow();
      return;
    }
    const value = route as Partial<SettingsRoute>;
    const safe: SettingsRoute = { tab: typeof value.tab === "string" ? value.tab : "overview" };
    if (value.view === "installed" || value.view === "market") safe.view = value.view;
    if (typeof value.pluginId === "string" && /^[a-z0-9][a-z0-9-]*$/i.test(value.pluginId)) {
      safe.pluginId = value.pluginId;
    }
    queueSettingsShowTab(safe);
  });
  guardedOn(IPC.uiOpenProfile, () => openSettingsWindow("overview"));
  guardedOn(IPC.searchInput, (_e, text: string) => pluginHost.forwardSubInput(String(text ?? "")));
  guardedOn(IPC.pluginExit, () => pluginHost.outPlugin());

  guardedHandle(IPC.overviewData, () => {
    const usage = usageAll();
    const topApps = appProvider
      .getApps()
      .map((item) => ({ name: item.name, path: item.path, icon: item.icon, count: usage[`app:${item.path}`]?.count ?? 0 }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
    return { version: hostInfo().version, firstLaunchAt: settings.get().firstLaunchAt, topApps };
  });
  guardedHandle(IPC.overviewOpenApp, async (_e, appPath: unknown) => {
    const target = String(appPath ?? "");
    if (!appProvider.getApps().some((item) => item.path === target)) return { ok: false, error: "应用不存在" };
    const error = await shell.openPath(target);
    return error ? { ok: false, error } : { ok: true };
  });

  // ————— 已安装应用列表（插件模式拖拽兼容） —————
  guardedHandle(IPC.appsList, () =>
    appProvider.getApps().map((item) => ({ name: item.name, path: item.path, icon: item.icon })),
  );

  // ————— 插件脱离为独立窗口 —————
  guardedHandle(IPC.pluginDetach, (_e, pluginName: unknown) => {
    const name = String(pluginName ?? "");
    if (!pluginManager.get(name)) return { ok: false, error: "插件不存在" };
    if (getDetachedWindow(name)) return { ok: true, detached: true };
    const ok = detachPluginWindow(pluginHost, name);
    return ok ? { ok: true, detached: true } : { ok: false, error: "无法脱离主窗口" };
  });
  guardedHandle(IPC.pluginReattach, (_e, pluginName: unknown) => {
    const name = String(pluginName ?? "");
    const ok = reattachPluginWindow(pluginHost, name);
    return { ok, detached: false };
  });

  ipcMain.handle(IPC.detachGetState, (e) => {
    const state = findDetachedHostBySender(e.sender.id);
    return state ? detachStateForWindow(state.window) : null;
  });
  ipcMain.on(IPC.detachInput, (e, value: unknown) => {
    const state = findDetachedHostBySender(e.sender.id);
    if (!state) return;
    pluginHost.forwardDetachedSubInput(state.pluginName, String(value ?? ""));
  });
  ipcMain.handle(IPC.detachReattach, (e) => {
    const state = findDetachedHostBySender(e.sender.id);
    return state ? { ok: reattachPluginWindow(pluginHost, state.pluginName) } : { ok: false };
  });
  ipcMain.handle(IPC.detachClose, (e) => {
    const state = findDetachedHostBySender(e.sender.id);
    return state ? { ok: reattachPluginWindow(pluginHost, state.pluginName) } : { ok: false };
  });
  ipcMain.handle(IPC.detachToggleAlwaysOnTop, (e) => {
    const state = findDetachedHostBySender(e.sender.id);
    return state ? updateDetachedWindowState(state.pluginName, { alwaysOnTop: !state.alwaysOnTop }) : null;
  });
  ipcMain.handle(IPC.detachSetZoom, (e, zoom: unknown) => {
    const state = findDetachedHostBySender(e.sender.id);
    return state ? updateDetachedWindowState(state.pluginName, { zoomFactor: Number(zoom) }) : null;
  });

  // ————— 配置 —————
  guardedHandle(IPC.configGet, () => settings.get());
  guardedHandle(IPC.configSet, (_e, patch: Record<string, unknown>): ConfigSetResult => {
    const safe: Record<string, unknown> = {};
    if (typeof patch.hotkey === "string") safe.hotkey = patch.hotkey;
    if (typeof patch.autostart === "boolean") safe.autostart = patch.autostart;
    if (typeof patch.sentryEnabled === "boolean") safe.sentryEnabled = patch.sentryEnabled;
    if (patch.updateFeed === null || typeof patch.updateFeed === "string") {
      safe.updateFeed = patch.updateFeed;
    }
    if (typeof patch.marketUrl === "string" || patch.marketUrl === null) {
      const value = patch.marketUrl;
      safe.marketUrl = value === null ? null : value.trim();
    }
    if (typeof patch.pinnedIds === "object" && Array.isArray(patch.pinnedIds)) {
      safe.pinnedIds = patch.pinnedIds.filter((id): id is string => typeof id === "string").slice(0, 500);
    }
    if (typeof patch.clipboardHistoryEnabled === "boolean") safe.clipboardHistoryEnabled = patch.clipboardHistoryEnabled;
    if (typeof patch.clipboardHistoryLimit === "number" && Number.isFinite(patch.clipboardHistoryLimit)) {
      safe.clipboardHistoryLimit = Math.max(1, Math.min(200, Math.floor(patch.clipboardHistoryLimit)));
    }
    if (patch.pluginHotkeys !== null && typeof patch.pluginHotkeys === "object" && !Array.isArray(patch.pluginHotkeys)) {
      const result: Record<string, string> = {};
      for (const [key, accel] of Object.entries(patch.pluginHotkeys as Record<string, unknown>)) {
        if (/^plugin:[^:]+:[^:]+$/.test(key) && typeof accel === "string" && accel.trim()) result[key] = accel.trim();
      }
      safe.pluginHotkeys = result;
    }
    const candidate = { ...settings.get(), ...safe };
    const changesHotkeys = Object.prototype.hasOwnProperty.call(safe, "hotkey")
      || Object.prototype.hasOwnProperty.call(safe, "pluginHotkeys");
    const hotkey = changesHotkeys
      ? applyConfiguredHotkeys(candidate, toggleViaHotkey)
      : { ok: true, error: null };
    if (!hotkey.ok) return { settings: settings.get(), hotkeyError: hotkey.error };
    const next = settings.set(safe);
    applyAutostart();
    return { settings: next, hotkeyError: null };
  });

  /** 依据配置与当前已启用插件注册 feature 级全局快捷键。 */
  function syncExtraHotkeys(): string | null {
    const handlers = new Map<string, () => void>();
    for (const plugin of pluginManager.enabledPlugins()) {
      for (const feature of plugin.manifest.features) {
        handlers.set(`plugin:${plugin.manifest.name}:${feature.code}`, () => {
          const win = getDetachedWindow(plugin.manifest.name);
          if (win) {
            win.show();
            win.focus();
            return;
          }
          pluginHost.openPlugin(plugin, { code: feature.code, type: "text", payload: "" });
        });
      }
    }
    return setExtraHotkeyHandlers(handlers);
  }

  configuredHotkeySync = syncExtraHotkeys;
  syncExtraHotkeys();
  pluginManager.onChange(syncExtraHotkeys);

  // ————— 插件市场 —————
  guardedHandle(IPC.marketFetch, (_e, keyword: unknown) =>
    marketService.fetchMarket(typeof keyword === "string" ? keyword : ""),
  );
  guardedHandle(IPC.marketInstall, async (_e, pluginId: unknown) => {
    const preview = await marketService.installFromMarket(String(pluginId ?? ""));
    if (!preview) return null;
    return preview;
  });

  // ————— 插件管理 —————
  guardedHandle(IPC.pluginList, () => pluginManager.list());

  guardedHandle(IPC.pluginInstallPreview, async () => {
    const parent = getSettingsWindow() ?? getMainWindow() ?? undefined;
    const picked = await dialog.showOpenDialog(parent as BrowserWindow, {
      title: "选择插件包",
      filters: [{ name: "插件包", extensions: ["bkx", "upx", "zip"] }],
      properties: ["openFile"],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    const staged = await stageInstall(picked.filePaths[0], pluginManager.installedVersions());
    const preview: InstallPreview = {
      stagingId: staged.stagingId,
      name: staged.manifest.name,
      displayName: staged.manifest.displayName,
      version: staged.manifest.version,
      description: staged.manifest.description,
      permissions: [...staged.manifest.permissions],
      securityMode: getPluginSecurityMode(staged.manifest),
      logo: staged.logoDataUrl,
    };
    return { preview, conflict: staged.conflict };
  });

  guardedHandle(IPC.pluginInstallConfirm, async (_e, stagingId: string, options?: { cancel?: boolean }) => {
    if (options?.cancel) {
      discardInstall(String(stagingId));
      return { ok: true };
    }
    const manifest = await commitInstall(String(stagingId));
    pluginManager.reloadAll();
    reattachPluginWindow(pluginHost, manifest.name);
    pluginHost.destroyView(manifest.name);
    logger.info("ipc", `插件安装完成: ${manifest.name}`);
    return { ok: true, name: manifest.name };
  });

  guardedOn(IPC.pluginEnable, (_e, name: string) => {
    pluginManager.setEnabled(String(name), true);
    pluginHost.destroyView(String(name));
  });
  guardedOn(IPC.pluginDisable, (_e, name: string) => {
    const pluginName = String(name);
    reattachPluginWindow(pluginHost, pluginName);
    pluginManager.setEnabled(pluginName, false);
    pluginHost.destroyView(pluginName);
  });
  guardedHandle(IPC.pluginUninstall, (_e, name: string) => {
    const pluginName = String(name);
    const current = pluginManager.get(pluginName);
    if (!current) return { ok: false, error: "插件不存在" };
    if (current.source === "dev") return { ok: false, error: "开发插件请在设置中移除开发目录" };
    reattachPluginWindow(pluginHost, pluginName);
    pluginHost.destroyView(pluginName);
    const pluginHotkeys = Object.fromEntries(
      Object.entries(settings.get().pluginHotkeys).filter(([key]) => !key.startsWith(`plugin:${pluginName}:`)),
    );
    settings.set({ pluginHotkeys });
    pluginManager.clearPluginData(pluginName);
    pluginManager.uninstall(pluginName);
    return { ok: true };
  });
  guardedHandle(IPC.pluginAddDevPath, async () => {
    const parent = getSettingsWindow() ?? getMainWindow() ?? undefined;
    const picked = await dialog.showOpenDialog(parent as BrowserWindow, {
      title: "选择插件开发目录（包含 plugin.json）",
      properties: ["openDirectory"],
    });
    if (picked.canceled || !picked.filePaths[0]) return { ok: false };
    try {
      pluginManager.addDevPath(picked.filePaths[0]);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  guardedOn(IPC.pluginRemoveDevPath, (_e, dir: string) => {
    const target = String(dir);
    const p = pluginManager.all().find((plugin) => plugin.source === "dev" && plugin.dir === target);
    if (p) pluginHost.destroyView(p.manifest.name);
    pluginManager.removeDevPath(target);
  });

  // ————— 更新 —————
  guardedHandle(IPC.updaterState, () => updaterState());
  guardedHandle(IPC.updaterCheck, () => checkForUpdates(false));
  guardedOn(IPC.updaterInstall, () => installUpdate());
  onUpdateEvent((s) => {
    sendToSettings(IPC.updaterEvent, s);
    if (s.status === "downloaded") toast(`新版本 ${s.info?.version} 已就绪，重启后生效`);
  });

  // ————— 应用 —————
  guardedHandle(IPC.appInfo, () => hostInfo());
  guardedOn(IPC.appQuit, () => deps.onQuitRequest());
  guardedOn(IPC.appOpenLogs, () => void shell.openPath(logsDir()));

  // ————— 插件沙箱 IPC —————
  pluginHost.registerIpc();
}

/** 快捷键切换行为：可见则隐藏，否则唤起 */
export function toggleViaHotkey(): void {
  const win = getMainWindow();
  if (win?.isVisible()) win.hide();
  else showMainWindow();
}

export { unregisterAll };
