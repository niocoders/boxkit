import { useEffect, useState } from "react";
import type {
  AppSettings,
  InstallPreview,
  LicenseState,
  PluginListItem,
  UpdateState,
} from "@boxkit/shared";
import { boxkit } from "./bridge.js";

type Tab = "general" | "plugins" | "license" | "about";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "general", label: "通用", icon: "⚙️" },
  { id: "plugins", label: "插件", icon: "🧩" },
  { id: "license", label: "授权", icon: "🔑" },
  { id: "about", label: "关于", icon: "ℹ️" },
];

const LICENSE_TEXT: Record<string, string> = {
  trial: "试用中",
  "trial-expired": "试用期已结束",
  licensed: "已授权",
  "license-expired": "授权已过期",
};

export function App() {
  const [tab, setTab] = useState<Tab>("general");
  const [toast, setToast] = useState<string | null>(null);

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
        {tab === "plugins" && <PluginsView showToast={showToast} />}
        {tab === "license" && <LicenseView showToast={showToast} />}
        {tab === "about" && <AboutView />}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

// ————— 通用 —————

function GeneralView({ showToast }: { showToast: (m: string) => void }) {
  const [cfg, setCfg] = useState<AppSettings | null>(null);
  const [hotkeyDraft, setHotkeyDraft] = useState("");

  useEffect(() => {
    void boxkit.configGet().then((c) => {
      setCfg(c);
      setHotkeyDraft(c.hotkey);
    });
  }, []);

  if (!cfg) return <div className="loading">加载中…</div>;

  const save = async (patch: Partial<AppSettings>) => {
    const next = await boxkit.configSet(patch);
    setCfg(next);
    showToast("设置已保存");
  };

  return (
    <>
      <h2>通用</h2>
      <section className="card">
        <div className="row">
          <div>
            <div className="row-title">全局快捷键</div>
            <div className="row-desc">唤起 / 隐藏搜索面板</div>
          </div>
          <div className="hotkey-edit">
            <input
              value={hotkeyDraft}
              onChange={(e) => setHotkeyDraft(e.target.value)}
              placeholder="Option+Space"
              spellCheck={false}
            />
            <button
              className="btn"
              onClick={() => {
                if (hotkeyDraft.trim() && hotkeyDraft !== cfg.hotkey) {
                  void save({ hotkey: hotkeyDraft.trim() });
                }
              }}
            >
              保存
            </button>
          </div>
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
      </section>
    </>
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

// ————— 插件 —————

function PluginsView({ showToast }: { showToast: (m: string) => void }) {
  const [items, setItems] = useState<PluginListItem[] | null>(null);
  const [pending, setPending] = useState<{ preview: InstallPreview; conflict: string } | null>(null);

  const reload = () => void boxkit.plugins.list().then(setItems);

  useEffect(() => {
    reload();
  }, []);

  if (items === null) return <div className="loading">加载中…</div>;

  return (
    <>
      <h2>插件</h2>
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
        {items.length === 0 && <div className="empty-inline">尚未安装任何插件</div>}
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

// ————— 授权 —————

function LicenseView({ showToast }: { showToast: (m: string) => void }) {
  const [state, setState] = useState<LicenseState | null>(null);
  const [key, setKey] = useState("");

  const reload = () => void boxkit.licenseState().then(setState);
  useEffect(() => {
    reload();
  }, []);

  if (!state) return <div className="loading">加载中…</div>;

  const badge = LICENSE_TEXT[state.mode] ?? state.mode;
  return (
    <>
      <h2>授权</h2>
      <section className="card">
        <div className="row">
          <div>
            <div className="row-title">
              当前状态：<span className={`license ${state.mode}`}>{badge}</span>
            </div>
            <div className="row-desc">
              {state.mode === "licensed" &&
                `${state.plan ?? ""} · ${state.email ?? ""}${
                  state.expiresAt ? ` · 有效期至 ${new Date(state.expiresAt).toLocaleDateString()}` : " · 永久"
                }`}
              {(state.mode === "trial" || state.mode === "trial-expired") &&
                `试用期自 ${state.trialStartedAt ? new Date(state.trialStartedAt).toLocaleDateString() : "-"} 起`}
            </div>
          </div>
          {state.daysLeft !== null && (
            <div className="days">{state.mode === "licensed" ? `剩 ${state.daysLeft} 天` : `试用剩 ${state.daysLeft} 天`}</div>
          )}
        </div>
        {state.mode !== "licensed" && (
          <div className="activate">
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="粘贴授权码 BK1.…"
              spellCheck={false}
            />
            <button
              className="btn primary"
              onClick={async () => {
                if (!key.trim()) return;
                const r = await boxkit.activate(key.trim());
                if (r.ok) {
                  showToast("激活成功");
                  setKey("");
                } else {
                  showToast(r.error ?? "激活失败");
                }
                reload();
              }}
            >
              激活
            </button>
          </div>
        )}
        {state.mode === "licensed" && (
          <div className="row">
            <div className="row-desc">如需转移到其他设备，请先在此取消授权。</div>
            <button
              className="btn small danger"
              onClick={async () => {
                await boxkit.deactivate();
                showToast("已取消授权");
                reload();
              }}
            >
              取消授权
            </button>
          </div>
        )}
      </section>
      <p className="hint-line">
        授权码由 BoxKit 官方签发（Ed25519 离线签名验证）。测试授权可用
        <code> pnpm license issue --plan pro --email you@example.com --days 365 </code>
        生成。
      </p>
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
