import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import {
  safeParseManifest,
  type PluginListItem,
  type PluginManifest,
} from "@boxkit/shared";
import { pluginDataDir, pluginsDir, stagingDir } from "../core/paths.js";
import { logger } from "../core/logger.js";
import { settings } from "../core/config.js";
import { logoToDataUrl } from "./staging.js";

export interface LoadedPlugin {
  manifest: PluginManifest;
  dir: string;
  source: "installed" | "dev";
  enabled: boolean;
  logoDataUrl?: string;
}

export interface PluginKVItem {
  key: string;
  value: unknown;
  updateAt: number;
}

/** 插件隔离 KV 存储（JSON 落盘，防抖写入） */
class PluginKV {
  private data = new Map<string, { value: unknown; updateAt: number }>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly file: string) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<
        string,
        { value: unknown; updateAt: number }
      >;
      for (const [k, v] of Object.entries(raw)) this.data.set(k, v);
    } catch {
      /* 空库 */
    }
  }

  get(key: string): unknown | null {
    return this.data.get(key)?.value ?? null;
  }

  put(key: string, value: unknown): void {
    this.data.set(key, { value, updateAt: Date.now() });
    this.schedule();
  }

  remove(key: string): void {
    this.data.delete(key);
    this.schedule();
  }

  all(): PluginKVItem[] {
    return [...this.data.entries()].map(([key, v]) => ({ key, ...v }));
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(
        this.file,
        JSON.stringify(Object.fromEntries(this.data.entries()), null, 2),
      );
    } catch (e) {
      logger.error("plugin-db", "写入失败", e);
    }
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
  }
}

export class PluginManager {
  private plugins = new Map<string, LoadedPlugin>();
  private watchers = new Map<string, fs.FSWatcher>();
  private kvStores = new Map<string, PluginKV>();
  private changeListeners = new Set<() => void>();
  private watchDebounce = new Map<string, NodeJS.Timeout>();

  init(): void {
    this.seedOfficialPlugins();
    this.rescan();
    for (const p of settings.get().devPluginPaths) this.watchDevPath(p);
    logger.info("plugins", `已加载 ${this.plugins.size} 个插件`);
  }

