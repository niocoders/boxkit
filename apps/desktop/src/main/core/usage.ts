import fs from "node:fs";
import path from "node:path";
import { userDataDir } from "./paths.js";
import { logger } from "./logger.js";
import { quarantineJsonFile, writeJsonAtomically } from "./config.js";

/**
 * 使用频率统计：用得越多越靠前；空面板展示「最近使用」。
 * 数据落在 userData/usage.json，内存缓存 + 防抖落盘。
 */
export interface UsageEntry {
  count: number;
  last: number;
}

export const USAGE_SCHEMA_VERSION = 1;
const MAX_ENTRIES = 2000;
const FLUSH_MS = 1500;

type UsageData = Record<string, UsageEntry>;

let data: UsageData = {};
let loaded = false;
let flushTimer: NodeJS.Timeout | null = null;

function file(): string {
  return path.join(userDataDir(), "usage.json");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeUsage(value: unknown): UsageData {
  if (!isObject(value)) throw new Error("usage 数据根节点必须是对象");
  const result: UsageData = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!isObject(entry)) continue;
    const count = entry.count;
    const last = entry.last;
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0) continue;
    if (typeof last !== "number" || !Number.isFinite(last) || last < 0) continue;
    result[id] = { count, last };
    if (Object.keys(result).length >= MAX_ENTRIES) break;
  }
  return result;
}

/** Read legacy flat usage data or the current versioned envelope. */
export function migrateUsage(input: unknown): UsageData {
  if (!isObject(input)) throw new Error("usage 数据根节点必须是对象");
  if (input.schemaVersion === undefined) return normalizeUsage(input);
  if (input.schemaVersion !== USAGE_SCHEMA_VERSION) {
    throw new Error(`usage schemaVersion 不支持: ${String(input.schemaVersion)}`);
  }
  return normalizeUsage(input.entries);
}

function persistedUsage(): { schemaVersion: number; entries: UsageData } {
  return { schemaVersion: USAGE_SCHEMA_VERSION, entries: data };
}

function readUsage(filePath: string): UsageData {
  return migrateUsage(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

function load(): void {
  if (loaded) return;
  loaded = true;
  const current = file();
  let needsSave = false;
  try {
    const raw = JSON.parse(fs.readFileSync(current, "utf8")) as unknown;
    data = migrateUsage(raw);
    needsSave = !isObject(raw) || raw.schemaVersion !== USAGE_SCHEMA_VERSION;
  } catch (error) {
    if (fs.existsSync(current)) {
      logger.warn("usage", "usage.json 损坏，已隔离原文件", error);
      quarantineJsonFile(current, "usage-load-failed");
    }
    try {
      if (fs.existsSync(`${current}.bak`)) {
        data = readUsage(`${current}.bak`);
        needsSave = true;
        logger.warn("usage", "已从 usage.json.bak 恢复");
      } else {
        data = {};
      }
    } catch (backupError) {
      data = {};
      logger.warn("usage", "usage 备份不可用，使用空数据", backupError);
    }
  }
  if (needsSave) {
    try {
      writeJsonAtomically(current, persistedUsage());
    } catch (error) {
      logger.warn("usage", "usage.json 迁移写入失败", error);
    }
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      writeJsonAtomically(file(), persistedUsage());
    } catch (e) {
      logger.warn("usage", "usage.json 写入失败", e);
    }
  }, FLUSH_MS);
}

export function usageRecord(id: string): void {
  if (!id) return;
  load();
  const now = Date.now();
  const cur = data[id];
  data[id] = { count: (cur?.count ?? 0) + 1, last: now };
  // 容量控制：淘汰最久未用的一半
  const keys = Object.keys(data);
  if (keys.length > MAX_ENTRIES) {
    const sorted = keys.sort((a, b) => (data[a]?.last ?? 0) - (data[b]?.last ?? 0));
    for (const k of sorted.slice(0, keys.length - MAX_ENTRIES / 2)) delete data[k];
  }
  scheduleFlush();
}

export function usageAll(): UsageData {
  load();
  return data;
}

/** before-quit 时同步落盘 */
export function usageFlush(): void {
  if (!loaded) return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  try {
    writeJsonAtomically(file(), persistedUsage());
  } catch (error) {
    logger.warn("usage", "usage.json 写入失败", error);
  }
}
