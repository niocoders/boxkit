import { useEffect, useRef, useState } from "react";
import type {
  AppSettings,
  InstallPreview,
  LocalOverviewData,
  MarketPlugin,
  PluginListItem,
  UpdateState,
} from "@boxkit/shared";
import { boxkit } from "./bridge.js";

type Tab =
  | "overview"
  | "general"
  | "hotkeys"
  | "search"
  | "clipboard"
  | "plugins"
  | "appearance"
  | "advanced"
  | "about";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "overview", label: "本地概览", icon: "⌂" },
  { id: "general", label: "通用", icon: "⚙️" },
  { id: "hotkeys", label: "快捷键", icon: "⌘" },
  { id: "search", label: "搜索与索引", icon: "⌕" },
  { id: "clipboard", label: "剪贴板与本地数据", icon: "▣" },
  { id: "plugins", label: "插件", icon: "🧩" },
  { id: "appearance", label: "外观与窗口", icon: "◐" },
  { id: "advanced", label: "高级", icon: "⚙" },
  { id: "about", label: "关于", icon: "ℹ️" },
];

export function App() {
  const [tab, setTab] = useState<Tab>("overview");
  const [pluginView, setPluginView] = useState<"installed" | "market">("installed");
  const [toast, setToast] = useState<string | null>(null);
  const [protocolPreview, setProtocolPreview] = useState<{ preview: InstallPreview; conflict: string } | null>(null);
  const [marketRefreshKey, setMarketRefreshKey] = useState(0);
  const [targetPluginId, setTargetPluginId] = useState<string | null>(null);

  useEffect(() => {
    const off = boxkit.onSettingsShowTab((p) => {
      if (p.tab === "plugins") {
        setTab("plugins");
        setPluginView(p.view === "market" ? "market" : "installed");
        setTargetPluginId(p.pluginId ?? null);
      } else if (TABS.some((item) => item.id === p.tab)) {
        setTab(p.tab as Tab);
      }
    });
    boxkit.settingsReady();
    return off;
  }, []);

  useEffect(() => {
    return boxkit.onInstallPreview((p) => {
      setTab("plugins");
      setPluginView("installed");
      setProtocolPreview(p);
    });
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  };

  return (
    <div className="layout">
      <div className="sidebar">
        <div className="brand">
          <span className="brand-mark">B</span>
          <span>BoxKit 设置</span>
        </div>
        {TABS.map((t) => (
          <button key={t.id} className={`nav ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>
            <span className="nav-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
        <div className="sidebar-foot">
          <button onClick={() => boxkit.openLogs()}>打开日志目录</button>
        </div>
      </div>
      <div className="content">
        {tab === "overview" && <OverviewView />}
        {tab === "general" && <GeneralView showToast={showToast} />}
        {tab === "hotkeys" && (
          <HotkeysView
            showToast={showToast}
            onOpenPlugin={(pluginId) => {
              setPluginView("installed");
              setTargetPluginId(pluginId);
              setTab("plugins");
            }}
          />
        )}
        {tab === "search" && <SearchIndexView />}
        {tab === "clipboard" && <ClipboardDataView showToast={showToast} />}
        {tab === "plugins" && (
          <PluginsView
            showToast={showToast}
            view={pluginView}
            onViewChange={setPluginView}
            initialPreview={protocolPreview}
            onInitialPreviewConsumed={() => setProtocolPreview(null)}
            onMarketRefresh={() => setMarketRefreshKey((key) => key + 1)}
            marketRefreshKey={marketRefreshKey}
            targetPluginId={targetPluginId}
            onTargetPluginConsumed={() => setTargetPluginId(null)}
          />
        )}
        {tab === "appearance" && <AppearanceView />}
        {tab === "advanced" && <AdvancedView showToast={showToast} />}
        {tab === "about" && <AboutView />}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

// ————— 本地概览 / 通用 —————

function OverviewView() {
  const [cfg, setCfg] = useState<AppSettings | null>(null);
  const [plugins, setPlugins] = useState<PluginListItem[] | null>(null);
  const [overview, setOverview] = useState<LocalOverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    setError(null);
    void Promise.all([boxkit.configGet(), boxkit.plugins.list(), boxkit.overviewData()])
      .then(([nextCfg, nextPlugins, nextOverview]) => {
        setCfg(nextCfg);
        setPlugins(nextPlugins);
        setOverview(nextOverview);
      })
      .catch(() => setError("本地概览加载失败，请重试"));
  };

  useEffect(() => {
    reload();
  }, []);

  const enabled = (plugins ?? []).filter((plugin) => plugin.enabled).length;
  const shortcuts = Object.keys(cfg?.pluginHotkeys ?? {}).length;
  const days = overview ? Math.max(1, Math.ceil((Date.now() - overview.firstLaunchAt) / 86400000)) : 0;

  if (error) {
    return <div className="state-panel" role="alert"><span>{error}</span><button className="btn" onClick={reload}>重试</button></div>;
  }

  return (
    <>
      <h2>本地概览</h2>
      <p className="section-lead">BoxKit 的本地功能状态与数据范围</p>
      <section className="overview-identity card">
        <div className="about-brand">
          <span className="brand-mark big">B</span>
          <div>
            <div className="row-title">BoxKit {overview?.version ?? ""}</div>
            <div className="row-desc">已在本机运行 {days || "—"} 天</div>
          </div>
        </div>
      </section>
      <section className="overview-grid">
        <div className="summary-tile"><div className="summary-value">{plugins === null ? "—" : `${enabled}/${plugins.length}`}</div><div className="summary-label">启用插件</div><div className="row-desc">仅加载本地插件</div></div>
        <div className="summary-tile"><div className="summary-value">{cfg === null ? "—" : shortcuts}</div><div className="summary-label">插件快捷键</div><div className="row-desc">仅绑定插件功能</div></div>
        <div className="summary-tile"><div className="summary-value">{cfg?.clipboardHistoryEnabled ? "已开启" : "未开启"}</div><div className="summary-label">剪贴板历史</div><div className="row-desc">默认不保存剪贴板内容</div></div>
      </section>
      <section className="card overview-apps">
        <div className="row-title">常用应用</div>
        <div className="row-desc">仅显示有本机使用记录的应用</div>
        <div className="overview-app-grid">
          {(overview?.topApps ?? []).map((item) => (
            <button className="overview-app" key={item.path} title={item.path} onClick={() => void boxkit.overviewOpenApp(item.path)}>
              {item.icon ? <img src={item.icon} alt="" /> : <span>{item.name.slice(0, 1).toUpperCase()}</span>}
              <strong>{item.name}</strong><small>{item.count} 次</small>
            </button>
          ))}
          {overview && overview.topApps.length === 0 && <div className="empty-inline">还没有应用使用记录</div>}
        </div>
      </section>
      <section className="card overview-actions">
        <div className="row-title">系统操作</div>
        <div className="p-actions"><button className="btn" onClick={() => boxkit.openLogs()}>打开日志目录</button><button className="btn danger" onClick={() => boxkit.quit()}>退出 BoxKit</button></div>
      </section>
      <section className="card overview-note"><div className="row-title">本地优先</div><div className="row-desc">搜索索引、插件数据、使用统计和剪贴板历史均保留在本机。</div></section>
    </>
  );
}

function HotkeysView({
  showToast,
  onOpenPlugin,
}: {
  showToast: (m: string) => void;
  onOpenPlugin: (pluginId: string) => void;
}) {
  const [cfg, setCfg] = useState<AppSettings | null>(null);
  const [plugins, setPlugins] = useState<PluginListItem[] | null>(null);
  const cfgRef = useRef<AppSettings | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    void Promise.all([boxkit.configGet(), boxkit.plugins.list()]).then(([nextCfg, nextPlugins]) => {
      cfgRef.current = nextCfg;
      setCfg(nextCfg);
      setPlugins(nextPlugins);
    });
  }, []);

  const savePluginHotkey = (key: string, value: string): void => {
    const save = async () => {
      const current = cfgRef.current;
      if (!current) return;
      const pluginHotkeys = { ...(current.pluginHotkeys ?? {}) };
      if (value) pluginHotkeys[key] = value;
      else delete pluginHotkeys[key];
      const next = await boxkit.configSet({ pluginHotkeys });
      cfgRef.current = next.settings;
      setCfg(next.settings);
      showToast(next.hotkeyError ?? "快捷键已保存");
    };
    const queued = saveQueueRef.current.then(save, save);
    saveQueueRef.current = queued.catch(() => undefined);
    void queued.catch((error) => showToast(error instanceof Error ? error.message : "保存失败"));
  };

  return (
    <>
      <h2>快捷键</h2>
      <section className="card">
        <div className="row">
          <div>
            <div className="row-title">全局主快捷键</div>
            <div className="row-desc">唤起或隐藏搜索面板；点击右侧按钮后按下组合键录制</div>
          </div>
          <HotkeyRecorder
            value={cfg?.hotkey ?? ""}
            disabled={!cfg}
            onSave={(value) => {
              if (!value || value === cfg?.hotkey) return;
              void boxkit.configSet({ hotkey: value }).then((next) => {
                cfgRef.current = next.settings;
                setCfg(next.settings);
                showToast(next.hotkeyError ?? "快捷键已保存");
              });
            }}
          />
        </div>
      </section>
      <h3 className="subsection-title">插件功能快捷键</h3>
      <p className="section-lead">在这里集中管理，也可以从单个插件的设置中修改。</p>
      {plugins === null && <div className="loading">加载中…</div>}
      {plugins?.length === 0 && <section className="card"><div className="empty-inline">尚未安装任何插件</div></section>}
      {plugins?.map((plugin) => (
        <section className="card hotkey-plugin-card" key={plugin.name}>
          <div className="hotkey-plugin-heading">
            <div className="modal-plugin compact">
              {plugin.logo ? <img className="p-logo" src={plugin.logo} alt="" /> : <span className="p-logo p-fallback">{plugin.displayName[0]}</span>}
              <div>
                <div className="row-title">{plugin.displayName}</div>
                <div className="row-desc">{plugin.enabled ? `${plugin.features.length} 个功能` : "插件已停用"}</div>
              </div>
            </div>
            <button className="btn small" onClick={() => onOpenPlugin(plugin.name)}>插件设置</button>
          </div>
          <PluginHotkeyFields plugin={plugin} cfg={cfg} onSave={savePluginHotkey} />
        </section>
      ))}
    </>
  );
}

function SearchIndexView() {
  return (
    <>
      <h2>搜索与索引</h2>
      <section className="card">
        <div className="row">
          <div>
            <div className="row-title">本地搜索索引</div>
            <div className="row-desc">应用、插件功能和收藏项由后台维护，搜索面板打开时使用本机索引。</div>
          </div>
          <span className="status-pill ready">运行中</span>
        </div>
        <div className="row">
          <div>
            <div className="row-title">索引范围</div>
            <div className="row-desc">已安装应用、已启用插件功能、收藏结果</div>
          </div>
          <span className="row-desc">本地</span>
        </div>
      </section>
      <p className="hint-line">应用变化和插件变化会自动触发索引刷新。</p>
    </>
  );
}

function NumberSetting({
  value,
  min,
  max,
  label,
  onSave,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  onSave: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = Math.min(max, Math.max(min, Math.round(parsed)));
    setDraft(String(next));
    if (next !== value) onSave(next);
  };

  return (
    <input
      className="number-input"
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      aria-label={label}
    />
  );
}

function ClipboardDataView({ showToast }: { showToast: (m: string) => void }) {
  const [cfg, setCfg] = useState<AppSettings | null>(null);

  useEffect(() => {
    void boxkit.configGet().then(setCfg);
  }, []);

  if (!cfg) return <div className="loading">加载中…</div>;

  const save = async (patch: Partial<AppSettings>) => {
    const next = await boxkit.configSet(patch);
    setCfg(next.settings);
    if (next.hotkeyError) showToast(next.hotkeyError);
    else showToast("设置已保存");
  };

  return (
    <>
      <h2>剪贴板与本地数据</h2>
      <section className="card">
        <div className="row">
          <div>
            <div className="row-title">剪贴板历史</div>
            <div className="row-desc">默认关闭；开启后仅保存受限大小的非敏感内容和文件路径</div>
          </div>
          <Toggle
            on={cfg.clipboardHistoryEnabled}
            label="剪贴板历史"
            onChange={(value) => void save({ clipboardHistoryEnabled: value })}
          />
        </div>
        <div className="row">
          <div>
            <div className="row-title">剪贴板历史条数</div>
            <div className="row-desc">限制本机保存的历史记录数量（1 到 200）</div>
          </div>
          <NumberSetting
            value={cfg.clipboardHistoryLimit}
            min={1}
            max={200}
            label="剪贴板历史条数"
            onSave={(value) => void save({ clipboardHistoryLimit: value })}
          />
        </div>
        <div className="row">
          <div>
            <div className="row-title">清除已保存历史</div>
            <div className="row-desc">删除本机已保存的剪贴板记录，不影响系统剪贴板</div>
          </div>
          <button
            className="btn danger"
            onClick={async () => {
              await boxkit.clipboardHistory.clear();
              showToast("剪贴板历史已清除");
            }}
          >
            清除历史
          </button>
        </div>
      </section>
      <p className="hint-line">插件数据按插件名称隔离存储；卸载插件不会自动删除其本地数据。</p>
    </>
  );
}

function AppearanceView() {
  return (
    <>
      <h2>外观与窗口</h2>
      <section className="card">
        <div className="row">
          <div>
            <div className="row-title">主题</div>
            <div className="row-desc">设置窗口当前跟随操作系统外观</div>
          </div>
          <span className="status-pill">跟随系统</span>
        </div>
        <div className="row">
          <div>
            <div className="row-title">窗口</div>
            <div className="row-desc">设置窗口支持调整大小，并在下次打开时恢复最近尺寸</div>
          </div>
          <span className="status-pill ready">可调整</span>
        </div>
      </section>
    </>
  );
}

function AdvancedView({ showToast }: { showToast: (m: string) => void }) {
  const [cfg, setCfg] = useState<AppSettings | null>(null);
  useEffect(() => {
    void boxkit.configGet().then(setCfg);
  }, []);
  if (!cfg) return <div className="loading">加载中…</div>;

  const save = async (patch: Partial<AppSettings>) => {
    const next = await boxkit.configSet(patch);
    setCfg(next.settings);
    if (next.hotkeyError) showToast(next.hotkeyError);
    else showToast("设置已保存");
  };

  return (
    <>
      <h2>高级</h2>
      <section className="card">
        <div className="row">
          <div>
            <div className="row-title">更新服务器</div>
            <div className="row-desc">留空使用默认源；本地测试可填 http://127.0.0.1:8964/updates</div>
          </div>
          <FeedEdit value={cfg.updateFeed ?? ""} onSave={(value) => void save({ updateFeed: value || null })} />
        </div>
        <div className="row">
          <div>
            <div className="row-title">插件市场地址</div>
            <div className="row-desc">默认 https://niocoders.github.io/boxkit-market（GitHub Pages 静态市场）</div>
          </div>
          <FeedEdit value={cfg.marketUrl ?? ""} onSave={(value) => void save({ marketUrl: value || null })} />
        </div>
      </section>
      <p className="hint-line">修改市场地址前请确认来源可信；市场插件安装前会校验 SHA-256。</p>
    </>
  );
}

// ————— 通用 —————

function GeneralView({ showToast }: { showToast: (m: string) => void }) {
  const [cfg, setCfg] = useState<AppSettings | null>(null);

  useEffect(() => {
    void boxkit.configGet().then(setCfg);
  }, []);

  if (!cfg) return <div className="loading">加载中…</div>;

  const save = async (patch: Partial<AppSettings>) => {
    const next = await boxkit.configSet(patch);
    setCfg(next.settings);
    if (next.hotkeyError) showToast(next.hotkeyError);
    else showToast("设置已保存");
  };

  return (
    <>
      <h2>通用</h2>
      <section className="card">
        <div className="row">
          <div>
            <div className="row-title">开机自启</div>
            <div className="row-desc">登录时后台启动 BoxKit</div>
          </div>
          <Toggle
            on={cfg.autostart}
            label="开机自启"
            onChange={(v) => void save({ autostart: v })}
          />
        </div>
        <div className="row">
          <div>
            <div className="row-title">崩溃与异常上报</div>
            <div className="row-desc">帮助改进稳定性；仅在配置了上报地址且开启后发送最小化崩溃信息</div>
          </div>
          <Toggle
            on={cfg.sentryEnabled}
            label="崩溃与异常上报"
            onChange={(v) => void save({ sentryEnabled: v })}
          />
        </div>
      </section>
    </>
  );
}

function PluginHotkeyFields({
  plugin,
  cfg,
  onSave,
}: {
  plugin: PluginListItem;
  cfg: AppSettings | null;
  onSave: (key: string, value: string) => void;
}) {
  return (
    <div className="feature-hotkeys plugin-settings-hotkeys">
      {plugin.features.map((feature) => {
        const hotkeyKey = `plugin:${plugin.name}:${feature.code}`;
        const bound = cfg?.pluginHotkeys?.[hotkeyKey] ?? "";
        return (
          <div className="hk-line" key={hotkeyKey}>
            <div className="hotkey-feature">
              <span className="row-title">{feature.explain}</span>
              <span className="row-desc" title={feature.cmds.join(" / ")}>{feature.cmds.join(" / ")}</span>
            </div>
            <HotkeyRecorder
              value={bound}
              disabled={!cfg || !plugin.enabled}
              onSave={(value) => onSave(hotkeyKey, value)}
            />
            {bound && (
              <button className="btn small" disabled={!cfg} onClick={() => onSave(hotkeyKey, "")}>清除</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 快捷键录制控件：点击开始，按下组合键完成，Esc 取消 */
function HotkeyRecorder({
  value,
  onSave,
  disabled = false,
}: {
  value: string;
  onSave: (v: string) => void;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (disabled) setRecording(false);
  }, [disabled]);

  useEffect(() => {
    if (!recording) return;
    const keyToAccel = (e: KeyboardEvent): string | null => {
      const mods: string[] = [];
      if (e.ctrlKey) mods.push("Control");
      if (e.altKey) mods.push("Alt");
      if (e.shiftKey) mods.push("Shift");
      if (e.metaKey) mods.push("Super");
      let key = e.key;
      if (["Control", "Alt", "Shift", "Meta"].includes(key)) return null; // 纯修饰键等待
      if (key === " ") key = "Space";
      else if (key === "ArrowUp") key = "Up";
      else if (key === "ArrowDown") key = "Down";
      else if (key === "ArrowLeft") key = "Left";
      else if (key === "ArrowRight") key = "Right";
      else if (/^[a-z]$/i.test(key)) key = key.toUpperCase();
      else if (/^\d$/.test(key)) key = key;
      else if (!/^(F([1-9]|1[0-9]|2[0-4]))$/.test(key)) {
        // 单字符可打印键允许；其余（如 Home/End/PageUp…）按原名
        key = key.length === 1 ? key.toUpperCase() : key;
      }
      if (mods.length === 0) return null; // 必须带修饰键，避免吞掉普通输入
      return `${mods.join("+")}+${key}`;
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(false);
        return;
      }
      const acc = keyToAccel(e);
      if (acc) {
        setRecording(false);
        onSave(acc);
      }
    };
    const onBlur = () => setRecording(false);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [recording, onSave]);

  return (
    <button
      className={`btn hotkey-recorder ${recording ? "recording" : ""}`}
      disabled={disabled}
      onClick={() => setRecording(true)}
      title={recording ? "按下组合键，Esc 取消" : value}
    >
      {recording ? "请按下组合键…" : value || "点击录制"}
    </button>
  );
}

function FeedEdit({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="hotkey-edit">
      <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="默认源" spellCheck={false} />
      <button className="btn" onClick={() => onSave(draft.trim())}>
        保存
      </button>
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      className={`toggle ${on ? "on" : ""}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      onClick={() => onChange(!on)}
    >
      <span className="knob" />
    </button>
  );
}

// ————— 插件市场卡片 —————

function MarketView({
  showToast,
  onInstall,
  reloadInstalled,
  refreshKey,
}: {
  showToast: (m: string) => void;
  onInstall: (pluginId: string) => Promise<void>;
  reloadInstalled: () => void;
  refreshKey: number;
}) {
  const [keyword, setKeyword] = useState("");
  const [list, setList] = useState<MarketPlugin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [status, setStatus] = useState<"all" | "installed" | "updatable" | "available">("all");
  const [detail, setDetail] = useState<MarketPlugin | null>(null);

  const fetchList = async (kw: string) => {
    setError(null);
    try {
      const r = await boxkit.market.fetch(kw);
      if ("error" in r) {
        setError(r.error);
        setList([]);
      } else {
        setList(r);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法连接插件市场");
      setList([]);
    }
  };

  useEffect(() => {
    void fetchList("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (refreshKey > 0) void fetchList(keyword);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const visible = (list ?? []).filter((plugin) => {
    if (status === "installed") return plugin.installed;
    if (status === "updatable") return plugin.updatable;
    if (status === "available") return !plugin.installed;
    return true;
  });

  return (
    <>
      <div className="actions market-actions">
        <div className="hotkey-edit grow">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void fetchList(keyword);
            }}
            placeholder="搜索插件：剪贴板、JSON、时间戳…"
            spellCheck={false}
            aria-label="搜索插件市场"
          />
          <button className="btn primary" onClick={() => void fetchList(keyword)}>
            搜索
          </button>
        </div>
        <select
          className="filter-select"
          value={status}
          onChange={(event) => setStatus(event.target.value as typeof status)}
          aria-label="插件市场状态过滤"
        >
          <option value="all">全部状态</option>
          <option value="installed">已安装</option>
          <option value="updatable">可更新</option>
          <option value="available">未安装</option>
        </select>
      </div>

      {error && (
        <div className="warn-line" style={{ marginBottom: 8 }}>
          {error}
        </div>
      )}

      <section className="card market-grid">
        {list === null && !error && <div className="empty-inline">加载中…</div>}
        {list !== null && visible.length === 0 && !error && (
          <div className="empty-inline">没有找到匹配的插件</div>
        )}
        {visible.map((m) => (
          <div className="market-card" key={m.pluginId}>
            <button className="market-card-main" onClick={() => setDetail(m)} aria-label={`查看 ${m.displayName} 详情`}>
              <div className="market-head">
                {m.logoUrl ? (
                  <img className="p-logo" src={m.logoUrl} alt="" />
                ) : (
                  <span className="p-logo p-fallback">{m.displayName[0]}</span>
                )}
                <div className="r-main">
                  <div className="row-title">
                    {m.displayName} <span className="ver">v{m.version}</span>
                  </div>
                  <div className="row-desc">
                    {m.author ?? "未知开发者"}
                    {m.fileSize ? ` · ${m.fileSize < 1024 ? `${m.fileSize} B` : `${(m.fileSize / 1024).toFixed(1)} KB`}` : ""}
                  </div>
                </div>
              </div>
              <div className="market-desc">{m.description ?? "无描述"}</div>
            </button>
            <div className="market-foot">
              {m.updatable ? (
                <span className="src up">可更新（本地 v{m.localVersion}）</span>
              ) : m.installed ? (
                <span className="src">已安装</span>
              ) : (
                <span />
              )}
              <div className="p-actions">
                <button className="btn small" onClick={() => setDetail(m)}>
                  详情
                </button>
                <button
                  className={`btn small ${m.updatable ? "primary" : ""}`}
                  disabled={installing === m.pluginId}
                  onClick={async () => {
                    setInstalling(m.pluginId);
                    try {
                      await onInstall(m.pluginId);
                    } finally {
                      setInstalling(null);
                    }
                  }}
                >
                  {installing === m.pluginId ? "处理中…" : m.updatable ? "更新" : m.installed ? "重装" : "安装"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </section>
      {detail && <MarketDetail plugin={detail} onClose={() => setDetail(null)} onInstall={onInstall} installing={installing === detail.pluginId} />}
    </>
  );
}

function MarketDetail({
  plugin,
  onClose,
  onInstall,
  installing,
}: {
  plugin: MarketPlugin;
  onClose: () => void;
  onInstall: (pluginId: string) => Promise<void>;
  installing: boolean;
}) {
  return (
    <div className="modal-mask" role="presentation" onClick={onClose}>
      <div className="modal detail-modal" role="dialog" aria-modal="true" aria-labelledby="market-detail-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-heading">
          <h3 id="market-detail-title">{plugin.displayName}</h3>
          <button className="icon-button" onClick={onClose} aria-label="关闭详情" title="关闭详情">×</button>
        </div>
        <div className="modal-plugin">
          {plugin.logoUrl ? <img className="p-logo" src={plugin.logoUrl} alt="" /> : <span className="p-logo p-fallback">{plugin.displayName[0]}</span>}
          <div>
            <div className="row-title">v{plugin.version}</div>
            <div className="row-desc">{plugin.description ?? "无描述"}</div>
          </div>
        </div>
        <dl className="metadata-list">
          <div><dt>作者</dt><dd>{plugin.author ?? "未提供"}</dd></div>
          <div><dt>维护者</dt><dd>{plugin.maintainer ?? "未提供"}</dd></div>
          <div><dt>许可证</dt><dd>{plugin.license ?? "未提供"}</dd></div>
          <div><dt>来源</dt><dd>{plugin.sourceUrl ? <a href={plugin.sourceUrl} target="_blank" rel="noreferrer">{plugin.sourceUrl}</a> : "未提供"}</dd></div>
          <div><dt>包大小</dt><dd>{plugin.fileSize ? `${(plugin.fileSize / 1024).toFixed(1)} KB` : "未提供"}</dd></div>
          <div><dt>SHA-256</dt><dd className="hash-value">{plugin.sha256}</dd></div>
        </dl>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>关闭</button>
          <button className="btn primary" disabled={installing} onClick={() => void onInstall(plugin.pluginId)}>
            {installing ? "处理中…" : plugin.updatable ? "更新" : plugin.installed ? "重装" : "安装"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ————— 插件 —————

function PluginsView({
  showToast,
  view,
  onViewChange,
  initialPreview,
  onInitialPreviewConsumed,
  onMarketRefresh,
  marketRefreshKey,
  targetPluginId,
  onTargetPluginConsumed,
}: {
  showToast: (m: string) => void;
  view: "installed" | "market";
  onViewChange: (v: "installed" | "market") => void;
  initialPreview: { preview: InstallPreview; conflict: string } | null;
  onInitialPreviewConsumed: () => void;
  onMarketRefresh: () => void;
  marketRefreshKey: number;
  targetPluginId: string | null;
  onTargetPluginConsumed: () => void;
}) {
  const [items, setItems] = useState<PluginListItem[] | null>(null);
  const [pending, setPending] = useState<{ preview: InstallPreview; conflict: string } | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [cfg, setCfg] = useState<AppSettings | null>(null);
  const cfgRef = useRef<AppSettings | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [pluginFilter, setPluginFilter] = useState("");
  const [pluginStatus, setPluginStatus] = useState<"all" | "enabled" | "disabled" | "dev">("all");
  const [pluginDetail, setPluginDetail] = useState<PluginListItem | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<PluginListItem | null>(null);

  const reload = async (): Promise<PluginListItem[]> => {
    const next = await boxkit.plugins.list();
    setItems(next);
    setPluginDetail((current) => current ? next.find((plugin) => plugin.name === current.name) ?? null : null);
    return next;
  };

  useEffect(() => {
    void reload();
    void boxkit.configGet().then((next) => {
      cfgRef.current = next;
      setCfg(next);
    });
  }, []);

  useEffect(() => {
    cfgRef.current = cfg;
  }, [cfg]);

  useEffect(() => {
    if (!targetPluginId || items === null) return;
    const target = items.find((plugin) => plugin.name === targetPluginId);
    if (target) setPluginDetail(target);
    else showToast("插件不存在或已被移除");
    onTargetPluginConsumed();
  }, [items, onTargetPluginConsumed, showToast, targetPluginId]);

  const enqueueSave = (operation: () => Promise<void>): Promise<void> => {
    const queued = saveQueueRef.current.then(operation, operation);
    saveQueueRef.current = queued.catch(() => undefined);
    return queued;
  };

  /** 提交插件 feature 快捷键整表；value 为空表示清除。 */
  const savePluginHotkey = (key: string, value: string): Promise<void> =>
    enqueueSave(async () => {
      const current = cfgRef.current;
      if (!current) return;
      const nextMap = { ...(current.pluginHotkeys ?? {}) };
      if (value) nextMap[key] = value;
      else delete nextMap[key];
      const next = await boxkit.configSet({ pluginHotkeys: nextMap });
      cfgRef.current = next.settings;
      setCfg(next.settings);
      if (next.hotkeyError) showToast(next.hotkeyError);
      else showToast("快捷键已保存");
    });

  useEffect(() => {
    if (initialPreview) {
      setPending(initialPreview);
      onInitialPreviewConsumed();
    }
  }, [initialPreview, onInitialPreviewConsumed]);

  useEffect(() => {
    if (!pending) return;
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void cancelPending();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pending]);

  const cancelPending = async () => {
    const current = pending;
    setPending(null);
    setInstallError(null);
    if (current) await boxkit.plugins.installCancel(current.preview.stagingId);
  };

  if (items === null) return <div className="loading">加载中…</div>;

  const normalizedFilter = pluginFilter.trim().toLowerCase();
  const visibleItems = items.filter((plugin) => {
    const matchesText = !normalizedFilter || [plugin.displayName, plugin.name, plugin.description ?? "", plugin.path]
      .join(" ")
      .toLowerCase()
      .includes(normalizedFilter);
    const matchesStatus =
      pluginStatus === "all" ||
      (pluginStatus === "enabled" && plugin.enabled) ||
      (pluginStatus === "disabled" && !plugin.enabled) ||
      (pluginStatus === "dev" && plugin.source === "dev");
    return matchesText && matchesStatus;
  });

  const uninstall = async (plugin: PluginListItem) => {
    setUninstallTarget(null);
    setPluginDetail(null);
    const r = await boxkit.plugins.uninstall(plugin.name);
    if (!r.ok && r.error) showToast(r.error);
    await reload();
  };
  const setPluginEnabled = (plugin: PluginListItem, enabled: boolean): void => {
    if (enabled) boxkit.plugins.enable(plugin.name);
    else boxkit.plugins.disable(plugin.name);
    setItems((current) => current?.map((item) => item.name === plugin.name ? { ...item, enabled } : item) ?? null);
    setPluginDetail((current) => current?.name === plugin.name ? { ...current, enabled } : current);
    setTimeout(() => void reload(), 150);
  };
  const removeDevPlugin = (plugin: PluginListItem): void => {
    setPluginDetail(null);
    boxkit.plugins.removeDevPath(plugin.path);
    setTimeout(() => void reload(), 150);
  };
  const installFromMarket = async (pluginId: string) => {
    const r = await boxkit.market.install(pluginId);
    if (!r) return;
    if ("error" in r) {
      showToast(r.error);
      return;
    }
    setPending({ preview: r.preview, conflict: r.conflict ?? "" });
  };

  return (
    <>
      <h2>插件</h2>
      <div className="segment">
        <button className={`seg ${view === "installed" ? "on" : ""}`} onClick={() => onViewChange("installed")}>
          已安装 ({items.length})
        </button>
        <button className={`seg ${view === "market" ? "on" : ""}`} onClick={() => onViewChange("market")}>
          插件市场
        </button>
      </div>

      {view === "installed" ? (
        <>
          <div className="actions plugin-actions">
            <button
              className="btn primary"
              onClick={async () => {
                const r = await boxkit.plugins.installPreview();
                if (r) setPending(r);
              }}
            >
              安装插件包 (.bkx / .upx / .zip)
            </button>
            <button
              className="btn"
              onClick={async () => {
                const r = await boxkit.plugins.addDevPath();
                if (!r.ok && r.error) showToast(r.error);
                else reload();
              }}
            >
              添加开发目录
            </button>
            <div className="plugin-filters">
              <input
                value={pluginFilter}
                onChange={(event) => setPluginFilter(event.target.value)}
                placeholder="搜索已安装插件"
                aria-label="搜索已安装插件"
                spellCheck={false}
              />
              <select
                className="filter-select"
                value={pluginStatus}
                onChange={(event) => setPluginStatus(event.target.value as typeof pluginStatus)}
                aria-label="已安装插件状态过滤"
              >
                <option value="all">全部状态</option>
                <option value="enabled">已启用</option>
                <option value="disabled">已停用</option>
                <option value="dev">开发插件</option>
              </select>
            </div>
          </div>

          <section className="card">
            {items.length === 0 && <div className="empty-inline">尚未安装任何插件，去插件市场逛逛 →</div>}
            {items.length > 0 && visibleItems.length === 0 && <div className="empty-inline">没有匹配的已安装插件</div>}
            {visibleItems.map((p) => (
              <div className="row plugin-row" key={p.name + p.path}>
                {p.logo ? (
                  <img className="p-logo" src={p.logo} alt="" />
                ) : (
                  <span className="p-logo p-fallback">{p.displayName[0]}</span>
                )}
                <div className="r-main">
                  <div className="row-title plugin-title" onClick={() => setPluginDetail(p)}>
                    {p.displayName} <span className="ver">v{p.version}</span>
                    <span className={`src ${p.source}`}>{p.source === "dev" ? "开发" : "已安装"}</span>
                    {!p.enabled && <span className="src off">已停用</span>}
                  </div>
                  <div className="row-desc">
                    {p.description ?? "无描述"} · 关键字：{p.features.flatMap((f) => f.cmds).join(" / ")}
                  </div>
                  {p.permissions.length > 0 && (
                    <div className="row-desc perms">权限：{p.permissions.join("、")}</div>
                  )}
                </div>
                <div className="p-actions">
                  <button className="btn small" onClick={() => setPluginDetail(p)}>设置</button>
                  <Toggle
                    on={p.enabled}
                    label={`${p.displayName} 开关`}
                    onChange={(v) => setPluginEnabled(p, v)}
                  />
                  {p.source === "dev" ? (
                    <button className="btn small danger" onClick={() => removeDevPlugin(p)}>
                      移除
                    </button>
                  ) : (
                    <button
                      className="btn small danger"
                      onClick={() => setUninstallTarget(p)}
                    >
                      卸载
                    </button>
                  )}
                </div>
              </div>
            ))}
          </section>
        </>
      ) : (
        <MarketView
          showToast={showToast}
          onInstall={installFromMarket}
          reloadInstalled={reload}
          refreshKey={marketRefreshKey}
        />
      )}

      {pending && (
        <div className="modal-mask" role="presentation" onClick={() => void cancelPending()}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="install-dialog-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="install-dialog-title">安装插件</h3>
            <div className="modal-plugin">
              {pending.preview.logo ? (
                <img src={pending.preview.logo} className="p-logo" alt="" />
              ) : (
                <span className="p-logo p-fallback">{pending.preview.displayName[0]}</span>
              )}
              <div>
                <div className="row-title">
                  {pending.preview.displayName} v{pending.preview.version}
                </div>
                <div className="row-desc">{pending.preview.description ?? "无描述"}</div>
              </div>
            </div>
            {pending.conflict === "upgrade" && (
              <p className="warn-line">检测到已安装旧版本，将执行升级覆盖。</p>
            )}
            {pending.conflict === "same-version" && (
              <p className="warn-line">已安装相同版本，将继续覆盖安装。</p>
            )}
            <div className="perm-box">
              <div className="perm-title">该插件申请以下权限：</div>
              {pending.preview.permissions.length === 0 ? (
                <div className="perm-item">无特殊权限</div>
              ) : (
                pending.preview.permissions.map((perm) => (
                  <div className="perm-item" key={perm}>
                    • {perm}
                  </div>
                ))
              )}
            </div>
            <div className="modal-actions">
              {installError && <div className="warn-line" role="alert">{installError}</div>}
              <button className="btn" onClick={() => void cancelPending()}>
                取消
              </button>
              <button
                ref={confirmRef}
                className="btn primary"
                onClick={async () => {
                  const current = pending;
                  if (!current) return;
                  setInstallError(null);
                  try {
                    const r = await boxkit.plugins.installConfirm(current.preview.stagingId);
                    setPending(null);
                    showToast(r.ok ? `已安装 ${r.name}` : r.error ?? "安装失败");
                    reload();
                    onMarketRefresh();
                  } catch (error) {
                    setInstallError(error instanceof Error ? error.message : "安装失败");
                  }
                }}
              >
                信任并安装
              </button>
            </div>
          </div>
        </div>
      )}
      {uninstallTarget && (
        <div className="modal-mask" role="presentation" onClick={() => setUninstallTarget(null)}>
          <div className="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="uninstall-dialog-title" onClick={(event) => event.stopPropagation()}>
            <h3 id="uninstall-dialog-title">确认卸载插件</h3>
            <p className="row-desc uninstall-copy">
              确定要卸载“{uninstallTarget.displayName}”吗？插件文件、快捷键和本地数据都将从本机移除。
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setUninstallTarget(null)}>取消</button>
              <button className="btn danger" onClick={() => void uninstall(uninstallTarget)}>确认卸载</button>
            </div>
          </div>
        </div>
      )}
      {pluginDetail && (
        <div className="modal-mask" role="presentation" onClick={() => setPluginDetail(null)}>
          <div className="modal detail-modal plugin-settings-modal" role="dialog" aria-modal="true" aria-labelledby="installed-detail-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <h3 id="installed-detail-title">插件设置</h3>
              <button className="icon-button" onClick={() => setPluginDetail(null)} aria-label="关闭插件设置" title="关闭插件设置">×</button>
            </div>
            <div className="modal-plugin plugin-settings-identity">
              {pluginDetail.logo ? <img className="p-logo" src={pluginDetail.logo} alt="" /> : <span className="p-logo p-fallback">{pluginDetail.displayName[0]}</span>}
              <div>
                <div className="row-title">{pluginDetail.displayName} <span className="ver">v{pluginDetail.version}</span></div>
                <div className="row-desc">{pluginDetail.description ?? "无描述"}</div>
              </div>
            </div>
            <section className="plugin-settings-section">
              <div className="plugin-setting-row">
                <div>
                  <div className="row-title">启用插件</div>
                  <div className="row-desc">停用后不会出现在搜索结果中，功能快捷键也暂停使用</div>
                </div>
                <Toggle
                  on={pluginDetail.enabled}
                  label={`${pluginDetail.displayName} 开关`}
                  onChange={(enabled) => setPluginEnabled(pluginDetail, enabled)}
                />
              </div>
            </section>
            <section className="plugin-settings-section">
              <div className="plugin-settings-section-heading">
                <div>
                  <div className="row-title">功能快捷键</div>
                  <div className="row-desc">为每个插件功能设置独立的全局快捷键</div>
                </div>
                <span className="status-pill">{pluginDetail.features.length} 个功能</span>
              </div>
              <PluginHotkeyFields
                plugin={pluginDetail}
                cfg={cfg}
                onSave={(key, value) => {
                  void savePluginHotkey(key, value).catch((error) =>
                    showToast(error instanceof Error ? error.message : "保存失败"),
                  );
                }}
              />
            </section>
            <details className="plugin-metadata">
              <summary>插件信息与权限</summary>
              <dl className="metadata-list">
                <div><dt>来源</dt><dd>{pluginDetail.source === "dev" ? "开发目录" : "本机安装"}</dd></div>
                <div><dt>路径</dt><dd className="path-value">{pluginDetail.path}</dd></div>
                <div><dt>权限</dt><dd>{pluginDetail.permissions.length ? pluginDetail.permissions.join("、") : "无特殊权限"}</dd></div>
                <div><dt>关键字</dt><dd>{pluginDetail.features.flatMap((feature) => feature.cmds).join("、")}</dd></div>
              </dl>
            </details>
            <div className="modal-actions plugin-settings-actions">
              {pluginDetail.source === "dev" ? (
                <button className="btn danger" onClick={() => removeDevPlugin(pluginDetail)}>移除开发目录</button>
              ) : (
                <button className="btn danger" onClick={() => setUninstallTarget(pluginDetail)}>卸载插件</button>
              )}
              <span className="modal-action-spacer" />
              <button className="btn" onClick={() => setPluginDetail(null)}>完成</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ————— 关于 —————

interface AppInfo {
  version: string;
  electron: string;
  node: string;
  platform: string;
  osRelease: string;
}

function AboutView() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [upd, setUpd] = useState<UpdateState | null>(null);

  useEffect(() => {
    void boxkit.appInfo().then(setInfo);
    void boxkit.updaterState().then(setUpd);
    return boxkit.onUpdateEvent(setUpd);
  }, []);

  return (
    <>
      <h2>关于</h2>
      <section className="card">
        <div className="about-brand">
          <span className="brand-mark big">B</span>
          <div>
            <div className="row-title">BoxKit {info?.version ?? ""}</div>
            <div className="row-desc">跨平台效率启动器与插件平台</div>
          </div>
        </div>
        <div className="row">
          <div className="row-desc mono">
            Electron {info?.electron} · Node {info?.node} · {info?.platform}
          </div>
        </div>
        <div className="row">
          <div>
            <div className="row-title">软件更新</div>
            <div className="row-desc">
              {upd?.status === "downloading" && `下载中 ${upd.progress ?? 0}%`}
              {upd?.status === "available" && `发现新版本 ${upd.info?.version}`}
              {upd?.status === "downloaded" && `新版本已就绪，重启后生效`}
              {upd?.status === "error" && `更新失败：${upd.error}`}
              {(upd?.status === "idle" || upd?.status === "not-available" || !upd?.status) &&
                "已是最新版本"}
            </div>
          </div>
          <div className="p-actions">
            {upd?.status === "downloaded" ? (
              <button className="btn primary" onClick={() => boxkit.installUpdate()}>
                重启并更新
              </button>
            ) : (
              <button className="btn" onClick={() => void boxkit.checkUpdate()}>
                检查更新
              </button>
            )}
          </div>
        </div>
      </section>
      <p className="hint-line">
        BoxKit 保留所有权利 · 基于开源组件构建（Electron / React，MIT License），清单见 README
      </p>
    </>
  );
}
