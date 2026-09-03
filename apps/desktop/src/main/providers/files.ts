import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { FileSearchEntry } from "@boxkit/shared";
import { logger } from "../core/logger.js";

export interface EngineFile extends FileSearchEntry {
  aliases?: string[];
}

export type ScanStatusValue = "idle" | "scanning" | "cancelled" | "completed" | "error";

export interface ScanStatus {
  status: ScanStatusValue;
  scanned: number;
  matched: number;
  roots: string[];
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

export interface ScanOptions {
  signal?: AbortSignal;
}

const MAX_FILES = 2500;
const MAX_DEPTH = 3;
const BATCH_SIZE = 96;
const DEFAULT_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".js", ".ts", ".tsx", ".jsx", ".css", ".html", ".htm",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".csv", ".png", ".jpg",
  ".jpeg", ".gif", ".webp", ".svg", ".zip", ".7z", ".rar", ".mp3", ".mp4", ".mov",
]);

export function defaultFileRoots(): string[] {
  const home = os.homedir();
  return ["Desktop", "Documents", "Downloads", "Pictures"].map((name) => path.join(home, name));
}

function normalizeRoots(roots: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    if (typeof root !== "string" || !root.trim() || root.length > 4096) continue;
    const full = path.resolve(root);
    const key = process.platform === "win32" ? full.toLowerCase() : full;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(full);
  }
  return result;
}

/**
 * A compact, dependency-free transliterator for the Chinese vocabulary commonly
 * used in launcher names. Unknown Han characters remain searchable by their
 * original text and can still be ordered by Intl's pinyin collation.
 */
const PINYIN_DATA = `
微 wei 信 xin 文 wen 件 jian 剪 jian 贴 tie 板 ban 时 shi 间 jian 截 jie 图 tu
设 she 置 zhi 睡 shui 眠 mian 锁 suo 屏 ping 清 qing 空 kong 回 hui 收 shou 藏 cang
任 ren 务 wu 管 guan 理 li 器 qi 退 tui 出 chu 打 da 开 kai 市 shi 场 chang 插 cha
件 jian 转 zhuan 换 huan 数 shu 字 zi 运 yun 气 qi 添 tian 加 jia
我 wo 的 de 测 ce 试 shi 桌 zhuo 面 mian 下 xia 载 zai 图 tu 片 pian 视 shi 频 pin
音 yin 乐 yue 代 dai 码 ma 项 xiang 目 mu 报 bao 告 gao 会 hui 议 yi 资 zi 料 liao
文档 wen dang 方 fang 案 an 备 bei 份 fen 新 xin 建 jian 版 ban 本 ben 目 mu 录 lu
数 shu 据 ju 表 biao 格 ge 演 yan 示 shi 课 ke 程 cheng 记 ji 录 lu 备 bei 忘 wang
便 bian 签 qian 日 ri 志 zhi 主 zhu 页 ye 浏 liu 览 lan 器 qi 计 ji 算 suan 终 zhong
端 duan 网 wang 络 luo 系 xi 统 tong 个 ge 人 ren 常 chang 用 yong 应 ying 用 yong
程 cheng 序 xu 工 gong 具 ju 批 pi 量 liang 搜 sou 索 suo 复 fu 制 zhi 粘 zhan
复 fu 制 zhi 文 wen 本 ben 地 di 址 zhi 邮 you 箱 xiang 最 zui 近 jin 新 xin 闻 wen
周 zhou 年 nian 月 yue 日 ri 春 chun 夏 xia 秋 qiu 冬 dong 上 shang 中 zhong 级 ji
别 bie 快 kuai 捷 jie 启 qi 动 dong 选 xuan 项 xiang 首 shou 页 ye 预 yu 览 lan
收 shou 件 jian 发 fa 送 song 客 ke 户 hu 令 ling 牌 pai 密 mi 码 ma 账 zhang
号 hao 登 deng 录 lu 口 kou 令 ling 牌 pai 云 yun 盘 pan 根 gen 目 mu 标 biao
源 yuan 文 wen 件 jian 夹 jia 软 ruan 件 jian 窗 chuang 口 kou 桌 zhuo 面 mian
开 kai 发 fa 调 tiao 试 shi 编 bian 辑 ji 器 qi 终 zhong 端 duan 服 fu 务 wu
器 qi 项 xiang 目 mu 内 nei 容 rong 标 biao 题 ti 标 biao 签 qian
`;

const PINYIN = Object.fromEntries(PINYIN_DATA.trim().split(/\s+/).reduce<[string, string][]>((pairs, token, index, tokens) => {
  if (index % 2 === 0 && tokens[index + 1]) pairs.push([token, tokens[index + 1]]);
  return pairs;
}, [])) as Record<string, string>;

