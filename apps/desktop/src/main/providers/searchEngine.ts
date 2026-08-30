import type { PluginFeature, SearchResult } from "@boxkit/shared";

/** 搜索引擎输入的各 Provider 数据快照（由主进程组装，纯函数便于测试）。 */
export interface EngineApp {
  name: string;
  path: string;
  icon?: string;
}

export interface EngineCommand {
  id: string;
  title: string;
  keywords: string[];
  builtinIcon?: string;
}

export interface EngineFeatureRef {
  pluginId: string;
  displayName: string;
  logo?: string;
  feature: PluginFeature;
}

export interface EngineDeps {
  apps: EngineApp[];
  commands: EngineCommand[];
  features: EngineFeatureRef[];
  /** 使用频率统计（id → 次数/最近使用），用于排序加权与「最近使用」 */
  usage?: Record<string, { count: number; last: number }>;
}

const regexCache = new Map<string, RegExp | null>();

function compiledRegex(pattern: string): RegExp | null {
  if (regexCache.has(pattern)) return regexCache.get(pattern)!;
  let re: RegExp | null = null;
  try {
    re = new RegExp(pattern);
  } catch {
    re = null;
  }
  regexCache.set(pattern, re);
  return re;
}

/** 关键字匹配评分：精确 100 > 前缀 85 > 词首 70 > 包含 55；不命中为 null */
export function matchScore(query: string, target: string): number | null {
  const q = query.trim().toLowerCase();
  const t = target.toLowerCase();
  if (!q || !t) return null;
  if (t === q) return 100;
  if (t.startsWith(q)) return 85 - Math.min(10, t.length - q.length);
  const idx = t.indexOf(q);
  if (idx > 0 && /[\s\-_@.]/.test(t[idx - 1])) return 70;
  if (idx > 0) return 55 - Math.min(10, idx);
  return null;
}

function pushResult(list: SearchResult[], r: SearchResult): void {
  const exist = list.find((x) => x.id === r.id);
  if (!exist || exist.score < r.score) {
    if (exist) Object.assign(exist, r);
    else list.push(r);
  }
}

export const MAX_RESULTS = 20;

