import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { EngineApp } from "./searchEngine.js";
import { logger } from "../core/logger.js";

/**
 * 应用扫描 Provider。
 * macOS：/Applications、/System/Applications、~/Applications（.app Bundle）
 * Windows：开始菜单（ProgramData + %APPDATA%）的 .lnk，PowerShell COM 解析目标
 * Linux：XDG .desktop 文件（含 Flatpak 导出目录），图标走主题目录查找
 */
export class AppProvider {
  private apps: EngineApp[] = [];
  private iconCache = new Map<string, string>();
  private scanning = false;

  getApps(): EngineApp[] {
    return this.apps;
  }

  /** 按平台扫描应用列表；返回应用数量 */
  async rescan(): Promise<number> {
    if (this.scanning) return this.apps.length;
    this.scanning = true;
    try {
      const found = new Map<string, string>(); // name → path
      switch (process.platform) {
        case "darwin": {
          const home = os.homedir();
          const dirs = [
            "/Applications",
            "/System/Applications",
            path.join(home, "Applications"),
          ];
          for (const dir of dirs) {
            let entries: string[] = [];
            try {
              entries = fs.readdirSync(dir);
            } catch {
              continue;
            }
            for (const name of entries) {
              if (!name.endsWith(".app")) continue;
              const full = path.join(dir, name);
              if (found.has(name)) continue;
              found.set(name, full);
            }
          }
          this.apps = [...found.entries()].map(([bundleName, p]) => ({
            name: this.readAppName(p) ?? bundleName.replace(/\.app$/, ""),
            path: p,
            icon: this.iconCache.get(p),
          }));
          break;
        }
        case "win32": {
          this.apps = await this.scanWindows();
          break;
        }
        case "linux": {
          this.apps = this.scanLinux();
          break;
        }
      }
      logger.info("apps", `扫描到 ${this.apps.length} 个应用`);
      this.warmIconsInBackground();
      return this.apps.length;
    } finally {
      this.scanning = false;
    }
  }

  // ————— Windows：开始菜单 .lnk —————

