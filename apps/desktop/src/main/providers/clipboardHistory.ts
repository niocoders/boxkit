import { clipboard } from "electron";
import fs from "node:fs";
import path from "node:path";
import type {
  ClipboardCapture,
  ClipboardHistoryItem,
  ClipboardHistoryQuery,
} from "@boxkit/shared";
import { settings } from "../core/config.js";
import { userDataDir } from "../core/paths.js";
import { logger } from "../core/logger.js";

export const MAX_CLIPBOARD_TEXT = 100_000;
export const MAX_CLIPBOARD_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_CLIPBOARD_PATHS = 32;
export const MAX_HISTORY_ITEMS = 200;

interface PersistedHistory {
  items: ClipboardHistoryItem[];
}

function historyFile(): string {
  return path.join(userDataDir(), "clipboard-history.json");
}

export function looksSensitiveText(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  // Do not persist common secrets/tokens, private keys, or password assignments.
  return /(?:password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*\S+/i.test(value)
    || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value)
    || /^\s*Bearer\s+\S+/i.test(value);
}

export function normalizeClipboardPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !item || item.length > 4096) continue;
    const full = path.resolve(item);
    if (seen.has(full)) continue;
    try {
      if (!fs.existsSync(full)) continue;
    } catch {
      continue;
    }
    seen.add(full);
    result.push(full);
    if (result.length >= MAX_CLIPBOARD_PATHS) break;
  }
  return result;
}

export function sanitizeClipboardCapture(capture: ClipboardCapture):
  | { kind: "text"; text: string; size: number }
  | { kind: "file"; paths: string[]; size: number }
  | { kind: "image"; imageDataUrl: string; size: number }
  | null {
  const paths = normalizeClipboardPaths(capture.paths);
  if (paths.length) return { kind: "file", paths, size: paths.join("\n").length };
  const text = typeof capture.text === "string" ? capture.text.slice(0, MAX_CLIPBOARD_TEXT) : "";
  if (text && !looksSensitiveText(text)) return { kind: "text", text, size: Buffer.byteLength(text, "utf8") };
  if (capture.image && capture.image.byteLength > 0 && capture.image.byteLength <= MAX_CLIPBOARD_IMAGE_BYTES) {
    const imageDataUrl = `data:image/png;base64,${Buffer.from(capture.image).toString("base64")}`;
    return { kind: "image", imageDataUrl, size: capture.image.byteLength };
  }
  return null;
}

/** Controlled clipboard history. It does nothing until the user enables the setting. */
export class ClipboardHistoryProvider {
  private items: ClipboardHistoryItem[] = [];
  private timer: NodeJS.Timeout | null = null;
  private lastSignature = "";
  private listeners = new Set<(items: ClipboardHistoryItem[]) => void>();

  load(): void {
    if (!settings.get().clipboardHistoryEnabled) {
      this.items = [];
      this.lastSignature = "";
      return;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(historyFile(), "utf8")) as PersistedHistory;
      if (Array.isArray(parsed.items)) this.items = parsed.items.slice(0, MAX_HISTORY_ITEMS);
    } catch {
      this.items = [];
    }
  }

  onChange(listener: (items: ClipboardHistoryItem[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getItems(query: ClipboardHistoryQuery = {}): ClipboardHistoryItem[] {
    if (!settings.get().clipboardHistoryEnabled) return [];
    const q = typeof query.text === "string" ? query.text.trim().toLowerCase() : "";
    const limit = Math.max(1, Math.min(MAX_HISTORY_ITEMS, Math.floor(query.limit ?? 50)));
    return this.items.filter((item) => {
      if (!q) return true;
      return (item.text ?? "").toLowerCase().includes(q)
        || (item.paths ?? []).some((p) => p.toLowerCase().includes(q));
    }).slice(0, limit);
  }

  capture(capture: ClipboardCapture): ClipboardHistoryItem | null {
    if (!settings.get().clipboardHistoryEnabled) return null;
    const safe = sanitizeClipboardCapture(capture);
    if (!safe) return null;
    const signature = `${safe.kind}:${safe.kind === "text" ? safe.text : safe.kind === "file" ? safe.paths.join("\n") : safe.imageDataUrl}`;
    if (signature === this.lastSignature) return this.items[0] ?? null;
    this.lastSignature = signature;
    const item: ClipboardHistoryItem = {
      id: `clip:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
      kind: safe.kind,
      createdAt: Date.now(),
      size: safe.size,
      ...(safe.kind === "text" ? { text: safe.text } : {}),
      ...(safe.kind === "file" ? { paths: safe.paths } : {}),
      ...(safe.kind === "image" ? { imageDataUrl: safe.imageDataUrl } : {}),
    };
    this.items = [item, ...this.items.filter((old) => old.kind !== item.kind || (item.kind === "text" ? old.text !== item.text : item.kind === "file" ? old.paths?.join("\n") !== item.paths?.join("\n") : old.imageDataUrl !== item.imageDataUrl))];
    const limit = Math.max(1, Math.min(MAX_HISTORY_ITEMS, Math.floor(settings.get().clipboardHistoryLimit || 50)));
    this.items = this.items.slice(0, limit);
    this.scheduleSave();
    for (const listener of this.listeners) listener(this.getItems());
    return item;
  }

  async captureSystemClipboard(): Promise<ClipboardHistoryItem | null> {
    if (!settings.get().clipboardHistoryEnabled) return null;
    const text = await clipboard.readText();
    if (text) return this.capture({ text });
    const image = (clipboard as unknown as { readImage?: () => Electron.NativeImage }).readImage?.();
    if (image && !image.isEmpty()) {
      const png = image.toPNG();
      return this.capture({ image: png });
    }
    return null;
  }

  clear(): void {
    this.items = [];
    this.lastSignature = "";
    this.scheduleSave();
    for (const listener of this.listeners) listener([]);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      fs.mkdirSync(path.dirname(historyFile()), { recursive: true });
      fs.writeFileSync(historyFile(), JSON.stringify({ items: this.items }, null, 2));
    } catch (error) {
      logger.warn("clipboard", "剪贴板历史写入失败", error);
    }
  }

  private scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
  }
}

export const clipboardHistoryProvider = new ClipboardHistoryProvider();
