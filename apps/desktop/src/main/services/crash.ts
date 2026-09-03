import { app, type BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { settings } from "../core/config.js";
import { logsDir, userDataDir } from "../core/paths.js";
import { markLogFileReady, flushBufferedLogs, logger } from "../core/logger.js";
import { writeJsonAtomically } from "../core/config.js";

const HEALTH_SCHEMA_VERSION = 1;
const HEALTH_FILE = () => path.join(userDataDir(), "health.json");

interface HealthMarker {
  schemaVersion: number;
  version: string;
  cleanShutdown: boolean;
  startupAt: number;
  lastPlugin: string | null;
  rendererRecoveries: number;
  consecutiveFailures: number;
}

let initialized = false;
let cleanShutdownMarked = false;
let safeMode = false;
let temporaryDisabledPlugin: string | null = null;
let rendererRecoveryAttached = false;
let health: HealthMarker = {
  schemaVersion: HEALTH_SCHEMA_VERSION,
  version: "unknown",
  cleanShutdown: true,
  startupAt: 0,
  lastPlugin: null,
  rendererRecoveries: 0,
  consecutiveFailures: 0,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readHealth(): HealthMarker | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(HEALTH_FILE(), "utf8"));
    if (!isObject(parsed) || parsed.schemaVersion !== HEALTH_SCHEMA_VERSION) return null;
    if (typeof parsed.version !== "string" || typeof parsed.cleanShutdown !== "boolean") return null;
    return {
      schemaVersion: HEALTH_SCHEMA_VERSION,
      version: parsed.version,
      cleanShutdown: parsed.cleanShutdown,
      startupAt: typeof parsed.startupAt === "number" ? parsed.startupAt : 0,
      lastPlugin: typeof parsed.lastPlugin === "string" ? parsed.lastPlugin : null,
      rendererRecoveries:
        typeof parsed.rendererRecoveries === "number" && parsed.rendererRecoveries >= 0
          ? Math.floor(parsed.rendererRecoveries)
          : 0,
      consecutiveFailures:
        typeof parsed.consecutiveFailures === "number" && parsed.consecutiveFailures >= 0
          ? Math.floor(parsed.consecutiveFailures)
          : 0,
    };
  } catch {
    return null;
  }
}

function writeHealth(): void {
  try {
    writeJsonAtomically(HEALTH_FILE(), health);
  } catch (error) {
    logger.warn("crash", "健康标记写入失败", error);
  }
}

function temporarilyDisablePlugin(name: string | null): void {
  if (!name || temporaryDisabledPlugin) return;
  const disabled = settings.get().disabledPlugins;
  if (disabled.includes(name)) return;
  temporaryDisabledPlugin = name;
  settings.set({ disabledPlugins: [...disabled, name] });
  logger.warn("crash", `安全模式临时禁用插件: ${name}`);
}

function restoreTemporaryPlugin(): void {
  const name = temporaryDisabledPlugin;
  if (!name) return;
  temporaryDisabledPlugin = null;
  settings.set({
    disabledPlugins: settings.get().disabledPlugins.filter((plugin) => plugin !== name),
  });
  settings.saveNow();
  logger.info("crash", `已恢复安全模式临时禁用插件: ${name}`);
}

function activateSafeMode(onPlugin?: (name: string) => void): void {
  if (!safeMode) {
    safeMode = true;
    logger.warn("crash", "检测到崩溃循环，进入安全模式");
  }
  const plugin = health.lastPlugin;
  temporarilyDisablePlugin(plugin);
  if (plugin) onPlugin?.(plugin);
}

/** Whether a renderer exit is eligible for the single automatic recovery. */
export function canRecoverRenderer(reason: string, recoveries: number): boolean {
  return reason !== "clean-exit" && recoveries < 1;
}

/**
 * 崩溃/异常上报：
 * - Sentry（@sentry/electron）需配置 DSN（环境变量 BOXKIT_SENTRY_DSN）且用户未关闭
 * - 无论是否启用 Sentry，本地始终落盘兜底日志（userData/logs/）
 * - 启动健康标记在设置加载后建立，用于识别连续异常退出
 */
