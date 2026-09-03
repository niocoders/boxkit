import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IPC, type InputPayload, type PluginModeState, type SearchResult } from "@boxkit/shared";
import { boxkit, type AsyncStatus, type SearchExecutionResult } from "./bridge.js";

type Mode = "search" | "plugin";

/** 顶栏右侧品牌小 logo：内联 SVG，蓝色渐变圆角方块 + B */
const BRAND_LOGO =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f6bff"/><stop offset="1" stop-color="#23c4ff"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#g)"/><text x="16" y="21.5" font-family="Arial,sans-serif" font-size="16" font-weight="700" fill="#fff" text-anchor="middle">B</text></svg>`,
  );

/** 展开的副命令状态 */
interface Expanded {
  base: SearchResult;
  cmds: string[];
}

interface GridGroup {
  key: "recent" | "pinned" | "plugin" | "market";
  title: string;
  action?: string;
  items: SearchResult[];
}

function ResultIcon({ r, size = 34 }: { r: SearchResult; size?: number }) {
  const style = { width: size, height: size };
  if (r.icon) {
    return <img className="r-icon" style={style} src={r.icon} alt="" draggable={false} />;
  }
  if (r.builtinIcon) {
    return (
      <span className="r-icon r-emoji" style={style}>
        {r.builtinIcon}
      </span>
    );
  }
  return (
    <span className="r-icon r-avatar" style={style}>
      {(r.title?.[0] ?? "?").toUpperCase()}
    </span>
  );
}

/** 关键字命中高亮 */
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
  file: { label: "文件", dim: true },
  clipboard: { label: "剪贴板", dim: true },
  web: { label: "网络", dim: true },
};

const GRID_COLUMNS = 9;

type ContextMenuState = {
  result: SearchResult;
  x: number;
  y: number;
};

type ExecutionRetry = {
  result: SearchResult;
  hideOnSuccess: boolean;
};

function errorText(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const normalized = raw.toLowerCase();
  if (/enoent|not found|不存在|已过期|无效|invalid/.test(normalized)) return "目标已失效，请重试或更新索引";
  if (/eacces|permission|denied|拒绝|权限/.test(normalized)) return "操作被拒绝，请检查权限";
  if (/timeout|timed out|network|fetch|econn|网络/.test(normalized)) return "服务暂时不可用，请重试";
  return fallback;
}

function executionError(response: SearchExecutionResult | null, thrown: unknown): string {
  if (response?.code === "FORBIDDEN") return "操作被拒绝，请检查权限";
  return errorText(thrown ?? response?.message, response?.message ? "操作失败，请重试" : "操作失败，请重试");
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Use the selection fallback below when clipboard permissions are unavailable.
  }
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "true");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

