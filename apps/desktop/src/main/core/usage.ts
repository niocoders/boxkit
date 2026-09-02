import fs from "node:fs";
import path from "node:path";
import { userDataDir } from "./paths.js";
import { logger } from "./logger.js";

/**
 * 使用频率统计：用得越多越靠前；空面板展示「最近使用」。
 * 数据落在 userData/usage.json，内存缓存 + 防抖落盘。
 */
export interface UsageEntry {
  count: number;
  last: number;
}

const MAX_ENTRIES = 2000;
const FLUSH_MS = 1500;

let data: Record<string, UsageEntry> = {};
let loaded = false;
let flushTimer: NodeJS.Timeout | null = null;

function file(): string {
  return path.join(userDataDir(), "usage.json");
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = fs.readFileSync(file(), "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") data = parsed;
  } catch {
    /* 首次或损坏：从空开始 */
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      fs.writeFileSync(file(), JSON.stringify(data));
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

export function usageAll(): Record<string, UsageEntry> {
  load();
  return data;
}

/** before-quit 时同步落盘 */
export function usageFlush(): void {
  if (!loaded || !flushTimer) return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  try {
    fs.writeFileSync(file(), JSON.stringify(data));
  } catch {
    /* 尽力而为 */
  }
}