  /**
   * 把随包分发的官方插件（dev: 仓库 plugins/，打包: resources/plugins）
   * 首次安装到用户插件目录；已存在（或用户已卸载）则跳过。
   */
  private seedOfficialPlugins(): number {
    const src = app.isPackaged
      ? path.join(process.resourcesPath, "plugins")
      : path.resolve(__dirname, "../../../../plugins");
    let seeded = 0;
    try {
      for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (!fs.existsSync(path.join(src, entry.name, "plugin.json"))) continue;
        const dest = path.join(pluginsDir(), entry.name);
        if (fs.existsSync(dest)) continue;
        fs.cpSync(path.join(src, entry.name), dest, { recursive: true });
        seeded++;
      }
    } catch {
      /* 无官方插件目录 */
    }
    if (seeded > 0) logger.info("plugins", `首次安装官方插件 ${seeded} 个`);
    return seeded;
  }

  onChange(cb: () => void): () => void {
    this.changeListeners.add(cb);
    return () => this.changeListeners.delete(cb);
  }

  private notifyChange(): void {
    for (const cb of this.changeListeners) cb();
  }

  private readPluginDir(dir: string, source: "installed" | "dev"): LoadedPlugin | null {
    try {
      const manifestPath = path.join(dir, "plugin.json");
      if (!fs.existsSync(manifestPath)) return null;
      const parsed = safeParseManifest(JSON.parse(fs.readFileSync(manifestPath, "utf-8")));
      if (!parsed.ok) {
        logger.warn("plugins", `清单无效(${dir}): ${parsed.error}`);
        return null;
      }
      const manifest = parsed.manifest;
      return {
        manifest,
        dir,
        source,
        enabled: !settings.get().disabledPlugins.includes(manifest.name),
        logoDataUrl: logoToDataUrl(manifest.logo ? path.join(dir, manifest.logo) : undefined),
      };
    } catch (e) {
      logger.warn("plugins", `读取插件失败(${dir})`, e);
      return null;
    }
  }

  rescan(): void {
    this.plugins.clear();
    // 正式安装的插件
    try {
      for (const entry of fs.readdirSync(pluginsDir(), { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const p = this.readPluginDir(path.join(pluginsDir(), entry.name), "installed");
        if (p) this.plugins.set(p.manifest.name, p);
      }
    } catch {
      /* 目录不存在 */
    }
    // 开发者模式目录（优先级高于已安装同名插件）
    for (const devPath of settings.get().devPluginPaths) {
      const p = this.readPluginDir(devPath, "dev");
      if (p) {
        logger.info("plugins", `开发插件覆盖加载: ${p.manifest.name} ← ${devPath}`);
        this.plugins.set(p.manifest.name, p);
      }
    }
  }

  reloadAll(): void {
    this.rescan();
    this.notifyChange();
  }

  list(): PluginListItem[] {
    return [...this.plugins.values()]
      .sort((a, b) => a.manifest.displayName.localeCompare(b.manifest.displayName, "zh"))
      .map((p) => ({
        name: p.manifest.name,
        displayName: p.manifest.displayName,
        version: p.manifest.version,
        description: p.manifest.description,
        logo: p.logoDataUrl,
        source: p.source,
        path: p.dir,
        enabled: p.enabled,
        permissions: [...p.manifest.permissions],
        features: p.manifest.features.map((f) => ({
          code: f.code,
          explain: f.explain,
          cmds: f.cmds.map((c) => (typeof c === "string" ? c : c.match)),
        })),
      }));
  }

  get(name: string): LoadedPlugin | null {
    return this.plugins.get(name) ?? null;
  }

  all(): LoadedPlugin[] {
    return [...this.plugins.values()];
  }

  enabledPlugins(): LoadedPlugin[] {
    return this.all().filter((p) => p.enabled);
  }

  installedVersions(): Map<string, string> {
    const m = new Map<string, string>();
    for (const p of this.plugins.values()) m.set(p.manifest.name, p.manifest.version);
    return m;
  }

  setEnabled(name: string, on: boolean): void {
    const disabled = new Set(settings.get().disabledPlugins);
    if (on) disabled.delete(name);
    else disabled.add(name);
    settings.set({ disabledPlugins: [...disabled] });
    this.rescan();
    this.notifyChange();
  }

  uninstall(name: string): void {
    const p = this.plugins.get(name);
    if (!p) return;
    if (p.source === "dev") throw new Error("开发模式插件请在设置中移除开发目录");
    // 清视图由 host 调用方处理；这里清存储与目录
    this.kvStores.get(name)?.flush();
    this.kvStores.delete(name);
    fs.rmSync(p.dir, { recursive: true, force: true });
    this.setEnabled(name, true); // 从 disabled 列表移除
    logger.info("plugins", `插件已卸载: ${name}`);
  }

  addDevPath(dir: string): void {
    if (!fs.existsSync(path.join(dir, "plugin.json"))) {
      throw new Error("该目录下没有 plugin.json");
    }
    const paths = settings.get().devPluginPaths;
    if (paths.includes(dir)) return;
    settings.set({ devPluginPaths: [...paths, dir] });
    this.rescan();
    this.watchDevPath(dir);
    this.notifyChange();
  }

  removeDevPath(dir: string): void {
    settings.set({ devPluginPaths: settings.get().devPluginPaths.filter((p) => p !== dir) });
    this.watchers.get(dir)?.close();
    this.watchers.delete(dir);
    this.rescan();
    this.notifyChange();
  }

  /** 开发目录热重载监听 */
  private watchDevPath(dir: string): void {
    if (this.watchers.has(dir)) return;
    try {
      const watcher = fs.watch(dir, { recursive: true }, () => {
        const prev = this.watchDebounce.get(dir);
        if (prev) clearTimeout(prev);
        this.watchDebounce.set(
          dir,
          setTimeout(() => {
            logger.info("plugins", `开发目录变更，重载: ${dir}`);
            this.rescan();
            this.notifyChange();
          }, 400),
        );
      });
      this.watchers.set(dir, watcher);
    } catch (e) {
      logger.warn("plugins", `监听开发目录失败(${dir})`, e);
    }
  }

  /** 插件数据目录（按插件名隔离） */
  db(name: string): PluginKV {
    let store = this.kvStores.get(name);
    if (!store) {
      const dir = path.join(pluginDataDir(), name);
      fs.mkdirSync(dir, { recursive: true });
      store = new PluginKV(path.join(dir, "db.json"));
      this.kvStores.set(name, store);
    }
    return store;
  }

  flushAllDb(): void {
    for (const s of this.kvStores.values()) s.flush();
  }

  clearPluginData(name: string): void {
    this.kvStores.get(name)?.flush();
    this.kvStores.delete(name);
    fs.rmSync(path.join(pluginDataDir(), name), { recursive: true, force: true });
  }

  stagingPathOf(stagingId: string): string {
    return path.join(stagingDir(), stagingId);
  }
}

export const pluginManager = new PluginManager();
