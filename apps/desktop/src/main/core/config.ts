import fs from "node:fs";
import path from "node:path";
import { configPath } from "./paths.js";
import { logger } from "./logger.js";
import type { AppSettings } from "@boxkit/shared";

const DEFAULTS: AppSettings = {
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
};

type Listener = (s: AppSettings) => void;

/** 应用设置存储：userData/config.json，防抖落盘 + 变更监听。 */
export class SettingsStore {
  private data: AppSettings = { ...DEFAULTS };
  private saveTimer: NodeJS.Timeout | null = null;
  private listeners = new Set<Listener>();

  load(): void {
    try {
      const raw = fs.readFileSync(configPath(), "utf-8");
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      this.data = { ...DEFAULTS, ...parsed };
      // 首次启动标记只写一次
      if (typeof parsed.firstLaunchAt !== "number") {
        this.data.firstLaunchAt = Date.now();
        this.saveNow();
      }
    } catch {
      this.data = { ...DEFAULTS };
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
      fs.mkdirSync(path.dirname(configPath()), { recursive: true });
      fs.writeFileSync(configPath(), JSON.stringify(this.data, null, 2));
    } catch (e) {
      logger.error("config", "写入 config.json 失败", e);
    }
  }
}

export const settings = new SettingsStore();
