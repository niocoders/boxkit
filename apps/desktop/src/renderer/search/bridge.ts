import type { InputPayload, PluginModeState, SearchResult } from "@boxkit/shared";

export type AsyncStatus = "idle" | "loading" | "success" | "empty" | "error";

export interface AsyncState<T> {
  status: AsyncStatus;
  data?: T;
  error?: string;
}

export interface SearchExecutionResult {
  ok: boolean;
  message?: string;
  code?: string;
}

export interface BoxkitBridge {
  query(text: string | InputPayload): Promise<SearchResult[]>;
  execute(result: SearchResult): Promise<SearchExecutionResult>;
  hide(): void;
  openSettings(): void;
  openPluginSettings(pluginId: string): void;
  openProfile(): void;
  sendInput(text: string): void;
  onInputCommand?(cb: (command: string, value?: unknown) => void): () => void;
  /** Electron 44 removed File.path; preload owns the filesystem lookup. */
  getPathForFile?(file: File): string;
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