export function App() {
  const [mode, setMode] = useState<Mode>("search");
  const [pluginState, setPluginState] = useState<PluginModeState>({ mode: "search" });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [queryStatus, setQueryStatus] = useState<AsyncStatus>("idle");
  const [queryError, setQueryError] = useState<string | null>(null);
  const [inputPayload, setInputPayload] = useState<InputPayload | null>(null);
  const [selected, setSelected] = useState(0);
  const [expanded, setExpanded] = useState<Expanded | null>(null);
  const [recentExpanded, setRecentExpanded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [clipboardCaptureError, setClipboardCaptureError] = useState<string | null>(null);
  const [executionStatus, setExecutionStatus] = useState<AsyncStatus>("idle");
  const [executionErrorMessage, setExecutionErrorMessage] = useState<string | null>(null);
  const [executionRetry, setExecutionRetry] = useState<ExecutionRetry | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);
  const inputPayloadRef = useRef<InputPayload | null>(null);
  const queryRef = useRef("");
  const setPayload = useCallback((payload: InputPayload | null) => {
    inputPayloadRef.current = payload;
    setInputPayload(payload);
  }, []);

  const runQuery = useCallback(async (text: string, payload: InputPayload | null = inputPayloadRef.current) => {
    const seq = ++seqRef.current;
    setQueryStatus("loading");
    setQueryError(null);
    try {
      const rs = await boxkit.query(payload ?? text);
      if (seq !== seqRef.current) return; // 过期响应丢弃
      setResults(rs);
      setQueryStatus(rs.length ? "success" : "empty");
      setSelected(0);
      setExpanded(null);
    } catch (error) {
      if (seq !== seqRef.current) return;
      setResults([]);
      setQueryStatus("error");
      setQueryError(errorText(error, "搜索失败，请重试"));
    }
  }, []);

  useEffect(() => {
    void boxkit.favorites?.get().then((state) => setPinnedIds(new Set(state.ids)));
  }, []);

  const onInputChange = useCallback((value: string) => {
    queryRef.current = value;
    setPayload(null);
    setQuery(value);
  }, [setPayload]);

  const togglePinned = useCallback(async (id: string) => {
    const next = pinnedIds.has(id)
      ? await boxkit.favorites?.unpin(id)
      : await boxkit.favorites?.pin(id);
    if (next) setPinnedIds(new Set(next.ids));
    void runQuery(query);
  }, [pinnedIds, query, runQuery]);

  // 插件兼容 API 对主搜索框的值/焦点控制
  useEffect(() => {
    const off = boxkit.onInputCommand?.((command, value) => {
      if (command === IPC.searchSetInput) setQuery(String(value ?? ""));
      if (command === IPC.searchInputFocus || command === IPC.searchInputSelect) inputRef.current?.focus();
      if (command === IPC.searchInputBlur) inputRef.current?.blur();
    });
    return () => off?.();
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
      void runQuery(queryRef.current);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const offData = boxkit.onSearchDataChanged?.(() => void runQuery(query));
    return () => offData?.();
  }, [runQuery, query]);

  useEffect(() => {
    const onPaste = async (event: ClipboardEvent) => {
      const data = event.clipboardData;
      if (!data) return;
      const paths = Array.from(data.files ?? [])
        .map((file) => boxkit.getPathForFile?.(file) ?? "")
        .filter(Boolean);
      const imageItem = Array.from(data.items ?? []).find(
        (item) => item.kind === "file" && item.type.toLowerCase().startsWith("image/"),
      );
      const imageFile = imageItem?.getAsFile();
      const text = data.getData("text/plain");
      if (paths.length) {
        const payload: InputPayload = { type: "files", files: paths.map((filePath) => ({ path: filePath, name: filePath.split(/[\\/]/).pop() ?? filePath, kind: "file" })) };
        setPayload(payload);
        void runQuery("", payload);
        event.preventDefault();
        return;
      }
      if (imageFile) {
        const maxBytes = 4 * 1024 * 1024;
        if (imageFile.size > maxBytes) {
          setClipboardCaptureError("图片过大，无法处理");
          return;
        }
        const buffer = await imageFile.arrayBuffer();
        const payload: InputPayload = {
          type: "img",
          mime: imageFile.type || "image/png",
          size: buffer.byteLength,
          tempRef: `clipboard-image-${Date.now().toString(36)}`,
          data: new Uint8Array(buffer),
        };
        event.preventDefault();
        setClipboardCaptureError(null);
        setPayload(payload);
        void runQuery("", payload);
        return;
      }
      if (!text) return;
      event.preventDefault();
      setPayload({ type: "text", text, source: "paste" });
      setQuery(text.slice(0, 1000));
    };
    const onDrop = (event: DragEvent) => {
      const paths = Array.from(event.dataTransfer?.files ?? [])
        .map((file) => boxkit.getPathForFile?.(file) ?? "")
        .filter(Boolean);
      if (!paths.length) return;
      event.preventDefault();
      const payload: InputPayload = { type: "files", files: paths.map((filePath) => ({ path: filePath, name: filePath.split(/[\\/]/).pop() ?? filePath, kind: "file" })) };
      setPayload(payload);
      void runQuery("", payload);
    };
    const onDragOver = (event: DragEvent) => event.preventDefault();
    window.addEventListener("paste", onPaste);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onDragOver);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragover", onDragOver);
    };
  }, [runQuery, query]);

  // 输入防抖查询
  useEffect(() => {
    const t = setTimeout(() => {
      if (mode === "search") void runQuery(query, inputPayloadRef.current);
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

  const isGrid = mode === "search" && queryStatus === "success" && !query && !expanded && results.length > 0;

  // 空态网格分组（最近使用 / 已固定 / 全部功能 / 市场精选）
  const gridGroups = useMemo<GridGroup[]>(() => {
    if (!isGrid) return [];
    const by = (s: string) => results.filter((r) => (r.section ?? "plugin") === s);
    const recentAll = by("recent");
    const groups: GridGroup[] = [];
    groups.push({
      key: "recent",
      title: "最近使用",
      action: recentAll.length > GRID_COLUMNS ? (recentExpanded ? "收起" : `展开 (${recentAll.length})`) : undefined,
      items: recentExpanded ? recentAll : recentAll.slice(0, GRID_COLUMNS),
    });
    groups.push({
      key: "pinned",
      title: "已固定",
      items: by("pinned"),
    });
    groups.push({
      key: "plugin",
      title: "全部功能",
      items: by("plugin"),
    });
    groups.push({ key: "market", title: "市场精选", items: by("market") });
    return groups.filter((g) => g.items.length > 0);
  }, [isGrid, results, recentExpanded]);

  // 网格扁平导航序
  const flatGrid = useMemo(() => gridGroups.flatMap((g) => g.items), [gridGroups]);

  const executeResult = useCallback(
    async (result: SearchResult, hideOnSuccess: boolean) => {
      if (executionStatus === "loading") return false;
      setExecutionStatus("loading");
      setExecutionErrorMessage(null);
      setExecutionRetry({ result, hideOnSuccess });
      try {
        const response = await boxkit.execute(result);
        if (response?.ok) {
          setExecutionStatus("success");
          setExecutionRetry(null);
          if (hideOnSuccess) setTimeout(() => boxkit.hide(), 150);
          return true;
        }
        setExecutionStatus("error");
        setExecutionErrorMessage(executionError(response ?? null, null));
        inputRef.current?.focus();
        return false;
      } catch (error) {
        setExecutionStatus("error");
        setExecutionErrorMessage(executionError(null, error));
        inputRef.current?.focus();
        return false;
      }
    },
    [executionStatus],
  );

  const executeGridItem = useCallback(
    (r: SearchResult) => void executeResult(r, r.kind !== "plugin"),
    [executeResult],
  );

  const executeAt = useCallback(
    (idx: number) => {
      const r = results[idx];
      if (!r) return;
      const currentQuery = queryRef.current.trim();
      const isExactPluginCommand = r.kind === "plugin"
        && (r.pluginCmds ?? []).some((cmd) => cmd.trim().toLowerCase() === currentQuery.toLowerCase());
      const executable = r.kind === "plugin"
        ? {
            ...r,
            queryText: r.queryText || currentQuery,
            payload: r.payload || currentQuery,
            cmdType: isExactPluginCommand ? "over" : (r.cmdType ?? "text"),
          }
        : r;
      void executeResult(executable, mode === "search" && executable.kind !== "plugin");
    },
    [executeResult, mode, results],
  );

  const retryQuery = useCallback(() => {
    void runQuery(query);
  }, [query, runQuery]);

  const retryExecution = useCallback(() => {
    if (executionRetry) void executeResult(executionRetry.result, executionRetry.hideOnSuccess);
  }, [executeResult, executionRetry]);

  const copyResultValue = useCallback(async (value: string, label = "内容") => {
    const copied = await copyText(value);
    setToast(copied ? `${label}已复制` : `无法复制${label}`);
    setTimeout(() => setToast(null), 2600);
  }, []);

  const openContextMenu = useCallback((result: SearchResult, x?: number, y?: number) => {
    setContextMenu({ result, x: x ?? Math.round(window.innerWidth / 2), y: y ?? 80 });
    setSelected((current) => {
      const index = (isGrid ? flatGrid : results).findIndex((item) => item.id === result.id);
      return index >= 0 ? index : current;
    });
  }, [flatGrid, isGrid, results]);

  const contextValue = contextMenu?.result.filePath
    ?? (contextMenu?.result.kind === "file" || contextMenu?.result.kind === "app" ? contextMenu.result.subtitle : undefined);
  const activeResult = isGrid
    ? flatGrid[selected]
    : expanded
      ? (expanded.cmds[selected] === undefined ? undefined : { ...expanded.base, payload: expanded.cmds[selected], cmdType: "over" as const })
      : results[selected];
  const activeResultId = activeResult
    ? (expanded ? `search-option-command-${selected}` : isGrid ? `search-gridcell-${selected}` : `search-option-${selected}`)
    : undefined;
  const listId = isGrid ? "search-grid" : "search-results";
  const showQueryError = mode === "search" && queryStatus === "error";
  const showQueryLoading = mode === "search" && queryStatus === "loading";
  const showQueryEmpty = mode === "search" && queryStatus === "empty";

  useEffect(() => {
    if (!contextMenu) return;
    const first = contextMenuRef.current?.querySelector<HTMLButtonElement>("button");
    first?.focus();
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: MouseEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) setContextMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [contextMenu]);

  const listCount = expanded ? expanded.cmds.length : results.length;

  const executeCurrent = useCallback(() => {
    if (isGrid) {
      const r = flatGrid[selected];
      if (r) executeGridItem(r);
      return;
    }
    if (expanded) {
      const cmd = expanded.cmds[selected];
      if (cmd === undefined) return;
      void executeResult({ ...expanded.base, payload: cmd, cmdType: "over" }, true);
      return;
    }
    executeAt(selected);
  }, [isGrid, flatGrid, selected, executeGridItem, expanded, executeAt, executeResult]);

  // 脱离插件为独立窗口（detachPlugin 声明由 bridge 后续补充，此处局部断言避免类型冲突）
  const detachCurrentPlugin = useCallback((name: string) => {
    void (boxkit as unknown as {
      detachPlugin: (n: string) => Promise<{ ok: boolean; error?: string }>;
    }).detachPlugin(name);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (contextMenu) {
        setContextMenu(null);
        inputRef.current?.focus();
      } else if (mode === "plugin") {
        boxkit.exitPlugin();
      } else if (expanded) {
        setExpanded(null); // 先收起副命令
        setSelected(0);
        inputRef.current?.focus();
      } else if (query) {
        setQuery("");
        setPayload(null);
        inputRef.current?.focus();
      } else {
        boxkit.hide();
      }
      return;
    }
    if (mode === "search" && (e.key.toLowerCase() === "p") && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const current = isGrid ? flatGrid[selected] : results[selected];
      if (current) void togglePinned(current.id);
      return;
    }
    if (mode === "search" && (e.key === "F10" && e.shiftKey || e.key === "ContextMenu")) {
      e.preventDefault();
      if (activeResult) openContextMenu(activeResult);
      return;
    }
    if (mode === "plugin") {
      if (e.key.toLowerCase() === "d" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const name = pluginState.plugin?.name;
        if (name) detachCurrentPlugin(name);
        return;
      }
      return; // 输入转发给插件，不拦截
    }
    if (isGrid) {
      const n = flatGrid.length;
      if (!n) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setSelected((i) => Math.min(n - 1, i + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSelected((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((i) => Math.min(n - 1, i + GRID_COLUMNS));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((i) => Math.max(0, i - GRID_COLUMNS));
      } else if (e.key === "Enter") {
        e.preventDefault();
        executeCurrent();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => Math.min(Math.max(0, listCount - 1), i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(0, i - 1));
    } else if (e.key === "ArrowRight") {
      // → 展开选中插件的副命令（全部关键字）
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
    const el = listRef.current?.querySelector(".r-item.active, .g-item.active");
    el?.scrollIntoView({ block: "nearest" });
  }, [selected, expanded, isGrid]);

  const p = pluginState.plugin;
  const showList = mode === "search" && queryStatus !== "error" && !isGrid && (expanded ? expanded.cmds.length > 0 : results.length > 0);
  return (
    <div className="shell">
      <div className="header">
        {mode === "plugin" && (
          <button className="back" title="返回搜索 (Esc)" aria-label="返回搜索" onClick={() => boxkit.exitPlugin()}>
            ‹
          </button>
        )}
        {mode === "plugin" && p?.logo ? (
          <img className="p-logo" src={p.logo} alt="" draggable={false} />
        ) : null}
        <input
          ref={inputRef}
          className="input"
          value={query}
          placeholder={
            mode === "plugin"
              ? pluginState.subinput?.placeholder ?? `${p?.displayName ?? "插件"}已启动（未接管搜索框）`
              : "搜索功能 / 粘贴文件、图片"
          }
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="搜索功能"
          aria-controls={mode === "search" ? listId : undefined}
          aria-activedescendant={mode === "search" ? activeResultId : undefined}
          aria-expanded={mode === "search" ? showList || isGrid : undefined}
          aria-autocomplete="list"
          spellCheck={false}
          autoFocus
        />
        {mode === "plugin" && (
          <>
            <span className="p-name">{p?.displayName}</span>
            {p && (
              <button
                className="plugin-toolbar-button icon-only"
                title="插件设置"
                aria-label="插件设置"
                onClick={() => boxkit.openPluginSettings(p.name)}
              >
                ⚙
              </button>
            )}
            {p && (
              <button
                className="plugin-toolbar-button"
                title="脱离为独立窗口 (Ctrl+D)"
                aria-label="脱离为独立窗口"
                onClick={() => detachCurrentPlugin(p.name)}
              >
                ⤢ 脱离
              </button>
            )}
          </>
        )}
        {mode === "search" && (
          <button
            className="profile-entry"
            title="设置与本地概览"
            aria-label="打开设置与本地概览"
            onClick={() => boxkit.openProfile()}
          >
            B
          </button>
        )}
      </div>

      {isGrid && (
        <div
          className="grid-scroll grid-only"
          ref={listRef}
          id={listId}
          role="grid"
          aria-label="搜索结果"
          aria-rowcount={gridGroups.length}
        >
          {gridGroups.map((g) => (
            <div className="grid-group" key={g.key} role="row">
              <div className="group-head" role="presentation">
                <span className="group-title">{g.title}</span>
                {g.action && (
                  <button
                    type="button"
                    className="group-action"
                    onClick={() => {
                      if (g.key === "recent") setRecentExpanded((v) => !v);
                    }}
                  >
                    {g.action}
                  </button>
                )}
              </div>
              <div className="icon-grid" role="row" aria-label={g.title}>
                {g.items.map((r) => {
                  const idx = flatGrid.indexOf(r);
                  const itemId = `search-gridcell-${idx}`;
                  return (
                    <div
                      key={g.key + r.id}
                      id={itemId}
                      className={`g-item ${idx === selected ? "active" : ""}`}
                      role="gridcell"
                      aria-selected={idx === selected}
                      tabIndex={-1}
                      onMouseEnter={() => setSelected(idx)}
                      onClick={() => executeGridItem(r)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        openContextMenu(r, event.clientX, event.clientY);
                      }}
                      title={`${r.subtitle ?? ""}${r.pinned ? " · 已固定" : ""}`}
                    >
                      <ResultIcon r={r} size={48} />
                      <span className="g-label">{r.title}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {showList && (
        <div className="results" ref={listRef} id={listId} role="listbox" aria-label="搜索结果">
          {expanded && <div className="section-label">「{expanded.base.title}」的关键字</div>}
          {mode === "search" && !expanded && query && (
            <div className="section-label">最佳匹配</div>
          )}
          {(expanded ? expanded.cmds : results).map((item, i) => {
            if (expanded) {
              const cmd = item as string;
              return (
                <div
                  key={`${expanded.base.id}:${cmd}`}
                  id={`search-option-command-${i}`}
                  className={`r-item ${i === selected ? "active" : ""}`}
                  role="option"
                  aria-selected={i === selected}
                  tabIndex={-1}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => void executeResult({ ...expanded.base, payload: cmd, cmdType: "over" }, true)}
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
                id={`search-option-${i}`}
                className={`r-item ${i === selected ? "active" : ""}`}
                role="option"
                aria-selected={i === selected}
                tabIndex={-1}
                onMouseEnter={() => setSelected(i)}
                onClick={() => executeAt(i)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openContextMenu(r, event.clientX, event.clientY);
                }}
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
                  <button
                    type="button"
                    className="r-expand"
                    aria-label={`展开 ${r.title} 的副命令`}
                    title="展开全部关键字 (→)"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpanded({ base: r, cmds: r.pluginCmds! });
                      setSelected(0);
                    }}
                  >
                    ›
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {mode === "search" && !isGrid && !showList && (
        <div className={`empty ${showQueryError ? "state-error" : ""}`}>
          {showQueryError ? (
            <div className="state-panel" role="alert" aria-live="assertive">
              <span>{queryError ?? "搜索失败，请重试"}</span>
              <button type="button" className="state-action" onClick={retryQuery} disabled={showQueryLoading}>
                重试
              </button>
            </div>
          ) : showQueryLoading ? (
            <div className="state-panel" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              <span>搜索中…</span>
            </div>
          ) : query ? (
            "没有匹配结果"
          ) : (
            "输入以搜索；插件市场在设置中"
          )}
        </div>
      )}

      {mode === "search" && showQueryLoading && showList && (
        <div className="inline-status" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          正在更新结果
        </div>
      )}

      {executionStatus === "loading" && (
        <div className="inline-status execution-status" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          正在打开
        </div>
      )}
      {executionStatus === "error" && executionErrorMessage && (
        <div className="execution-error" role="alert" aria-live="assertive">
          <span>{executionErrorMessage}</span>
          <button type="button" className="state-action" onClick={retryExecution} disabled={!executionRetry}>
            重试
          </button>
          <button type="button" className="state-action" onClick={() => void copyText(executionErrorMessage)}>
            复制错误
          </button>
        </div>
      )}

      {mode === "plugin" && <div className="plugin-hint">Esc 返回搜索面板 · 内容区域由插件提供</div>}

      <div className="footer">
        <span>↑↓←→ 选择</span>
        <span>↵ 打开</span>
        {mode === "search" && !expanded && !isGrid && <span>→ 副命令</span>}
        {mode === "search" && expanded && <span>← 返回</span>}
        {isGrid && <span>Tab 展开/收起</span>}
        <span>{mode === "plugin" ? "Esc 返回" : "Esc 隐藏"}</span>
        <span className="spacer" />
        {mode === "search" && (
          <button type="button" className="f-entry" title="插件市场与设置" onClick={() => boxkit.openSettings()}>
            ⚙ 设置 / 市场
          </button>
        )}
      </div>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          role="menu"
          aria-label={`${contextMenu.result.title} 上下文菜单`}
          style={{ left: Math.min(contextMenu.x, Math.max(8, window.innerWidth - 190)), top: Math.min(contextMenu.y, Math.max(8, window.innerHeight - 110)) }}
        >
          <button type="button" role="menuitem" onClick={() => { void togglePinned(contextMenu.result.id); setContextMenu(null); inputRef.current?.focus(); }}>
            {contextMenu.result.pinned || pinnedIds.has(contextMenu.result.id) ? "取消固定" : "固定"}
          </button>
          {contextMenu.result.kind === "plugin" && contextMenu.result.pluginId && (
            <button type="button" role="menuitem" onClick={() => { boxkit.openPluginSettings(contextMenu.result.pluginId!); setContextMenu(null); }}>
              插件设置
            </button>
          )}
          {contextValue && (
            <button type="button" role="menuitem" onClick={() => { void copyResultValue(contextValue, "路径"); setContextMenu(null); inputRef.current?.focus(); }}>
              复制路径
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => { setContextMenu(null); inputRef.current?.focus(); }}>
            取消
          </button>
        </div>
      )}

      {clipboardCaptureError && <div className="toast" role="alert">{clipboardCaptureError}</div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