export function initCrash(): void {
  if (initialized) return;
  initialized = true;
  markLogFileReady();
  flushBufferedLogs();

  const version = app.getVersion();
  const previous = readHealth();
  const crashLoop = !!previous && previous.version === version && !previous.cleanShutdown;
  safeMode = crashLoop;
  health = {
    schemaVersion: HEALTH_SCHEMA_VERSION,
    version,
    cleanShutdown: false,
    startupAt: Date.now(),
    lastPlugin: previous?.lastPlugin ?? null,
    rendererRecoveries: 0,
    consecutiveFailures: crashLoop ? (previous?.consecutiveFailures ?? 0) + 1 : 0,
  };
  writeHealth();
  if (safeMode) {
    logger.warn("crash", `检测到 ${version} 的连续异常启动，进入安全模式`);
    temporarilyDisablePlugin(health.lastPlugin);
  }

  const dsn = process.env.BOXKIT_SENTRY_DSN;
  const enabled = settings.get().sentryEnabled;
  if (dsn && enabled) {
    // 动态 import，未配置 DSN 时不加载 Sentry
    import("@sentry/electron/main")
      .then((Sentry) => {
        Sentry.init({
          dsn,
          release: `boxkit@${version}`,
          environment: process.env.NODE_ENV ?? "production",
        });
        logger.info("crash", "Sentry 崩溃上报已启用");
      })
      .catch((e) => logger.warn("crash", "Sentry 初始化失败", e));
  } else {
    logger.info("crash", `Sentry 未启用(${!dsn ? "未配置DSN" : "用户已关闭"})，仅本地记录`);
  }

  process.on("uncaughtException", (err) => {
    logFatal("uncaughtException", err);
  });
  process.on("unhandledRejection", (reason) => {
    logFatal("unhandledRejection", reason instanceof Error ? reason : new Error(String(reason)));
  });
}

export function isSafeMode(): boolean {
  return safeMode;
}

/** Record the last plugin entering the main renderer before a possible crash. */
export function setLastPlugin(name: string | null): void {
  if (!initialized || !name || health.lastPlugin === name) return;
  health.lastPlugin = name;
  writeHealth();
}

/** Attach renderer recovery once. A second renderer crash activates safe mode. */
export function registerRendererRecovery(
  win: BrowserWindow,
  onPluginSafeMode?: (name: string) => void,
): () => void {
  if (rendererRecoveryAttached) return () => {};
  rendererRecoveryAttached = true;
  const handler = (_event: Electron.Event, details: { reason: string }) => {
    if (details.reason === "clean-exit") return;
    if (!safeMode && canRecoverRenderer(details.reason, health.rendererRecoveries)) {
      health.rendererRecoveries += 1;
      writeHealth();
      logger.warn("crash", `搜索窗渲染进程退出，自动恢复 (${details.reason})`);
      try {
        if (!win.isDestroyed()) win.webContents.reload();
      } catch (error) {
        logger.warn("crash", "渲染进程自动恢复失败", error);
      }
      return;
    }
    activateSafeMode(onPluginSafeMode);
  };
  win.webContents.on("render-process-gone", handler);
  return () => win.webContents.removeListener("render-process-gone", handler);
}

/** Mark a normal app quit and remove only this run's temporary plugin disable. */
export function markCleanShutdown(): void {
  if (!initialized || cleanShutdownMarked) return;
  cleanShutdownMarked = true;
  restoreTemporaryPlugin();
  health.cleanShutdown = true;
  health.lastPlugin = null;
  health.rendererRecoveries = 0;
  health.consecutiveFailures = 0;
  writeHealth();
}

function logFatal(kind: string, err: Error): void {
  logger.error("crash", `[${kind}]`, err);
  try {
    const file = path.join(logsDir(), `crash-${new Date().toISOString().slice(0, 10)}.log`);
    fs.appendFileSync(
      file,
      `[${new Date().toISOString()}] [${kind}] ${err.stack ?? err.message}\n`,
    );
  } catch {
    /* ignore */
  }
}
