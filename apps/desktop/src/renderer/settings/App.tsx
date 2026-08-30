import { useEffect, useState } from "react";
import type {
  AppSettings,
  InstallPreview,
  MarketPlugin,
  PluginListItem,
  UpdateState,
} from "@boxkit/shared";
import { boxkit } from "./bridge.js";

type Tab = "general" | "plugins" | "about";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "general", label: "通用", icon: "⚙️" },
  { id: "plugins", label: "插件", icon: "🧩" },
  { id: "about", label: "关于", icon: "ℹ️" },
];

export function App() {
  const [tab, setTab] = useState<Tab>("general");
  const [pluginView, setPluginView] = useState<"installed" | "market">("installed");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    return boxkit.onSettingsShowTab((p) => {
      if (p.tab === "plugins") {
        setTab("plugins");
        if (p.view === "market") setPluginView("market");
      } else if (p.tab === "general" || p.tab === "about") {
        setTab(p.tab);
      }
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
        {tab === "general" && <GeneralView showToast={showToast} />}
        {tab === "plugins" && (
          <PluginsView showToast={showToast} view={pluginView} onViewChange={setPluginView} />
        )}
        {tab === "about" && <AboutView />}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
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
            <div className="row-title">全局主快捷键</div>
            <div className="row-desc">唤起 / 隐藏搜索面板；点击右侧按钮后按下组合键录制</div>
          </div>
          <HotkeyRecorder
            value={cfg.hotkey}
            onSave={(v) => {
              if (v && v !== cfg.hotkey) void save({ hotkey: v });
            }}
          />
        </div>
        <div className="row">
          <div>
            <div className="row-title">开机自启</div>
            <div className="row-desc">登录时后台启动 BoxKit</div>
          </div>
          <Toggle
            on={cfg.autostart}
            onChange={(v) => void save({ autostart: v })}
          />
        </div>
        <div className="row">
          <div>
            <div className="row-title">崩溃与异常上报</div>
            <div className="row-desc">帮助改进稳定性；始终仅在本地保留日志</div>
          </div>
          <Toggle
            on={cfg.sentryEnabled}
            onChange={(v) => void save({ sentryEnabled: v })}
          />
        </div>
        <div className="row">
          <div>
            <div className="row-title">更新服务器</div>
            <div className="row-desc">留空使用默认源；本地测试可填 http://127.0.0.1:8964/updates</div>
          </div>
          <FeedEdit value={cfg.updateFeed ?? ""} onSave={(v) => void save({ updateFeed: v || null })} />
        </div>
        <div className="row">
          <div>
            <div className="row-title">插件市场地址</div>
            <div className="row-desc">默认 http://127.0.0.1:8080（server/ 目录的本地市场服务）</div>
          </div>
          <FeedEdit value={cfg.marketUrl ?? ""} onSave={(v) => void save({ marketUrl: v || null })} />
        </div>
      </section>
    </>
  );
}

/** uTools 式快捷键录制控件：点击开始，按下组合键完成，Esc 取消 */
function HotkeyRecorder({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [recording, setRecording] = useState(false);

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

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)}>
      <span className="knob" />
    </button>
  );
}

// ————— 插件市场（uTools 风格卡片） —————

