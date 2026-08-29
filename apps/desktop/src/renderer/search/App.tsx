import { useCallback, useEffect, useRef, useState } from "react";
import type { PluginModeState, SearchResult } from "@boxkit/shared";
import { boxkit } from "./bridge.js";

type Mode = "search" | "plugin";

function ResultIcon({ r }: { r: SearchResult }) {
  if (r.icon) {
    return <img className="r-icon" src={r.icon} alt="" draggable={false} />;
  }
  if (r.builtinIcon) {
    return <span className="r-icon r-emoji">{r.builtinIcon}</span>;
  }
  return <span className="r-icon r-avatar">{(r.title?.[0] ?? "?").toUpperCase()}</span>;
}

export function App() {
  const [mode, setMode] = useState<Mode>("search");
  const [pluginState, setPluginState] = useState<PluginModeState>({ mode: "search" });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState(0);
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

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (mode === "plugin") boxkit.exitPlugin();
      else boxkit.hide();
      return;
    }
    if (mode === "plugin") return; // 输入转发给插件，不拦截
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      executeAt(selected);
    }
  };

  useEffect(() => {
    const el = listRef.current?.querySelector(".r-item.active");
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const p = pluginState.plugin;
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

      {mode === "search" && results.length > 0 && (
        <div className="results" ref={listRef}>
          {results.map((r, i) => (
            <div
              key={r.id}
              className={`r-item ${i === selected ? "active" : ""}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => executeAt(i)}
            >
              <ResultIcon r={r} />
              <div className="r-main">
                <div className="r-title">{r.title}</div>
                {r.subtitle && <div className="r-sub">{r.subtitle}</div>}
              </div>
              {r.kind === "plugin" && <span className="r-badge">插件</span>}
              {r.kind === "app" && <span className="r-badge dim">应用</span>}
              {r.kind === "command" && <span className="r-badge dim">命令</span>}
            </div>
          ))}
        </div>
      )}

      {mode === "search" && results.length === 0 && (
        <div className="empty">
          {query ? "没有匹配结果" : "输入以搜索；安装更多插件请打开设置"}
        </div>
      )}

      {mode === "plugin" && <div className="plugin-hint">Esc 返回搜索面板 · 内容区域由插件提供</div>}

      <div className="footer">
        <span>↑↓ 选择</span>
        <span>↵ 打开</span>
        <span>{mode === "plugin" ? "Esc 返回" : "Esc 隐藏"}</span>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
