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
  const results: SearchResult[] = [];

  if (!q) {
    // 空输入：展示插件入口 + 系统命令（功能目录）
    for (const f of deps.features.slice(0, 8)) {
      results.push({
        id: `plugin:${f.pluginId}:${f.feature.code}`,
        title: f.feature.explain,
        subtitle: f.displayName,
        icon: f.logo,
        kind: "plugin",
        score: 30,
        pluginId: f.pluginId,
        featureCode: f.feature.code,
      });
    }
    for (const c of deps.commands.slice(0, 6)) {
      results.push({
        id: `cmd:${c.id}`,
        title: c.title,
        builtinIcon: c.builtinIcon,
        kind: "command",
        score: 29,
      });
    }
    return results;
  }

  for (const app of deps.apps) {
    const s = matchScore(q, app.name);
    if (s !== null) {
      pushResult(results, {
        id: `app:${app.path}`,
        title: app.name,
        subtitle: app.path,
        icon: app.icon,
        kind: "app",
        score: s,
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
      pushResult(results, {
        id: `cmd:${c.id}`,
        title: c.title,
        builtinIcon: c.builtinIcon,
        kind: "command",
        score: best,
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
      pushResult(results, {
        id: `plugin:${f.pluginId}:${f.feature.code}`,
        title: f.feature.explain,
        subtitle: f.displayName,
        icon: f.logo,
        kind: "plugin",
        score: best,
        pluginId: f.pluginId,
        featureCode: f.feature.code,
        cmdType: bestType,
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