function MarketView({
  showToast,
  onInstall,
}: {
  showToast: (m: string) => void;
  onInstall: (pluginId: string) => Promise<void>;
  reloadInstalled: () => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [list, setList] = useState<MarketPlugin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);

  const fetchList = async (kw: string) => {
    setError(null);
    const r = await boxkit.market.fetch(kw);
    if ("error" in r) {
      setError(r.error);
      setList([]);
    } else {
      setList(r);
    }
  };

  useEffect(() => {
    void fetchList("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="actions">
        <div className="hotkey-edit grow">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void fetchList(keyword);
            }}
            placeholder="搜索插件：剪贴板、JSON、时间戳…"
            spellCheck={false}
          />
          <button className="btn primary" onClick={() => void fetchList(keyword)}>
            搜索
          </button>
        </div>
      </div>

      {error && (
        <div className="warn-line" style={{ marginBottom: 8 }}>
          {error}
        </div>
      )}

      <section className="card market-grid">
        {list === null && !error && <div className="empty-inline">加载中…</div>}
        {list !== null && list.length === 0 && !error && (
          <div className="empty-inline">没有找到匹配的插件</div>
        )}
        {(list ?? []).map((m) => (
          <div className="market-card" key={m.pluginId}>
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
                  {m.author ?? "未知开发者"} · {(m.downloads ?? 0).toLocaleString()} 次安装
                </div>
              </div>
            </div>
            <div className="market-desc">{m.description ?? "无描述"}</div>
            <div className="market-foot">
              {m.updatable ? (
                <span className="src up">可更新（本地 v{m.localVersion}）</span>
              ) : m.installed ? (
                <span className="src">已安装</span>
              ) : (
                <span />
              )}
              <button
                className={`btn small ${m.updatable ? "primary" : ""}`}
                disabled={installing === m.pluginId}
                onClick={async () => {
                  setInstalling(m.pluginId);
                  await onInstall(m.pluginId);
                  setInstalling(null);
                }}
              >
                {installing === m.pluginId ? "处理中…" : m.updatable ? "更新" : m.installed ? "重装" : "安装"}
              </button>
            </div>
          </div>
        ))}
      </section>
    </>
  );
}

// ————— 插件 —————

function PluginsView({
  showToast,
  view,
  onViewChange,
}: {
  showToast: (m: string) => void;
  view: "installed" | "market";
  onViewChange: (v: "installed" | "market") => void;
}) {
  const [items, setItems] = useState<PluginListItem[] | null>(null);
  const [pending, setPending] = useState<{ preview: InstallPreview; conflict: string } | null>(null);

  const reload = () => void boxkit.plugins.list().then(setItems);

  useEffect(() => {
    reload();
  }, []);

  if (items === null) return <div className="loading">加载中…</div>;

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
          <div className="actions">
            <button
              className="btn primary"
              onClick={async () => {
                const r = await boxkit.plugins.installPreview();
                if (r) setPending(r);
              }}
            >
              安装插件包 (.bkx)
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
          </div>

          <section className="card">
            {items.length === 0 && <div className="empty-inline">尚未安装任何插件，去插件市场逛逛 →</div>}
            {items.map((p) => (
              <div className="row plugin-row" key={p.name + p.path}>
                {p.logo ? (
                  <img className="p-logo" src={p.logo} alt="" />
                ) : (
                  <span className="p-logo p-fallback">{p.displayName[0]}</span>
                )}
                <div className="r-main">
                  <div className="row-title">
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
                  <Toggle
                    on={p.enabled}
                    onChange={(v) => {
                      if (v) boxkit.plugins.enable(p.name);
                      else boxkit.plugins.disable(p.name);
                      setTimeout(reload, 150);
                    }}
                  />
                  {p.source === "dev" ? (
                    <button className="btn small danger" onClick={() => {
                      boxkit.plugins.removeDevPath(p.path);
                      setTimeout(reload, 150);
                    }}>
                      移除
                    </button>
                  ) : (
                    <button
                      className="btn small danger"
                      onClick={async () => {
                        const r = await boxkit.plugins.uninstall(p.name);
                        if (!r.ok && r.error) showToast(r.error);
                        reload();
                      }}
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
        <MarketView showToast={showToast} onInstall={installFromMarket} reloadInstalled={reload} />
      )}

      {pending && (
        <div className="modal-mask" onClick={() => setPending(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>安装插件</h3>
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
              <button className="btn" onClick={() => setPending(null)}>
                取消
              </button>
              <button
                className="btn primary"
                onClick={async () => {
                  const r = await boxkit.plugins.installConfirm(pending.preview.stagingId);
                  setPending(null);
                  showToast(r.ok ? `已安装 ${r.name}` : r.error ?? "安装失败");
                  reload();
                }}
              >
                信任并安装
              </button>
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