function isHan(char: string): boolean {
  return /\p{Script=Han}/u.test(char);
}

function pinyinParts(value: string): { parts: string[]; hasHan: boolean } {
  const parts: string[] = [];
  let ascii = "";
  let hasHan = false;
  const flush = () => {
    if (ascii) {
      parts.push(ascii);
      ascii = "";
    }
  };
  for (const char of value.trim().toLowerCase()) {
    if (isHan(char)) {
      flush();
      hasHan = true;
      parts.push(PINYIN[char] ?? char);
    } else if (/\s/.test(char)) {
      flush();
    } else if (/[-_./\\]/.test(char)) {
      flush();
      parts.push(char);
    } else {
      ascii += char;
    }
  }
  flush();
  return { parts, hasHan };
}

export function toPinyin(value: string): string {
  return pinyinParts(value).parts.join("");
}

export function pinyinInitials(value: string): string {
  const { parts, hasHan } = pinyinParts(value);
  if (!hasHan) return "";
  return parts.map((part) => {
    if (part.length === 1 && isHan(part)) return part;
    return /^[a-z0-9]/.test(part) ? part[0] : part;
  }).join("");
}

export function pinyinAliases(value: string): string[] {
  const { parts, hasHan } = pinyinParts(value);
  if (!hasHan) return [];
  const aliases = [parts.join(""), parts.join(" "), pinyinInitials(value)]
    .map((alias) => alias.trim())
    .filter((alias) => alias && alias !== value.trim().toLowerCase());
  return [...new Set(aliases)];
}

const PINYIN_COLLATOR = new Intl.Collator("zh-CN-u-co-pinyin", {
  sensitivity: "base",
  numeric: true,
});

