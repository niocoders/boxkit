import { BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell } from "electron";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  IPC,
  type ConfigSetResult,
  type InstallPreview,
  type SearchResult,
} from "@boxkit/shared";
import { logger } from "./core/logger.js";
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
import { applyHotkey, unregisterAll } from "./services/hotkey.js";
import { applyAutostart } from "./services/autostart.js";
import { getMainWindow } from "./windows/mainWindow.js";
import { showMainWindow } from "./windows/mainWindow.js";
import { getSettingsWindow, openSettingsWindow, queueSettingsShowTab } from "./windows/settingsWindow.js";

const execFileP = promisify(execFile);

const WEB_ENGINES: Record<string, (q: string) => string> = {
  google: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  baidu: (q) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`,
};

function engineDeps(): EngineDeps {
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

export interface IpcDeps {
  pluginHost: PluginHost;
  onQuitRequest: () => void;
}

export function registerIpc(deps: IpcDeps): void {
  const { pluginHost } = deps;

  // ————— 搜索 —————
  ipcMain.handle(IPC.searchQuery, (_e, text: string): SearchResult[] =>
    searchQuery(String(text ?? ""), engineDeps()),
  );

  ipcMain.handle(IPC.favoritesGet, () => ({ ids: getPinnedIds() }));
  ipcMain.handle(IPC.favoritesPin, (_e, id: unknown) => {
    const ids = pin(String(id ?? ""));
    sendToMainWindow(IPC.searchDataChanged, null);
    return { ids };
  });
  ipcMain.handle(IPC.favoritesUnpin, (_e, id: unknown) => {
    const ids = unpin(String(id ?? ""));
    sendToMainWindow(IPC.searchDataChanged, null);
    return { ids };
  });

  ipcMain.handle(IPC.clipboardHistoryQuery, (_e, query: unknown) => {
    const input = query && typeof query === "object" ? query as { text?: unknown; limit?: unknown } : {};
    return clipboardHistoryProvider.getItems({
      text: typeof input.text === "string" ? input.text : undefined,
      limit: typeof input.limit === "number" ? input.limit : undefined,
    });
  });
  ipcMain.handle(IPC.clipboardHistoryCapture, (_e, capture: unknown) => {
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
  ipcMain.handle(IPC.clipboardHistoryClear, () => {
    clipboardHistoryProvider.clear();
    sendToMainWindow(IPC.clipboardHistoryChanged, null);
    return { ok: true };
  });

  ipcMain.handle(IPC.searchExecute, async (_e, result: SearchResult) => {
    if (!result || typeof result.id !== "string") return { ok: false };
    try {
      usageRecord(result.id);
      switch (result.kind) {
        case "app": {
          if (!result.id.startsWith("app:")) return { ok: false };
          const appPath = result.id.slice(4);
          const error = process.platform === "linux"
            ? await execFileP("gio", ["launch", appPath], { timeout: 5000 }).then(() => null).catch((err: unknown) => String(err))
            : await shell.openPath(appPath);
          if (error) return { ok: false, message: error };
          return { ok: true };
        }
        case "file": {
          const filePath = result.filePath ?? (result.id.startsWith("file:") ? result.id.slice(5) : "");
          if (!filePath) return { ok: false, message: "文件路径无效" };
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
          pluginHost.openPlugin(p, {
            code: feature.code,
            type: result.cmdType ?? "text",
            payload: result.payload ?? result.webQuery ?? "",
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

  ipcMain.on(IPC.searchHide, () => getMainWindow()?.hide());
  ipcMain.on(IPC.uiOpenSettings, () => openSettingsWindow());
  ipcMain.on(IPC.searchInput, (_e, text: string) => pluginHost.forwardSubInput(String(text ?? "")));
  ipcMain.on(IPC.pluginExit, () => pluginHost.outPlugin());

  // ————— 配置 —————
  ipcMain.handle(IPC.configGet, () => settings.get());
  ipcMain.handle(IPC.configSet, (_e, patch: Record<string, unknown>): ConfigSetResult => {
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
    const next = settings.set(safe);
    const hotkey = applyHotkey(toggleViaHotkey);
    applyAutostart();
    return { settings: next, hotkeyError: hotkey.error };
  });

  // ————— 插件市场 —————
  ipcMain.handle(IPC.marketFetch, (_e, keyword: unknown) =>
    marketService.fetchMarket(typeof keyword === "string" ? keyword : ""),
  );
  ipcMain.handle(IPC.marketInstall, async (_e, pluginId: unknown) => {
    const preview = await marketService.installFromMarket(String(pluginId ?? ""));
    if (!preview) return null;
    return preview;
  });

  // ————— 插件管理 —————
  ipcMain.handle(IPC.pluginList, () => pluginManager.list());

  ipcMain.handle(IPC.pluginInstallPreview, async () => {
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
      logo: staged.logoDataUrl,
    };
    return { preview, conflict: staged.conflict };
  });

  ipcMain.handle(IPC.pluginInstallConfirm, async (_e, stagingId: string, options?: { cancel?: boolean }) => {
    if (options?.cancel) {
      discardInstall(String(stagingId));
      return { ok: true };
    }
    const manifest = await commitInstall(String(stagingId));
    pluginManager.reloadAll();
    pluginHost.destroyView(manifest.name);
    logger.info("ipc", `插件安装完成: ${manifest.name}`);
    return { ok: true, name: manifest.name };
  });

  ipcMain.on(IPC.pluginEnable, (_e, name: string) => {
    pluginManager.setEnabled(String(name), true);
    pluginHost.destroyView(String(name));
  });
  ipcMain.on(IPC.pluginDisable, (_e, name: string) => {
    pluginManager.setEnabled(String(name), false);
    pluginHost.destroyView(String(name));
  });
  ipcMain.handle(IPC.pluginUninstall, (_e, name: string) => {
    const pluginName = String(name);
    const current = pluginManager.get(pluginName);
    if (!current) return { ok: false, error: "插件不存在" };
    if (current.source === "dev") return { ok: false, error: "开发插件请在设置中移除开发目录" };
    pluginHost.destroyView(pluginName);
    pluginManager.clearPluginData(pluginName);
    pluginManager.uninstall(pluginName);
    return { ok: true };
  });
  ipcMain.handle(IPC.pluginAddDevPath, async () => {
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
  ipcMain.on(IPC.pluginRemoveDevPath, (_e, dir: string) => {
    const target = String(dir);
    const p = pluginManager.all().find((plugin) => plugin.source === "dev" && plugin.dir === target);
    if (p) pluginHost.destroyView(p.manifest.name);
    pluginManager.removeDevPath(target);
  });

  // ————— 更新 —————
  ipcMain.handle(IPC.updaterState, () => updaterState());
  ipcMain.handle(IPC.updaterCheck, () => checkForUpdates(false));
  ipcMain.on(IPC.updaterInstall, () => installUpdate());
  onUpdateEvent((s) => {
    sendToSettings(IPC.updaterEvent, s);
    if (s.status === "downloaded") toast(`新版本 ${s.info?.version} 已就绪，重启后生效`);
  });

  // ————— 应用 —————
  ipcMain.handle(IPC.appInfo, () => hostInfo());
  ipcMain.on(IPC.appQuit, () => deps.onQuitRequest());
  ipcMain.on(IPC.appOpenLogs, () => void shell.openPath(logsDir()));

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
