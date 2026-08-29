import { useCallback, useEffect, useRef, useState } from "react";
import type { PluginModeState, SearchResult } from "@boxkit/shared";
import { boxkit } from "./bridge.js";

type Mode = "search" | "plugin";

/** 展开的副命令状态：uTools 式「→ 展开插件关键字」 */
interface Expanded {
  base: SearchResult;
  cmds: string[];
}

function ResultIcon({ r }: { r: SearchResult }) {
  if (r.icon) {
    return <img className="r-icon" src={r.icon} alt="" draggable={false} />;
  }
  if (r.builtinIcon) {
    return <span className="r-icon r-emoji">{r.builtinIcon}</span>;
  }
  return <span className="r-icon r-avatar">{(r.title?.[0] ?? "?").toUpperCase()}</span>;
}

/** 关键字命中高亮（uTools 蓝色高亮风格） */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="hl">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

const KIND_BADGE: Record<string, { label: string; dim?: boolean }> = {
  plugin: { label: "插件" },
  app: { label: "应用", dim: true },
  command: { label: "命令", dim: true },
  web: { label: "网络", dim: true },
};

export function App() {
  const [mode, setMode] = useState<Mode>("search");
  const [pluginState, setPluginState] = useState<PluginModeState>({ mode: "search" });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState(0);
  const [expanded, setExpanded] = useState<Expanded | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  const runQuery = useCallback(async (text: string) => {
    const seq = ++seqRef.current;
    try {
      const rs = await boxkit.query(text);
      if (seq !== seqRef.current) return; // 过期响应丢弃
      setResults(rs);
      setSelected(0);
      setExpanded(null);
    } catch {
      setResults([]);
    }
  }, []);

  // 主进程模式推送（搜索 ⇄ 插件）
  useEffect(() => {
    const off = boxkit.onPluginState((s) => {
      setPluginState(s);
      setMode(s.mode);
      if (s.mode === "plugin") {
        setResults([]);
        setQuery("");
        setTimeout(() => inputRef.current?.focus(), 50);
      } else {
        setQuery("");
        void runQuery("");
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    });
    const offChanged = boxkit.onPluginChanged(() => {
      void runQuery(query);
    });
    return () => {
      off();
      offChanged();
    };
  }, [runQuery, query]);

  // 初始空查询 + 聚焦时刷新
  useEffect(() => {
    void runQuery("");
    const onFocus = () => {
      inputRef.current?.focus();
      void runQuery(query);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 输入防抖查询
  useEffect(() => {
    const t = setTimeout(() => {
      if (mode === "search") void runQuery(query);
      else boxkit.sendInput(query);
    }, 40);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mode]);

  // Toast
  useEffect(() => {
    return boxkit.onToast((msg) => {
      setToast(msg);
      setTimeout(() => setToast(null), 2600);
    });
  }, []);

  const executeAt = useCallback(
    (idx: number) => {
      const r = results[idx];
      if (!r) return;
      void boxkit.execute(r);
      if (mode === "search" && r.kind !== "plugin") {
        // 启动应用/命令后收起面板
        setTimeout(() => boxkit.hide(), 150);
      }
    },
    [results, mode],
  );

  const listCount = expanded ? expanded.cmds.length : results.length;

  const executeCurrent = useCallback(() => {
    if (expanded) {
      const cmd = expanded.cmds[selected];
      if (cmd === undefined) return;
      void boxkit.execute({ ...expanded.base, payload: cmd, cmdType: "over" });
      setTimeout(() => boxkit.hide(), 150);
      return;
    }
    executeAt(selected);
  }, [expanded, selected, executeAt]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (mode === "plugin") {
        boxkit.exitPlugin();
      } else if (expanded) {
        setExpanded(null); // 先收起副命令
      } else {
        boxkit.hide();
      }
      return;
    }
    if (mode === "plugin") return; // 输入转发给插件，不拦截
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => Math.min(listCount - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(0, i - 1));
    } else if (e.key === "ArrowRight") {
      // uTools 式：→ 展开选中插件的副命令（全部关键字）
      if (!expanded) {
        const r = results[selected];
        if (r?.kind === "plugin" && r.pluginCmds && r.pluginCmds.length > 1) {
          e.preventDefault();
          setExpanded({ base: r, cmds: r.pluginCmds });
          setSelected(0);
        }
      }
    } else if (e.key === "ArrowLeft") {
      if (expanded) {
        e.preventDefault();
        setExpanded(null);
        setSelected(0);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      executeCurrent();
    }
  };

  useEffect(() => {
    const el = listRef.current?.querySelector(".r-item.active");
    el?.scrollIntoView({ block: "nearest" });
  }, [selected, expanded]);

  const p = pluginState.plugin;
  const showList = mode === "search" && (expanded ? expanded.cmds.length > 0 : results.length > 0);
  return (
    <div className="shell">
      <div className="header">
        {mode === "plugin" && (
          <button className="back" title="返回搜索 (Esc)" onClick={() => boxkit.exitPlugin()}>
            ‹
          </button>
        )}
        {mode === "plugin" && p?.logo ? (
          <img className="p-logo" src={p.logo} alt="" draggable={false} />
        ) : (
          <span className="app-mark">B</span>
        )}
        <input
          ref={inputRef}
          className="input"
          value={query}
          placeholder={
            mode === "plugin"
              ? pluginState.subinput?.placeholder ?? `${p?.displayName ?? "插件"}已启动（未接管搜索框）`
              : "搜索应用、命令、插件，或输入关键字…"
          }
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoFocus
        />
        {mode === "plugin" && <span className="p-name">{p?.displayName}</span>}
      </div>

      {showList && (
        <div className="results" ref={listRef}>
          {expanded && <div className="section-label">「{expanded.base.title}」的关键字</div>}
          {(expanded ? expanded.cmds : results).map((item, i) => {
            if (expanded) {
              const cmd = item as string;
              return (
                <div
                  key={`${expanded.base.id}:${cmd}`}
                  className={`r-item ${i === selected ? "active" : ""}`}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => {
                    void boxkit.execute({ ...expanded.base, payload: cmd, cmdType: "over" });
                    setTimeout(() => boxkit.hide(), 150);
                  }}
                >
                  <ResultIcon r={expanded.base} />
                  <div className="r-main">
                    <div className="r-title">{cmd}</div>
                    <div className="r-sub">{expanded.base.title} · 以此关键字进入插件</div>
                  </div>
                  <span className="r-badge dim">副命令</span>
                </div>
              );
            }
            const r = item as SearchResult;
            const badge = KIND_BADGE[r.kind];
            const expandable = r.kind === "plugin" && (r.pluginCmds?.length ?? 0) > 1;
            return (
              <div
                key={r.id}
                className={`r-item ${i === selected ? "active" : ""}`}
                onMouseEnter={() => setSelected(i)}
                onClick={() => executeAt(i)}
              >
                <ResultIcon r={r} />
                <div className="r-main">
                  <div className="r-title">
                    <Highlight text={r.title} query={query} />
                  </div>
                  {r.subtitle && (
                    <div className="r-sub">
                      <Highlight text={r.subtitle} query={query} />
                    </div>
                  )}
                </div>
                {badge && <span className={`r-badge ${badge.dim ? "dim" : ""}`}>{badge.label}</span>}
                {expandable && (
                  <span
                    className="r-expand"
                    title="展开全部关键字 (→)"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpanded({ base: r, cmds: r.pluginCmds! });
                      setSelected(0);
                    }}
                  >
                    ›
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {mode === "search" && !showList && (
        <div className="empty">{query ? "没有匹配结果" : "输入以搜索；插件市场在设置中"}</div>
      )}

      {mode === "plugin" && <div className="plugin-hint">Esc 返回搜索面板 · 内容区域由插件提供</div>}

      <div className="footer">
        <span>↑↓ 选择</span>
        <span>↵ 打开</span>
        {mode === "search" && !expanded && <span>→ 副命令</span>}
        {mode === "search" && expanded && <span>← 返回</span>}
        <span>{mode === "plugin" ? "Esc 返回" : "Esc 隐藏"}</span>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
