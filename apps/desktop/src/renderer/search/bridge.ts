import type { PluginModeState, SearchResult } from "@boxkit/shared";

export interface BoxkitBridge {
  query(text: string): Promise<SearchResult[]>;
  execute(result: SearchResult): Promise<{ ok: boolean; message?: string }>;
  hide(): void;
  openSettings(): void;
  sendInput(text: string): void;
  onInputCommand?(cb: (command: string, value?: unknown) => void): () => void;
  exitPlugin(): void;
  onPluginState(cb: (s: PluginModeState) => void): () => void;
  onPluginChanged(cb: () => void): () => void;
  onSearchDataChanged?(cb: () => void): () => void;
  favorites?: {
    get(): Promise<{ ids: string[] }>;
    pin(id: string): Promise<{ ids: string[] }>;
    unpin(id: string): Promise<{ ids: string[] }>;
  };
  clipboardHistory?: {
    capture(capture: unknown): Promise<unknown>;
  };
  onToast(cb: (msg: string) => void): () => void;
}

/** 由 sandbox preload (src/preload/main.ts) 注入 */
export const boxkit = (window as unknown as { boxkit: BoxkitBridge }).boxkit;
