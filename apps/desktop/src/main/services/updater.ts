import { app } from "electron";
import os from "node:os";
import { autoUpdater } from "electron-updater";
import type { UpdateState } from "@boxkit/shared";
import { settings } from "../core/config.js";
import { logger } from "../core/logger.js";

/**
 * 内置默认更新源（占位域名，商用时替换为自有服务器）。
 * 支持 ${os}/${arch}/${version} 模板变量；可用设置页 updateFeed 或
 * 环境变量 BOXKIT_UPDATE_URL 覆盖（本地测试用 tools/update-server）。
 */
const DEFAULT_FEED = "https://updates.boxkit.app/${os}/${arch}";
const TEMPLATE = /\$\{(os|arch|version)\}/g;

export const SMOKING = !!process.env.BOXKIT_SMOKE;

type Listener = (s: UpdateState) => void;
const listeners = new Set<Listener>();
let state: UpdateState = { status: "idle" };
let initialized = false;

function feedUrl(): string {
  const tpl = settings.get().updateFeed || process.env.BOXKIT_UPDATE_URL || DEFAULT_FEED;
  return tpl.replace(TEMPLATE, (_, key: string) => {
    switch (key) {
      case "os":
        return process.platform === "darwin" ? "mac" : process.platform;
      case "arch":
        return process.arch;
      case "version":
        return app.getVersion();
      default:
        return "";
    }
  });
}

function setState(patch: UpdateState): void {
  state = { ...state, ...patch };
  for (const l of listeners) l(state);
}

export function onUpdateEvent(l: Listener): () => void {
  listeners.add(l);
  l(state);
  return () => listeners.delete(l);
}

export function updaterState(): UpdateState {
  return { ...state, feedUrl: feedUrl() };
}

export function initUpdater(): void {
  if (initialized || SMOKING) return;
  initialized = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (...a: unknown[]) => logger.info("updater", ...a),
    warn: (...a: unknown[]) => logger.warn("updater", ...a),
    error: (...a: unknown[]) => logger.error("updater", ...a),
    debug: () => {},
  };

  autoUpdater.on("checking-for-update", () => setState({ status: "checking" }));
  autoUpdater.on("update-available", (info) =>
    setState({ status: "available", info: { version: info.version ?? "?" } }),
  );
  autoUpdater.on("update-not-available", (info) =>
    setState({ status: "not-available", info: { version: info.version ?? app.getVersion() } }),
  );
  autoUpdater.on("download-progress", (p) =>
    setState({ status: "downloading", progress: Math.round(p.percent) }),
  );
  autoUpdater.on("update-downloaded", (info) =>
    setState({ status: "downloaded", info: { version: info.version ?? "?" } }),
  );
  autoUpdater.on("error", (e) =>
    setState({ status: "error", error: e?.message ?? String(e) }),
  );

  // 启动后静默检查一次（延迟 10s 避免抢占启动性能）
  if (settings.get().updateFeed !== null || process.env.BOXKIT_UPDATE_URL) {
    setTimeout(() => void checkForUpdates(true), 10_000);
  }
}

export async function checkForUpdates(silent = false): Promise<UpdateState> {
  if (SMOKING) return updaterState();
  try {
    autoUpdater.setFeedURL({
      provider: "generic",
      url: feedUrl(),
      channel: "latest",
    });
    setState({ status: "checking" });
    await autoUpdater.checkForUpdates();
  } catch (e) {
    logger.warn("updater", "检查更新失败", e);
    if (!silent) setState({ status: "error", error: e instanceof Error ? e.message : String(e) });
  }
  return updaterState();
}

export function installUpdate(): void {
  if (state.status === "downloaded") {
    autoUpdater.quitAndInstall(false, true);
  }
}

export function hostInfo() {
  return {
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: `${process.platform}/${process.arch}`,
    osRelease: os.release(),
  };
}
