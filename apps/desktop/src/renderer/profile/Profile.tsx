import { useEffect, useState } from "react";


interface ProfileData {
  version: string;
  firstLaunchAt: number;
  topApps: { name: string; path: string; icon?: string; count: number }[];
}

declare global {
  interface Window {
    boxkit: {
      openLogs(): void;
      profileApi: {
        data(): Promise<ProfileData>;
        openApp(path: string): Promise<{ ok: boolean; error?: string }>;
        openSettings(): Promise<void>;
        quit(): Promise<void>;
      };
    };
  }
}

export function Profile() {
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.boxkit.profileApi
      .data()
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "加载失败"));
  }, []);

  const days = data ? Math.max(1, Math.ceil((Date.now() - data.firstLaunchAt) / 86400000)) : 0;

  return (
    <div style={{ padding: 20, fontFamily: "inherit", color: "#333", backgroundColor: "#f5f7fb", minHeight: "100vh" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <span style={{
          width: 44, height: 44, borderRadius: 12,
          background: "linear-gradient(135deg, #4f6bff, #23c4ff)",
          color: "#fff", fontWeight: 700, fontSize: 20,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>B</span>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>BoxKit 个人中心</div>
          <div style={{ fontSize: 12, color: "#999" }}>
            v{data?.version ?? "…"} · 已陪伴 {days} 天
          </div>
        </div>
      </div>

      {error && <div style={{ color: "#c0392b", marginBottom: 12 }}>{error}</div>}

      <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>常用应用</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 18 }}>
        {(data?.topApps ?? []).map((app) => (
          <button
            key={app.path}
            title={app.path}
            onClick={() => void window.boxkit.profileApi.openApp(app.path)}
            style={{
              border: "1px solid #e5e8ef", borderRadius: 10, padding: "10px 4px",
              background: "#fff", cursor: "pointer", textAlign: "center",
            }}
          >
            {app.icon ? (
              <img src={app.icon} alt="" style={{ width: 32, height: 32, borderRadius: 8 }} />
            ) : (
              <div style={{ width: 32, height: 32, borderRadius: 8, margin: "0 auto", background: "#eef2ff", lineHeight: "32px", fontWeight: 700, color: "#4f6bff" }}>
                {(app.name[0] ?? "?").toUpperCase()}
              </div>
            )}
            <div style={{ fontSize: 11, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {app.name}
            </div>
          </button>
        ))}
        {(data?.topApps ?? []).length === 0 && !error && (
          <div style={{ gridColumn: "span 4", color: "#999", fontSize: 12 }}>还没有使用记录</div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button className="btn" onClick={() => void window.boxkit.profileApi.openSettings()}>打开设置</button>
        <button className="btn" onClick={() => window.boxkit.openLogs()}>打开日志目录</button>
        <button className="btn danger" onClick={() => void window.boxkit.profileApi.quit()}>退出 BoxKit</button>
      </div>
    </div>
  );
}
