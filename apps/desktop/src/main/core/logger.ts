import path from "node:path";
import fs from "node:fs";
import { logsDir } from "./paths.js";

const LOG_FILE = () => path.join(logsDir(), "boxkit.log");

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_TAG: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: " INFO",
  warn: " WARN",
  error: "ERROR",
};

const buffer: string[] = [];
let fileReady = false;

/** logsDir 就绪后调用，把启动早期日志刷入文件 */
export function markLogFileReady(): void {
  fileReady = true;
}

function writeLine(line: string): void {
  if (!fileReady) {
    buffer.push(line);
    if (buffer.length > 500) buffer.shift();
    return;
  }
  try {
    fs.appendFileSync(LOG_FILE(), line + "\n");
  } catch {
    /* 日志写入失败不影响主流程 */
  }
}

function log(level: LogLevel, tag: string, ...args: unknown[]): void {
  const line = `[${new Date().toISOString()}] [${LEVEL_TAG[level]}] [${tag}] ${args
    .map((a) =>
      a instanceof Error
        ? a.stack ?? a.message
        : typeof a === "string"
          ? a
          : JSON.stringify(a) ?? String(a),
    )
    .join(" ")}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  writeLine(line);
}

export function flushBufferedLogs(): void {
  if (!fileReady || !buffer.length) return;
  try {
    fs.appendFileSync(LOG_FILE(), buffer.join("\n") + "\n");
    buffer.length = 0;
  } catch {
    /* ignore */
  }
}

export const logger = {
  debug: (tag: string, ...a: unknown[]) => log("debug", tag, ...a),
  info: (tag: string, ...a: unknown[]) => log("info", tag, ...a),
  warn: (tag: string, ...a: unknown[]) => log("warn", tag, ...a),
  error: (tag: string, ...a: unknown[]) => log("error", tag, ...a),
};
