import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { configPath } from "./paths.js";
import { logger } from "./logger.js";
import type { AppSettings } from "@boxkit/shared";

export const CONFIG_SCHEMA_VERSION = 1;

function defaults(): AppSettings {
  return {
    hotkey: process.platform === "darwin" ? "Option+Space" : "Alt+Space",
    autostart: false,
    sentryEnabled: false,
    updateFeed: null,
    firstLaunchAt: Date.now(),
    disabledPlugins: [],
    devPluginPaths: [],
    marketUrl: null,
    pinnedIds: [],
    clipboardHistoryEnabled: false,
    clipboardHistoryLimit: 50,
    pluginHotkeys: {},
  };
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Write a JSON document without exposing a partially-written target. The backup
 * is rotated before the final rename, so a failed write leaves the old target
 * in place and an additional recovery copy beside it.
 */
export function writeJsonAtomically(file: string, value: unknown): void {
  const dir = path.dirname(file);
  const temp = `${file}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  const backup = `${file}.bak`;
  const backupPrevious = `${file}.bak.1`;
  let fd: number | null = null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fd = fs.openSync(temp, "wx", 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;

    if (fs.existsSync(file)) {
      if (fs.existsSync(backup)) {
        fs.rmSync(backupPrevious, { force: true });
        fs.renameSync(backup, backupPrevious);
      }
      fs.copyFileSync(file, backup);
    }
    fs.renameSync(temp, file);
    try {
      const dirFd = fs.openSync(dir, "r");
      try {
        fs.fsyncSync(dirFd);
      } finally {
        fs.closeSync(dirFd);
      }
    } catch {
      // Directory fsync is not available on every supported platform.
    }
  } catch (error) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore cleanup errors */
      }
    }
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

/** Move an unreadable document aside without deleting the original on failure. */
export function quarantineJsonFile(file: string, reason = "invalid"): string | null {
  if (!fs.existsSync(file)) return null;
  const cleanReason = reason.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 32) || "invalid";
  const quarantined = `${file}.quarantine-${cleanReason}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  try {
    fs.renameSync(file, quarantined);
    return quarantined;
  } catch (error) {
    logger.warn("config", `隔离文件失败: ${file}`, error);
    return null;
  }
}

/**
 * Apply migrations one version at a time. Version zero is the legacy flat
 * config format (it had no schemaVersion); v1 keeps that shape and only adds
 * the version marker so old installations remain readable.
 */
export function migrateConfig(input: unknown): JsonObject {
  if (!isJsonObject(input)) throw new Error("配置根节点必须是对象");
  const rawVersion = input.schemaVersion;
  let version: number = rawVersion === undefined ? 0 : rawVersion as number;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
    throw new Error("配置 schemaVersion 无效");
  }
  if (version > CONFIG_SCHEMA_VERSION) {
    throw new Error(`配置版本 ${version} 高于当前版本 ${CONFIG_SCHEMA_VERSION}`);
  }

  const data: JsonObject = { ...input };
  while (version < CONFIG_SCHEMA_VERSION) {
    if (version === 0) {
      // Legacy files already use the current setting keys. Keep unknown keys
      // for forward compatibility; runtime validation below selects known keys.
      version = 1;
      continue;
    }
    throw new Error(`缺少配置迁移 ${version} -> ${version + 1}`);
  }
  data.schemaVersion = CONFIG_SCHEMA_VERSION;
  return data;
}

function stringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .slice(0, max);
}

function stringMap(value: unknown, appKeysOnly = false): Record<string, string> {
  if (!isJsonObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) =>
        (!appKeysOnly || key.startsWith("app:")) && typeof item === "string" && item.trim(),
      )
      .map(([key, item]) => [key, (item as string).trim()]),
  );
}