  private startMenuDirs(): string[] {
    const dirs: string[] = [];
    if (process.env.APPDATA) {
      dirs.push(path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs"));
    }
    if (process.env.ProgramData) {
      dirs.push(
        path.join(process.env.ProgramData, "Microsoft", "Windows", "Start Menu", "Programs"),
      );
    }
    return dirs;
  }

  private async scanWindows(): Promise<EngineApp[]> {
    const lnks: string[] = [];
    for (const dir of this.startMenuDirs()) {
      this.walkFiles(dir, 0, (p) => {
        if (p.toLowerCase().endsWith(".lnk")) lnks.push(p);
      });
    }
    if (!lnks.length) return [];

    // 一次 PowerShell 批量解析 .lnk 目标（WScript.Shell COM），过滤文件夹快捷方式
    const targets = await this.resolveLnkTargets(lnks);
    const found = new Map<string, string>();
    for (const lnk of lnks) {
      const target = targets.get(lnk) ?? "";
      if (target && this.isDir(target)) continue; // 文件夹快捷方式不作为应用
      const name = path.basename(lnk).replace(/\.lnk$/i, "");
      const key = name.toLowerCase();
      if (!key || found.has(key)) continue;
      // 目标存在则指向目标（启动与取图标都更直接），否则保留 .lnk（同样可打开）
      const p = target && !target.startsWith("::") ? target : lnk;
      found.set(key, p);
    }
    return [...found.entries()].map(([name, p]) => ({
      name,
      path: p,
      icon: this.iconCache.get(p),
    }));
  }

  /** 批量解析 .lnk → TargetPath；失败返回空 Map（退化为直接打开 .lnk） */
  private resolveLnkTargets(lnks: string[]): Promise<Map<string, string>> {
    return new Promise((resolve) => {
      const script = [
        "$ErrorActionPreference = 'SilentlyContinue'",
        "$sh = New-Object -ComObject WScript.Shell",
        "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
        "foreach ($l in [Console]::In.ReadToEnd() -split \"`r?`n\") {",
        "  $p = $l.TrimEnd(); if (-not $p) { continue }",
        "  $t = ''; try { $t = $sh.CreateShortcut($p).TargetPath } catch {}",
        "  \"$p|$t\"",
        "}",
      ].join("\r\n");
      const ps = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "-"],
        { stdio: ["pipe", "pipe", "ignore"], windowsHide: true },
      );
      const out: Buffer[] = [];
      let done = false;
      const finish = (map: Map<string, string>) => {
        if (!done) {
          done = true;
          resolve(map);
        }
      };
      const timer = setTimeout(() => {
        ps.kill();
        finish(new Map());
      }, 20000);
      ps.stdout.on("data", (c: Buffer) => out.push(c));
      ps.on("error", () => {
        clearTimeout(timer);
        finish(new Map());
      });
      ps.on("close", () => {
        clearTimeout(timer);
        const map = new Map<string, string>();
        for (const line of Buffer.concat(out).toString("utf-8").split("\n")) {
          const idx = line.lastIndexOf("|");
          if (idx <= 0) continue;
          map.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
        }
        finish(map);
      });
      ps.stdin.end(script + "\r\n" + lnks.join("\r\n") + "\r\n");
    });
  }

  // ————— Linux：XDG .desktop —————

  private linuxAppDirs(): string[] {
    const home = os.homedir();
    return [
      path.join(home, ".local/share/applications"),
      path.join(home, ".local/share/flatpak/exports/share/applications"),
      "/usr/local/share/applications",
      "/usr/share/applications",
      "/var/lib/flatpak/exports/share/applications",
    ];
  }

  private scanLinux(): EngineApp[] {
    const files: string[] = [];
    for (const dir of this.linuxAppDirs()) {
      this.walkFiles(dir, 0, (p) => {
        if (p.toLowerCase().endsWith(".desktop")) files.push(p);
      });
    }
    const found = new Map<string, EngineApp>();
    for (const file of files) {
      const entry = this.parseDesktopFile(file);
      if (!entry) continue;
      const key = path.basename(file).toLowerCase();
      if (found.has(key)) continue;
      found.set(key, { name: entry.name, path: file, icon: this.resolveLinuxIcon(entry.icon) });
    }
    return [...found.values()];
  }

  /** 解析 [Desktop Entry] 段；NoDisplay/Hidden/非应用类型返回 null */
  private parseDesktopFile(file: string): { name: string; icon?: string } | null {
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf-8");
    } catch {
      return null;
    }
    let inEntry = false;
    let name = "";
    const names: Record<string, string> = {};
    let icon: string | undefined;
    let exec: string | undefined;
    let skip = false;
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      if (t.startsWith("[")) {
        if (inEntry) break; // 已读完 [Desktop Entry]，后续是 Action 段
        inEntry = t.toLowerCase() === "[desktop entry]";
        continue;
      }
      if (!inEntry) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim();
      if (key === "Name") name = val;
      else if (/^Name\[/.test(key)) names[key.slice(5, -1)] = val;
      else if (key === "Icon") icon = val || undefined;
      else if (key === "Exec") exec = val;
      else if (key === "NoDisplay" || key === "Hidden") {
        if (val === "true" || val === "1") skip = true;
      } else if (key === "Type" && val !== "Application") skip = true;
    }
    if (skip || !exec) return null;
    const localized =
      names["zh_CN"] ?? names["zh_SG"] ?? names["zh"] ?? names["zh_TW"] ?? names["zh_HK"] ?? name;
    if (!localized) return null;
    return { name: localized, icon };
  }

  /** Linux 图标：getFileIcon 不可用，按 Icon= 名查 pixmaps / hicolor 主题 → dataURL */
  private resolveLinuxIcon(iconName?: string): string | undefined {
    if (!iconName) return undefined;
    const cacheKey = `linux-icon:${iconName}`;
    const cached = this.iconCache.get(cacheKey);
    if (cached) return cached;
    const candidates: string[] = [];
    if (path.isAbsolute(iconName)) {
      candidates.push(iconName);
    } else {
      const exts = [".png", ".svg"];
      for (const ext of exts) candidates.push(`/usr/share/pixmaps/${iconName}${ext}`);
      const sizeDirs = fs
        .readdirSync("/usr/share/icons/hicolor", { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0));
      // 小图放大难看 → 从大到小取；scalable（svg）最优放最后（清晰）
      for (const size of sizeDirs.reverse()) {
        candidates.push(`/usr/share/icons/hicolor/${size}/apps/${iconName}.png`);
      }
      candidates.push(`/usr/share/icons/hicolor/scalable/apps/${iconName}.svg`);
    }
    for (const p of candidates) {
      try {
        if (!fs.existsSync(p) || !fs.statSync(p).isFile()) continue;
        const mime = p.endsWith(".svg") ? "image/svg+xml" : "image/png";
        if (path.extname(p) !== ".svg" && path.extname(p) !== ".png") continue;
        const dataUrl = `data:${mime};base64,${fs.readFileSync(p).toString("base64")}`;
        this.iconCache.set(cacheKey, dataUrl);
        return dataUrl;
      } catch {
        /* 下一个候选 */
      }
    }
    return undefined;
  }

  // ————— 通用 —————

  private walkFiles(dir: string, depth: number, visit: (p: string) => void): void {
    if (depth > 6) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) this.walkFiles(full, depth + 1, visit);
      else if (ent.isFile()) visit(full);
    }
  }

  private isDir(p: string): boolean {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  }

  /** macOS: 读取 Info.plist 的 CFBundleDisplayName / CFBundleName */
  private readAppName(appPath: string): string | null {
    try {
      const plist = path.join(appPath, "Contents", "Info.plist");
      const raw = fs.readFileSync(plist, "utf-8");
      for (const key of ["CFBundleDisplayName", "CFBundleName"]) {
        const m = raw.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`));
        if (m?.[1]) return m[1];
      }
    } catch {
      /* binary plist 或读取失败 → 回退文件名 */
    }
    return null;
  }

  /** 后台预热图标（nativeImage → dataURL），不阻塞搜索；Linux 无此 API，已在扫描时解析 */
  private warmIconsInBackground(): void {
    if (process.platform !== "darwin" && process.platform !== "win32") return;
    void (async () => {
      for (const a of this.apps) {
        if (this.iconCache.has(a.path)) {
          a.icon = this.iconCache.get(a.path);
          continue;
        }
        try {
          const icon = await app.getFileIcon(a.path, { size: "normal" });
          const dataUrl = icon.toDataURL();
          this.iconCache.set(a.path, dataUrl);
          a.icon = dataUrl;
        } catch {
          /* 图标获取失败 → 渲染层用字母头像 */
        }
      }
      logger.debug("apps", "应用图标预热完成");
    })();
  }
}

export const appProvider = new AppProvider();
