import { createHash } from "node:crypto";
import { net } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { InstallPreview, MarketPlugin } from "@boxkit/shared";
import { settings } from "../core/config.js";
import { logger } from "../core/logger.js";
import { stageInstall } from "../plugins/staging.js";
import { pluginManager } from "../plugins/manager.js";

/** 默认市场：公开仓 boxkit-market 的 GitHub Pages 静态市场（manifest.json + .bkx + 门户页） */
const DEFAULT_MARKET_URL = "https://niocoders.github.io/boxkit-market";
const FETCH_TIMEOUT_MS = 10000;

function marketBase(): string {
  const u = settings.get().marketUrl;
  return (u && u.trim()) || DEFAULT_MARKET_URL;
}

function cmpVersion(a: string, b: string): number {
  const core = (v: string) => v.split("-")[0].split(".").map((n) => parseInt(n) || 0);
  const [a1, a2, a3] = core(a);
  const [b1, b2, b3] = core(b);
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  if (a3 !== b3) return a3 - b3;
  // 预发布版本小于正式版
  const ap = a.includes("-") ? 0 : 1;
  const bp = b.includes("-") ? 0 : 1;
  return ap - bp;
}

function installedMap(): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of pluginManager.list()) m.set(p.name, p.version);
  return m;
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await net.fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 相对清单路径（plugins/x.bkx、logo/x.svg）→ 绝对 URL */
function toAbsolute(base: string, u: string | undefined): string {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  return new URL(u.replace(/^\/+/, ""), `${base.replace(/\/+$/, "")}/`).href;
}

/** 拉取市场清单（公开仓 boxkit-market Pages 生成，客户端只读消费） */
async function fetchManifest(base: string): Promise<MarketPlugin[]> {
  const res = await fetchWithTimeout(`${base.replace(/\/+$/, "")}/manifest.json`, {
    headers: { "cache-control": "no-cache" },
  });
  if (!res.ok) throw new Error(`市场清单返回 ${res.status}`);
  const json = (await res.json()) as unknown;
  const list = Array.isArray(json)
    ? json
    : Array.isArray((json as { plugins?: MarketPlugin[] })?.plugins)
      ? (json as { plugins: MarketPlugin[] }).plugins
      : null;
  if (!Array.isArray(list)) throw new Error("市场清单格式不正确");
  return list;
}

function matchKeyword(entry: MarketPlugin, kw: string): boolean {
  const q = kw.trim().toLowerCase();
  if (!q) return true;
  return [entry.pluginId, entry.displayName, entry.description, entry.author, ...(entry.keywords ?? [])]
    .filter(Boolean)
    .some((t) => String(t).toLowerCase().includes(q));
}

export const marketService = {
  /** 拉取市场列表，按关键字过滤并标注本地安装/可更新状态 */
  async fetchMarket(keyword: string): Promise<MarketPlugin[] | { error: string }> {
    const base = marketBase();
    try {
      const manifest = await fetchManifest(base);
      const installed = installedMap();
      return manifest
        .filter((entry) => matchKeyword(entry, keyword))
        .map((entry) => {
          const local = installed.get(entry.pluginId);
          return {
            ...entry,
            fileUrl: toAbsolute(base, entry.fileUrl),
            logoUrl: entry.logoUrl ? toAbsolute(base, entry.logoUrl) : undefined,
            installed: !!local,
            localVersion: local,
            updatable: !!local && !!entry.version && cmpVersion(entry.version, local) > 0,
          };
        });
    } catch (e) {
      logger.warn("market", "市场清单获取失败", e);
      return { error: "无法连接插件市场（可在设置中修改市场地址）" };
    }
  },

  /** 下载 .bkx → sha256 校验 → 暂存校验，返回与本地安装一致的 preview 流程 */
  async installFromMarket(pluginId: string): Promise<{ preview: InstallPreview; conflict?: string } | { error: string }> {
    if (!pluginId) return { error: "缺少插件 ID" };
    try {
      const base = marketBase();
      const list = await fetchManifest(base);
      const entry = list.find((m) => m.pluginId === pluginId);
      if (!entry) return { error: "市场里找不到该插件" };
      const fileUrl = toAbsolute(base, entry.fileUrl);
      const res = await fetchWithTimeout(fileUrl);
      if (!res.ok) return { error: `下载失败（HTTP ${res.status}）` };
      const buf = Buffer.from(await res.arrayBuffer());
      if (entry.sha256) {
        const sha = createHash("sha256").update(buf).digest("hex");
        if (sha !== entry.sha256) {
          logger.warn("market", `sha256 不匹配：期望 ${entry.sha256}，实际 ${sha}`);
          return { error: "插件包校验失败（sha256 不匹配），请稍后重试" };
        }
      }
      const tmp = path.join(os.tmpdir(), `boxkit-market-${pluginId}-${Date.now()}.bkx`);
      fs.writeFileSync(tmp, buf);
      try {
        const staged = await stageInstall(tmp, pluginManager.installedVersions());
        const preview: InstallPreview = {
          stagingId: staged.stagingId,
          name: staged.manifest.name,
          displayName: staged.manifest.displayName,
          version: staged.manifest.version,
          description: staged.manifest.description,
          permissions: [...staged.manifest.permissions],
          logo: staged.logoDataUrl,
        };
        return { preview, conflict: staged.conflict };
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    } catch (e) {
      logger.warn("market", "市场插件下载/暂存失败", e);
      return { error: "下载或校验失败，请稍后重试" };
    }
  },
};