function normalizeSettings(raw: JsonObject): AppSettings {
  const result = defaults();
  if (typeof raw.hotkey === "string" && raw.hotkey.trim()) result.hotkey = raw.hotkey.trim();
  if (typeof raw.autostart === "boolean") result.autostart = raw.autostart;
  if (typeof raw.sentryEnabled === "boolean") result.sentryEnabled = raw.sentryEnabled;
  if (raw.updateFeed === null) result.updateFeed = null;
  else if (typeof raw.updateFeed === "string") result.updateFeed = raw.updateFeed.trim() || null;
  if (typeof raw.firstLaunchAt === "number" && Number.isFinite(raw.firstLaunchAt)) {
    result.firstLaunchAt = raw.firstLaunchAt;
  }
  result.disabledPlugins = stringArray(raw.disabledPlugins, 500);
  result.devPluginPaths = stringArray(raw.devPluginPaths, 100);
  if (raw.marketUrl === null) result.marketUrl = null;
  else if (typeof raw.marketUrl === "string") result.marketUrl = raw.marketUrl.trim() || null;
  result.pinnedIds = stringArray(raw.pinnedIds, 500);
  if (typeof raw.clipboardHistoryEnabled === "boolean") {
    result.clipboardHistoryEnabled = raw.clipboardHistoryEnabled;
  }
  if (typeof raw.clipboardHistoryLimit === "number" && Number.isFinite(raw.clipboardHistoryLimit)) {
    result.clipboardHistoryLimit = Math.max(1, Math.min(200, Math.floor(raw.clipboardHistoryLimit)));
  }
  result.pluginHotkeys = Object.fromEntries(
    Object.entries(stringMap(raw.pluginHotkeys)).filter(([key]) => /^plugin:[^:]+:[^:]+$/.test(key)),
  );
  return result;
}

function persistedSettings(data: AppSettings): JsonObject {
  return { schemaVersion: CONFIG_SCHEMA_VERSION, ...data };
}

function readJsonObject(file: string): JsonObject {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!isJsonObject(parsed)) throw new Error("JSON 根节点必须是对象");
  return parsed;
}

 type Listener = (s: AppSettings) => void;

/** 应用设置存储：userData/config.json，防抖落盘 + 变更监听。 */
export class SettingsStore {
  private data: AppSettings = defaults();
  private saveTimer: NodeJS.Timeout | null = null;
  private listeners = new Set<Listener>();

  load(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const file = configPath();
    let needsSave = false;
    try {
      const raw = readJsonObject(file);
      const migrated = migrateConfig(raw);
      this.data = normalizeSettings(migrated);
      needsSave = JSON.stringify(raw) !== JSON.stringify(persistedSettings(this.data));
    } catch (error) {
      if (fs.existsSync(file)) {
        logger.warn("config", "配置读取或迁移失败，已隔离原文件", error);
        quarantineJsonFile(file, "load-failed");
      }
      const backup = `${file}.bak`;
      if (fs.existsSync(backup)) {
        try {
          const migrated = migrateConfig(readJsonObject(backup));
          this.data = normalizeSettings(migrated);
          needsSave = true;
          logger.warn("config", "已从 config.json.bak 恢复设置");
        } catch (backupError) {
          this.data = defaults();
          logger.warn("config", "配置备份读取失败，使用默认设置", backupError);
        }
      } else {
        this.data = defaults();
      }
    }
    if (needsSave) {
      // A failed atomic write leaves the original file (or its quarantine
      // copy) untouched; startup must remain usable even when storage fails.
      this.saveNow();
    }
  }

  get(): AppSettings {
    return { ...this.data };
  }

  set(patch: Partial<AppSettings>): AppSettings {
    this.data = { ...this.data, ...patch };
    this.scheduleSave();
    for (const l of this.listeners) l(this.get());
    return this.get();
  }

  onChange(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 200);
  }

  saveNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      writeJsonAtomically(configPath(), persistedSettings(this.data));
    } catch (e) {
      logger.error("config", "写入 config.json 失败", e);
    }
  }
}

export const settings = new SettingsStore();
