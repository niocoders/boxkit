import { net } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { InstallPreview, MarketPlugin } from "@boxkit/shared";
import { settings } from "../core/config.js";
import { logger } from "../core/logger.js";
import { stageInstall } from "../plugins/staging.js";
import { pluginManager } from "../plugins/manager.js";

const DEFAULT_MARKET_URL = "http://127.0.0.1:8080";
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

/** 解析统一返回包装 {code,data} 或裸数组 */
function unwrap<T>(raw: unknown): T | null {
  if (Array.isArray(raw)) return raw as T;
  if (raw && typeof raw === "object" && "data" in (raw as Record<string, unknown>)) {
    return ((raw as { data: T }).data) ?? null;
  }
  return null;
}

export const marketService = {
  /** 拉取市场列表并标注本地安装/可更新状态 */
  async fetchMarket(keyword: string): Promise<MarketPlugin[] | { error: string }> {
    const base = marketBase().replace(/\/+$/, "");
    const q = keyword.trim() ? `?keyword=${encodeURIComponent(keyword.trim())}` : "";
    try {
      const res = await fetchWithTimeout(`${base}/api/market/plugins${q}`);
      if (!res.ok) return { error: `市场服务返回 ${res.status}` };
      const json = (await res.json()) as unknown;
      const list = unwrap<MarketPlugin[]>(json);
      if (!Array.isArray(list)) return { error: "市场返回格式不正确" };
      const installed = installedMap();
      return list.map((m) => {
        const local = installed.get(m.pluginId);
        return {
          ...m,
          installed: !!local,
          localVersion: local,
          updatable: !!local && !!m.version && cmpVersion(m.version, local) > 0,
        };
      });
    } catch (e) {
      logger.warn("market", "市场列表获取失败", e);
      return { error: "无法连接插件市场（可在设置中修改市场地址）" };
    }
  },

  /** 下载 .bkx → 暂存校验，返回与本地安装一致的 preview 流程 */
  async installFromMarket(pluginId: string): Promise<{ preview: InstallPreview; conflict?: string } | { error: string }> {
    if (!pluginId) return { error: "缺少插件 ID" };
    try {
      const list = await this.fetchMarket("");
      if ("error" in list) return list;
      const entry = list.find((m) => m.pluginId === pluginId);
      if (!entry?.fileUrl) return { error: "市场里找不到该插件" };
      const fileUrl = entry.fileUrl.startsWith("http")
        ? entry.fileUrl
        : `${marketBase().replace(/\/+$/, "")}/${entry.fileUrl.replace(/^\/+/, "")}`;
      const res = await fetchWithTimeout(fileUrl);
      if (!res.ok) return { error: `下载失败（HTTP ${res.status}）` };
      const buf = Buffer.from(await res.arrayBuffer());
      const tmp = path.join(os.tmpdir(), `boxkit-market-${pluginId}-${Date.now()}.bkx`);
      fs.writeFileSync(tmp, buf);
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
    } catch (e) {
      logger.warn("market", "市场插件下载/暂存失败", e);
      return { error: "下载或校验失败，请稍后重试" };
    }
  },
};