export function comparePinyin(a: string, b: string): number {
  const direct = PINYIN_COLLATOR.compare(a, b);
  if (direct !== 0) return direct;
  const converted = PINYIN_COLLATOR.compare(toPinyin(a), toPinyin(b));
  if (converted !== 0) return converted;
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

/** Worker source is kept inline so the single-file main-process build needs no second artifact. */
const FILE_SCAN_WORKER_SOURCE = String.raw`
const { parentPort } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
let cancelled = false;
parentPort.on('message', (message) => {
  if (message && message.type === 'cancel') cancelled = true;
  if (message && message.type === 'start') void scan(message);
});
const pause = () => new Promise((resolve) => setImmediate(resolve));
const keyFor = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
async function scan(message) {
  const roots = Array.isArray(message.roots) ? message.roots : [];
  const extensions = new Set(Array.isArray(message.extensions) ? message.extensions : []);
  const maxDepth = Number.isFinite(message.maxDepth) ? message.maxDepth : 3;
  const maxFiles = Number.isFinite(message.maxFiles) ? message.maxFiles : 2500;
  const batchSize = Number.isFinite(message.batchSize) ? message.batchSize : 96;
  const stack = [];
  const seen = new Set();
  const found = [];
  let scanned = 0;
  let matched = 0;
  const emit = () => {
    if (!found.length) return;
    const files = found.splice(0);
    parentPort.postMessage({ type: 'batch', files, scanned, matched });
  };
  for (const root of roots) {
    if (cancelled || matched >= maxFiles) break;
    const full = path.resolve(String(root));
    try {
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) stack.push({ dir: full, depth: 0 });
      else if (stat.isFile()) {
        const ext = path.extname(full).toLowerCase();
        if (!ext || extensions.has(ext)) {
          found.push({ path: full, name: path.basename(full), size: stat.size, modifiedAt: stat.mtimeMs });
          matched++;
          if (found.length >= batchSize) emit();
        }
      }
    } catch {}
  }
  while (stack.length && !cancelled && matched < maxFiles) {
    const current = stack.pop();
    if (!current || current.depth > maxDepth) continue;
    const currentKey = keyFor(current.dir);
    if (seen.has(currentKey)) continue;
    seen.add(currentKey);
    let entries;
    try { entries = fs.readdirSync(current.dir, { withFileTypes: true }); } catch { continue; }
    scanned++;
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (cancelled || matched >= maxFiles) break;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < maxDepth) stack.push({ dir: full, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (ext && !extensions.has(ext)) continue;
      try {
        const stat = fs.statSync(full);
        found.push({ path: full, name: entry.name, size: stat.size, modifiedAt: stat.mtimeMs });
        matched++;
      } catch {}
      if (found.length >= batchSize) emit();
    }
    if (scanned % 4 === 0) await pause();
  }
  emit();
  parentPort.postMessage({ type: 'done', cancelled, scanned, matched });
}
`;

interface FileWorkerMessage {
  type: "batch" | "done";
  files?: Array<{ path: string; name: string; size: number; modifiedAt: number }>;
  scanned?: number;
  matched?: number;
  cancelled?: boolean;
}

interface FileScanJob {
  worker: Worker;
  promise: Promise<number>;
  controller: AbortController;
  finish: (status: ScanStatusValue, error?: string) => void;
}

export class FileProvider {
  private files: EngineFile[] = [];
  private roots: string[];
  private activeJob: FileScanJob | null = null;
  private scanStatus: ScanStatus;
  private listeners = new Set<() => void>();
  private statusListeners = new Set<(status: ScanStatus) => void>();

  constructor(roots: string[] = defaultFileRoots()) {
    this.roots = normalizeRoots(roots);
    this.scanStatus = { status: "idle", scanned: 0, matched: 0, roots: [...this.roots] };
  }

  getFiles(): EngineFile[] {
    return this.files;
  }

  getRoots(): string[] {
    return [...this.roots];
  }

  setRoots(roots: string[]): string[] {
    const next = normalizeRoots(roots);
    if (this.activeJob) this.cancelRescan();
    this.roots = next;
    this.updateStatus({ roots: [...next] });
    return this.getRoots();
  }

  getScanStatus(): ScanStatus {
    return { ...this.scanStatus, roots: [...this.scanStatus.roots] };
  }

  getStatus(): ScanStatus {
    return this.getScanStatus();
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  onStatusChange(cb: (status: ScanStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  async rescan(options: ScanOptions = {}): Promise<number> {
    if (this.activeJob) return this.activeJob.promise;
    const controller = new AbortController();
    const onAbort = () => this.cancelRescan();
    if (options.signal) {
      if (options.signal.aborted) controller.abort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }
    const worker = new Worker(FILE_SCAN_WORKER_SOURCE, { eval: true });
    let resolvePromise!: (count: number) => void;
    const promise = new Promise<number>((resolve) => { resolvePromise = resolve; });
    const job = {
      worker,
      promise,
      controller,
      finish: (_status: ScanStatusValue, _error?: string) => undefined,
    } as FileScanJob;
    this.activeJob = job;
    this.files = [];
    this.updateStatus({ status: "scanning", scanned: 0, matched: 0, startedAt: Date.now(), finishedAt: undefined, error: undefined, roots: [...this.roots] });
    const pending = new Map<string, EngineFile>();
    let settled = false;
    const publish = () => {
      this.files = [...pending.values()]
        .sort((a, b) => comparePinyin(a.name, b.name) || a.path.localeCompare(b.path, undefined, { sensitivity: "base" }))
        .slice(0, MAX_FILES);
      for (const listener of this.listeners) listener();
    };
    const finish = (status: ScanStatusValue, error?: string) => {
      if (settled) return;
      settled = true;
      if (options.signal) options.signal.removeEventListener("abort", onAbort);
      if (this.activeJob === job) this.activeJob = null;
      this.updateStatus({ status, matched: this.files.length, finishedAt: Date.now(), error });
      resolvePromise(this.files.length);
      void worker.terminate();
    };
    job.finish = finish;
    worker.on("message", (message: FileWorkerMessage) => {
      if (settled) return;
      if (message.type === "batch") {
        for (const raw of message.files ?? []) {
          const file: EngineFile = { ...raw, aliases: pinyinAliases(raw.name) };
          pending.set(file.path, file);
        }
        publish();
        this.updateStatus({ scanned: message.scanned ?? this.scanStatus.scanned, matched: pending.size });
      } else if (message.type === "done") {
        if (message.cancelled || controller.signal.aborted) finish("cancelled");
        else finish("completed");
      }
    });
    worker.on("error", (error: Error) => finish("error", error.message));
    worker.on("exit", (code) => {
      if (!settled && code !== 0) finish("error", `文件扫描 worker 退出（${code}）`);
    });
    if (controller.signal.aborted) {
      finish("cancelled");
    } else {
      worker.postMessage({
        type: "start",
        roots: this.roots,
        maxDepth: MAX_DEPTH,
        maxFiles: MAX_FILES,
        batchSize: BATCH_SIZE,
        extensions: [...DEFAULT_EXTENSIONS],
      });
    }
    return promise;
  }

  cancelRescan(): boolean {
    const job = this.activeJob;
    if (!job) return false;
    job.controller.abort();
    try { job.worker.postMessage({ type: "cancel" }); } catch { /* worker may already have exited */ }
    job.finish("cancelled");
    return true;
  }

  private updateStatus(patch: Partial<ScanStatus>): void {
    this.scanStatus = { ...this.scanStatus, ...patch, roots: [...(patch.roots ?? this.roots)] };
    const snapshot = this.getScanStatus();
    for (const listener of this.statusListeners) listener(snapshot);
  }
}

export const fileProvider = new FileProvider();