export function searchQuery(text: string, deps: EngineDeps): SearchResult[] {
  const q = text.trim();
  const usage = deps.usage ?? {};
  const results: SearchResult[] = [];

  if (!q) {
    // 空输入：uTools 6 式分组网格 —— 最近使用 / 插件功能 / 市场精选
    const collect = (r: SearchResult) => {
      results.push(r);
    };
    // 1) 最近使用（按 last 降序，最多 18）
    const recentIds = Object.entries(usage)
      .filter(([, u]) => u.count > 0)
      .sort((a, b) => b[1].last - a[1].last || b[1].count - a[1].count)
      .slice(0, 18)
      .map(([id]) => id);
    const byId = new Map<string, SearchResult>();
    const pushGroup = (r: SearchResult) => {
      if (!byId.has(r.id)) byId.set(r.id, r);
    };
    for (const f of deps.features) {
      pushGroup({
        id: `plugin:${f.pluginId}:${f.feature.code}`,
        title: f.feature.explain,
        subtitle: f.displayName,
        icon: f.logo,
        kind: "plugin",
        score: 30,
        pluginId: f.pluginId,
        featureCode: f.feature.code,
        section: "plugin",
        pluginCmds: f.feature.cmds.map((c) => (typeof c === "string" ? c : c.explain ?? f.feature.explain)),
      });
    }
    for (const a of deps.apps) {
      pushGroup({ id: `app:${a.path}`, title: a.name, subtitle: a.path, icon: a.icon, kind: "app", score: 29, section: "plugin" });
    }
    for (const c of deps.commands) {
      pushGroup({ id: `cmd:${c.id}`, title: c.title, builtinIcon: c.builtinIcon, kind: "command", score: 28, section: "plugin" });
    }
    for (const id of recentIds) {
      const hit = byId.get(id);
      if (hit) collect({ ...hit, section: "recent" });
    }
    // 2) 插件功能（未在最近使用里的）
    for (const r of byId.values()) {
      if (r.kind === "plugin" && !recentIds.includes(r.id)) collect(r);
    }
    // 3) 市场精选：官方插件 + 打开市场入口
    const official = ["utools-demo", "devtoolbox", "clipboard-history"];
    for (const f of deps.features) {
      const gid = `plugin:${f.pluginId}:${f.feature.code}`;
      if (official.includes(f.pluginId) && !recentIds.includes(gid)) {
        collect({
          id: `plugin:${f.pluginId}:${f.feature.code}`,
          title: f.feature.explain,
          subtitle: f.displayName,
          icon: f.logo,
          kind: "plugin",
          score: 26,
          pluginId: f.pluginId,
          featureCode: f.feature.code,
          section: "market",
          pluginCmds: f.feature.cmds.map((c) => (typeof c === "string" ? c : c.explain ?? f.feature.explain)),
        });
      }
    }
    collect({
      id: "open:market",
      title: "插件应用市场",
      subtitle: "浏览与安装更多插件",
      builtinIcon: "🛍️",
      kind: "command",
      score: 25,
      section: "market",
    });
    return results;
  }

  // 频率加权：用过的结果按次数提升（上限 15，不破坏精确度优先序）
  const boost = (id: string) => Math.min(15, (usage[id]?.count ?? 0) * 2);

  for (const app of deps.apps) {
    const s = matchScore(q, app.name);
    if (s !== null) {
      const id = `app:${app.path}`;
      pushResult(results, {
        id,
        title: app.name,
        subtitle: app.path,
        icon: app.icon,
        kind: "app",
        score: s + boost(id),
      });
    }
  }

  for (const c of deps.commands) {
    let best: number | null = matchScore(q, c.title);
    for (const kw of c.keywords) {
      const s = matchScore(q, kw);
      if (s !== null && (best === null || s > best)) best = s + 5; // 关键字略加权
    }
    if (best !== null) {
      const id = `cmd:${c.id}`;
      pushResult(results, {
        id,
        title: c.title,
        builtinIcon: c.builtinIcon,
        kind: "command",
        score: best + boost(id),
      });
    }
  }

  for (const f of deps.features) {
    let best: number | null = null;
    let bestType: "text" | "regex" | "over" = "text";
    for (const cmd of f.feature.cmds) {
      if (typeof cmd === "string") {
        const s = matchScore(q, cmd);
        if (s !== null && (best === null || s > best)) {
          best = s + 8; // 插件关键字加权，优先于应用
          bestType = q === cmd.trim().toLowerCase() ? "over" : "text";
        }
      } else {
        const min = cmd.minLength ?? 1;
        if (q.length >= min) {
          const re = compiledRegex(cmd.match);
          if (re?.test(q)) {
            const s = 60;
            if (best === null || s > best) {
              best = s;
              bestType = "regex";
            }
          }
        }
      }
    }
    if (best !== null) {
      const id = `plugin:${f.pluginId}:${f.feature.code}`;
      pushResult(results, {
        id,
        title: f.feature.explain,
        subtitle: f.displayName,
        icon: f.logo,
        kind: "plugin",
        score: best + boost(id),
        pluginId: f.pluginId,
        featureCode: f.feature.code,
        cmdType: bestType,
        pluginCmds: f.feature.cmds.map((c) =>
          typeof c === "string" ? c : c.explain ?? f.feature.explain,
        ),
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  const top = results.slice(0, MAX_RESULTS);

  // 网络搜索兜底
  if (q && top.length < 4) {
    top.push(
      {
        id: "web:google",
        title: `Google 搜索 “${q}”`,
        subtitle: "web",
        builtinIcon: "🌐",
        kind: "web",
        score: 5,
        webQuery: q,
      },
      {
        id: "web:baidu",
        title: `百度搜索 “${q}”`,
        subtitle: "web",
        builtinIcon: "🔍",
        kind: "web",
        score: 4,
        webQuery: q,
      },
    );
  }
  return top;
}
