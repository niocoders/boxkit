import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { settings } from "../core/config.js";
import { logsDir } from "../core/paths.js";
import { markLogFileReady, flushBufferedLogs, logger } from "../core/logger.js";

/**
 * 崩溃/异常上报：
 * - Sentry（@sentry/electron）需配置 DSN（环境变量 BOXKIT_SENTRY_DSN）且用户未关闭
 * - 无论是否启用 Sentry，本地始终落盘兜底日志（userData/logs/）
 */
export function initCrash(): void {
  markLogFileReady();
  flushBufferedLogs();

  const dsn = process.env.BOXKIT_SENTRY_DSN;
  const enabled = settings.get().sentryEnabled;
  if (dsn && enabled) {
    // 动态 import，未配置 DSN 时不加载 Sentry
    import("@sentry/electron/main")
      .then((Sentry) => {
        Sentry.init({
          dsn,
          release: `boxkit@${app.getVersion()}`,
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
