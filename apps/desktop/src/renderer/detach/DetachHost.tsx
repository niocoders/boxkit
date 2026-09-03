import { useEffect, useState } from "react";
import type { DetachHostState } from "@boxkit/shared";
import "./style.css";

declare global {
  interface Window {
    detachHost: {
      getState(): Promise<DetachHostState | null>;
      onState(cb: (state: DetachHostState) => void): () => void;
      input(value: string): void;
      reattach(): Promise<{ ok: boolean }>;
      close(): Promise<{ ok: boolean }>;
      toggleAlwaysOnTop(): Promise<DetachHostState | null>;
      setZoom(value: number): Promise<DetachHostState | null>;
      openPluginSettings(pluginId: string): void;
    };
  }
}

export function DetachHost() {
  const [state, setState] = useState<DetachHostState | null>(null);
  const [input, setInput] = useState("");

  useEffect(() => {
    let active = true;
    void window.detachHost.getState().then((value) => {
      if (active) {
        setState(value);
        setInput(value?.subinput?.value ?? "");
      }
    });
    const off = window.detachHost.onState((value) => {
      setState(value);
      setInput(value.subinput?.value ?? "");
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void window.detachHost.reattach();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      active = false;
      off();
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!state) return <main className="detach-shell"><div className="detach-loading">正在加载插件…</div></main>;
  return (
    <main className="detach-shell">
      <header className="detach-toolbar">
        <strong className="detach-title" title={state.displayName}>{state.displayName}</strong>
        {state.subinput && (
          <input
            className="detach-input"
            value={input}
            placeholder={state.subinput.placeholder}
            onChange={(event) => {
              setInput(event.target.value);
              window.detachHost.input(event.target.value);
            }}
          />
        )}
        <div className="detach-actions">
          <button type="button" className="detach-icon-button" aria-label="插件设置" title="插件设置" onClick={() => window.detachHost.openPluginSettings(state.pluginName)}>⚙</button>
          <button type="button" aria-label="切换置顶" title="切换置顶" onClick={() => void window.detachHost.toggleAlwaysOnTop()}>
            {state.alwaysOnTop ? "取消置顶" : "置顶"}
          </button>
          <button type="button" aria-label="缩小" title="缩小" onClick={() => void window.detachHost.setZoom(state.zoomFactor - 0.1)}>−</button>
          <span className="detach-zoom">{Math.round(state.zoomFactor * 100)}%</span>
          <button type="button" aria-label="放大" title="放大" onClick={() => void window.detachHost.setZoom(state.zoomFactor + 0.1)}>+</button>
          <button type="button" aria-label="归还主面板" title="归还主面板 (Ctrl/Cmd+Esc)" onClick={() => void window.detachHost.reattach()}>归还</button>
          <button type="button" aria-label="关闭插件窗口" title="关闭插件窗口" onClick={() => void window.detachHost.close()}>关闭</button>
        </div>
      </header>
      <section className="detach-content" aria-label="插件内容" />
    </main>
  );
}
