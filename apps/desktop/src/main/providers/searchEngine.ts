import type { ClipboardHistoryItem, InputPayload, PluginCommandType, PluginFeature, SearchResult } from "@boxkit/shared";

/** 搜索引擎输入的各 Provider 数据快照（由主进程组装，纯函数便于测试）。 */
export interface EngineApp {
  name: string;
  path: string;
  icon?: string;
  aliases?: string[];
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

export interface EngineFile {
  path: string;
  name: string;
  isDirectory?: boolean;
  size?: number;
  modifiedAt?: number;
  aliases?: string[];
}

export interface EngineDeps {
  apps: EngineApp[];
  commands: EngineCommand[];
  features: EngineFeatureRef[];
  files?: EngineFile[];
  clipboard?: ClipboardHistoryItem[];
  pinnedIds?: string[];
  usage?: Record<string, { count: number; last: number }>;
  input?: import("@boxkit/shared").InputPayload;
}

function platformMatches(platform: string | string[] | undefined): boolean {
  if (!platform) return true;
  const values = Array.isArray(platform) ? platform : [platform];
  const current = process.platform === "darwin" ? "darwin" : process.platform;
  return values.some((value) => {
    const v = value.toLowerCase();
    return v === current || (current === "win32" && (v === "win32" || v === "windows" || v === "win"));
  });
}

export function commandLabel(cmd: PluginFeature["cmds"][number], fallback: string): string {
  if (typeof cmd === "string") return cmd;
  return cmd.label ?? cmd.explain ?? fallback;
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

const INITIALS: Record<string, string> = {
  微: "w", 信: "x", 文: "w", 件: "j", 剪: "j", 贴: "t", 板: "b", 时: "s", 间: "j",
  截: "j", 图: "t", 设: "s", 置: "z", 睡: "s", 眠: "m", 锁: "s", 屏: "p", 清: "q",
  空: "k", 回: "h", 收: "s", 藏: "c", 任: "r", 务: "w", 管: "g", 理: "l", 器: "q",
  退: "t", 出: "c", 打: "d", 开: "k", 市: "s", 场: "c", 插: "c", 转: "z",
  换: "h", 数: "s", 字: "z", 运: "y", 气: "q", 添: "t", 加: "j",
};

function initials(value: string): string {
  return Array.from(value.toLowerCase()).map((char) => {
    if (/[a-z0-9]/.test(char)) return char;
    return INITIALS[char] ?? "";
  }).join("");
}

function fuzzySubsequence(query: string, target: string): number | null {
  let qi = 0;
  let gaps = 0;
  let last = -1;
  for (let i = 0; i < target.length && qi < query.length; i++) {
    if (target[i] !== query[qi]) continue;
    if (last >= 0) gaps += i - last - 1;
    last = i;
    qi++;
  }
  if (qi !== query.length) return null;
  return Math.max(18, 42 - gaps * 2 - Math.max(0, target.length - query.length));
}

function scoreVariant(query: string, target: string): number | null {
  if (!query || !target) return null;
  if (target === query) return 100;
  if (target.startsWith(query)) return 85 - Math.min(10, target.length - query.length);
  const idx = target.indexOf(query);
  if (idx > 0 && /[\s\-_@.]/.test(target[idx - 1])) return 70;
  if (idx > 0) return 55 - Math.min(10, idx);
  return fuzzySubsequence(query, target);
}

/** 关键字匹配评分：精确优先，其次前缀/词首/包含，再尝试首字母和轻量模糊匹配。 */
export function matchScore(query: string, target: string): number | null {
  const q = query.trim().toLowerCase();
  const t = target.trim().toLowerCase();
  if (!q || !t) return null;
  const direct = scoreVariant(q, t);
  const initial = initials(t);
  const initialScore = initial ? scoreVariant(q, initial) : null;
  return Math.max(direct ?? -1, initialScore === null ? -1 : Math.min(94, initialScore)) >= 0
    ? Math.max(direct ?? -1, initialScore === null ? -1 : Math.min(94, initialScore))
    : null;
}

function pushResult(list: SearchResult[], r: SearchResult): void {
  const exist = list.find((x) => x.id === r.id);
  if (!exist || exist.score < r.score) {
    if (exist) Object.assign(exist, r);
    else list.push(r);
  }
}

export const MAX_RESULTS = 20;

function resultPinned(id: string, pinned: Set<string>): boolean {
  return pinned.has(id);
}

export function searchQuery(text: string | InputPayload, deps: EngineDeps): SearchResult[] {
  const input = typeof text === "string" ? undefined : text;
  const q = typeof text === "string" ? text.trim() : text.type === "text" ? text.text.trim() : "";
  const inputKind: "text" | "img" | "files" = input?.type ?? "text";
  const usage = deps.usage ?? {};
  const pinned = new Set(deps.pinnedIds ?? []);
  const results: SearchResult[] = [];
  const boost = (id: string) => Math.min(15, (usage[id]?.count ?? 0) * 2);

  if (!q && !input) {
    const recentIds = Object.entries(usage)
      .filter(([, u]) => u.count > 0)
      .sort((a, b) => b[1].last - a[1].last || b[1].count - a[1].count)
      .slice(0, 18)
      .map(([id]) => id);
    const byId = new Map<string, SearchResult>();
    const put = (r: SearchResult) => {
      if (!byId.has(r.id)) byId.set(r.id, r);
    };
    for (const f of deps.features) {
      if (!platformMatches(f.feature.platform)) continue;
      const id = `plugin:${f.pluginId}:${f.feature.code}`;
      put({ id, title: f.feature.explain, subtitle: f.displayName, icon: f.logo, kind: "plugin", score: 30, pinned: resultPinned(id, pinned), pluginId: f.pluginId, featureCode: f.feature.code, section: "plugin", pluginCmds: f.feature.cmds.map((c) => typeof c === "string" ? c : commandLabel(c, f.feature.explain)) });
    }
    for (const a of deps.apps) {
      const id = `app:${a.path}`;
      put({ id, title: a.name, subtitle: a.path, icon: a.icon, kind: "app", score: 29, pinned: resultPinned(id, pinned), section: "plugin" });
    }
    for (const c of deps.commands) {
      const id = `cmd:${c.id}`;
      put({ id, title: c.title, builtinIcon: c.builtinIcon, kind: "command", score: 28, pinned: resultPinned(id, pinned), section: "plugin" });
    }
    for (const f of deps.files ?? []) {
      const id = `file:${f.path}`;
      put({ id, title: f.name, subtitle: f.path, kind: "file", score: 20, pinned: resultPinned(id, pinned), filePath: f.path, section: "plugin" });
    }
    for (const c of deps.clipboard ?? []) {
      const id = `clipboard:${c.id}`;
      put({ id, title: c.text?.split(/\r?\n/, 1)[0] || (c.paths?.[0] ? c.paths[0].split(/[\\/]/).pop() : "剪贴板内容") || "剪贴板内容", subtitle: c.text ?? c.paths?.join("、"), kind: "clipboard", score: 19, pinned: resultPinned(id, pinned), clipboardId: c.id, section: "plugin" });
    }
    const emitted = new Set<string>();
    const collect = (r: SearchResult, section: SearchResult["section"]) => {
      if (emitted.has(r.id)) return;
      emitted.add(r.id);
      results.push({ ...r, section });
    };
    for (const id of recentIds) {
      const hit = byId.get(id);
      if (hit) collect(hit, "recent");
    }
    for (const id of pinned) {
      const hit = byId.get(id);
      if (hit) collect(hit, "pinned");
    }
    for (const hit of byId.values()) {
      if (hit.kind === "plugin" && !emitted.has(hit.id)) collect(hit, "plugin");
    }
    for (const hit of byId.values()) {
      if (hit.kind === "command" && !emitted.has(hit.id)) collect(hit, "plugin");
    }
    collect({ id: "open:market", title: "插件应用市场", subtitle: "浏览与安装更多插件", builtinIcon: "🛍️", kind: "command", score: 25, section: "market" }, "market");
    return results;
  }

  for (const app of deps.apps) {
    const candidates = [app.name, ...(app.aliases ?? [])];
    const score = Math.max(...candidates.map((value) => matchScore(q, value) ?? -1));
    if (score >= 0) {
      const id = `app:${app.path}`;
      pushResult(results, { id, title: app.name, subtitle: app.path, icon: app.icon, kind: "app", score: score + boost(id), pinned: resultPinned(id, pinned) });
    }
  }
  for (const file of deps.files ?? []) {
    const candidates = [file.name, file.path, ...(file.aliases ?? [])];
    const score = Math.max(...candidates.map((value) => matchScore(q, value) ?? -1));
    if (score >= 0) {
      const id = `file:${file.path}`;
      pushResult(results, { id, title: file.name, subtitle: file.path, kind: "file", filePath: file.path, score: score + boost(id), pinned: resultPinned(id, pinned) });
    }
  }
  for (const item of deps.clipboard ?? []) {
    const candidates = [item.text ?? "", ...(item.paths ?? [])];
    const score = Math.max(...candidates.map((value) => matchScore(q, value) ?? -1));
    if (score >= 0) {
      const id = `clipboard:${item.id}`;
      pushResult(results, { id, title: item.text?.split(/\r?\n/, 1)[0] || item.paths?.[0] || "剪贴板内容", subtitle: item.text ?? item.paths?.join("、"), builtinIcon: "📋", kind: "clipboard", clipboardId: item.id, score: score + boost(id), pinned: resultPinned(id, pinned) });
    }
  }
  for (const c of deps.commands) {
    let best: number | null = matchScore(q, c.title);
    for (const kw of c.keywords) {
      const s = matchScore(q, kw);
      if (s !== null && (best === null || s > best)) best = s + 5;
    }
    if (best !== null) {
      const id = `cmd:${c.id}`;
      pushResult(results, { id, title: c.title, builtinIcon: c.builtinIcon, kind: "command", score: best + boost(id), pinned: resultPinned(id, pinned) });
    }
  }
  for (const f of deps.features) {
    if (!platformMatches(f.feature.platform)) continue;
    let best: number | null = null;
    let bestType: PluginCommandType = "text";
    for (const cmd of f.feature.cmds) {
      if (typeof cmd === "string") {
        if (inputKind !== "text") continue;
        const s = matchScore(q, cmd);
        if (s !== null && (best === null || s > best)) {
          best = s + 8;
          bestType = q === cmd.trim().toLowerCase() ? "over" : "text";
        }
      } else if (cmd.type === "regex" && inputKind === "text" && cmd.match) {
        const min = cmd.minLength ?? 1;
        if (q.length >= min && compiledRegex(cmd.match)?.test(q)) {
          if (best === null || 60 > best) {
            best = 60;
            bestType = "regex";
          }
        }
      } else if ((cmd.type === "text" || cmd.type === "over") && inputKind === "text" && (cmd.match || cmd.cmd || cmd.label)) {
        const match = cmd.match ?? cmd.cmd ?? cmd.label ?? "";
        const min = cmd.minLength ?? 1;
        if (q.length >= min && matchScore(q, match) !== null) {
          const s = matchScore(q, match) ?? 0;
          if (best === null || s > best) {
            best = s;
            bestType = cmd.type as PluginCommandType;
          }
        }
      } else if (cmd.type === "img" && inputKind === "img") {
        best = Math.max(best ?? 0, 80);
        bestType = "img";
      } else if (cmd.type === "files" && inputKind === "files") {
        const accepts = cmd.fileType;
        const files = input?.type === "files" ? input.files : [];
        const accepted = !accepts || files.some((file) => {
          const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase() : "";
          const list = Array.isArray(accepts) ? accepts : [accepts];
          return list.some((value) => String(value).toLowerCase() === ext || String(value).toLowerCase() === file.kind);
        });
        if (accepted) {
          best = Math.max(best ?? 0, 80);
          bestType = "files";
        }
      }
    }
    if (best !== null) {
      const id = `plugin:${f.pluginId}:${f.feature.code}`;
      pushResult(results, { id, title: f.feature.explain, subtitle: f.displayName, icon: f.logo, kind: "plugin", score: best + boost(id), pinned: resultPinned(id, pinned), pluginId: f.pluginId, featureCode: f.feature.code, cmdType: bestType, payload: input ?? q, queryText: q, input: input ? { version: 1, payload: input } : undefined, pluginCmds: f.feature.cmds.map((c) => typeof c === "string" ? c : commandLabel(c, f.feature.explain)) });
    }
  }

  results.sort((a, b) => b.score - a.score);
  const top = results.slice(0, MAX_RESULTS);
  if (top.length < 4) {
    top.push(
      { id: "web:google", title: `Google 搜索 “${q}”`, subtitle: "web", builtinIcon: "🌐", kind: "web", score: 5, webQuery: q },
      { id: "web:baidu", title: `百度搜索 “${q}”`, subtitle: "web", builtinIcon: "🔍", kind: "web", score: 4, webQuery: q },
    );
  }
  return top;
}
