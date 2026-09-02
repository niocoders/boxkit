import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FileSearchEntry } from "@boxkit/shared";
import { logger } from "../core/logger.js";

export interface EngineFile extends FileSearchEntry {
  aliases?: string[];
}

const MAX_FILES = 2500;
const MAX_DEPTH = 3;
const DEFAULT_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".js", ".ts", ".tsx", ".jsx", ".css", ".html", ".htm",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".csv", ".png", ".jpg",
  ".jpeg", ".gif", ".webp", ".svg", ".zip", ".7z", ".rar", ".mp3", ".mp4", ".mov",
]);

function defaultRoots(): string[] {
  const home = os.homedir();
  return ["Desktop", "Documents", "Downloads", "Pictures"].map((name) => path.join(home, name));
}

/** Lightweight local-file provider. It indexes common user folders only and never follows links. */
export class FileProvider {
  private files: EngineFile[] = [];
  private scanning = false;
  private listeners = new Set<() => void>();

  constructor(private readonly roots: string[] = defaultRoots()) {}

  getFiles(): EngineFile[] {
    return this.files;
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async rescan(): Promise<number> {
    if (this.scanning) return this.files.length;
    this.scanning = true;
    try {
      const found: EngineFile[] = [];
      const seen = new Set<string>();
      for (const root of this.roots) {
        this.walk(root, 0, found, seen);
        if (found.length >= MAX_FILES) break;
      }
      found.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      this.files = found.slice(0, MAX_FILES);
      logger.info("files", `扫描到 ${this.files.length} 个文件`);
      for (const listener of this.listeners) listener();
      return this.files.length;
    } finally {
      this.scanning = false;
    }
  }

  private walk(dir: string, depth: number, out: EngineFile[], seen: Set<string>): void {
    if (depth > MAX_DEPTH || out.length >= MAX_FILES || seen.has(dir)) return;
    seen.add(dir);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= MAX_FILES) break;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this.walk(full, depth + 1, out, seen);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (ext && !DEFAULT_EXTENSIONS.has(ext)) continue;
      try {
        const stat = fs.statSync(full);
        out.push({ path: full, name: entry.name, size: stat.size, modifiedAt: stat.mtimeMs });
      } catch {
        /* A file can disappear while the index is being built. */
      }
    }
  }
}

export const fileProvider = new FileProvider();
