import type {
  AppSettings,
  ConfigSetResult,
  InstallPreview,
  LicenseState,
  MarketPlugin,
  PluginListItem,
  UpdateState,
} from "@boxkit/shared";

export interface SettingsBridge {
  configGet(): Promise<AppSettings>;
  configSet(patch: Partial<AppSettings>): Promise<ConfigSetResult>;
  plugins: {
    list(): Promise<PluginListItem[]>;
    installPreview(): Promise<{ preview: InstallPreview; conflict: string } | null>;
    installConfirm(stagingId: string): Promise<{ ok: boolean; name?: string; error?: string }>;
    enable(name: string): void;
    disable(name: string): void;
    uninstall(name: string): Promise<{ ok: boolean; error?: string }>;
    addDevPath(): Promise<{ ok: boolean; error?: string }>;
    removeDevPath(dir: string): void;
  };
  market: {
    fetch(keyword: string): Promise<MarketPlugin[] | { error: string }>;
    install(
      pluginId: string,
    ): Promise<{ preview: InstallPreview; conflict?: string } | { error: string } | null>;
  };
  licenseState(): Promise<LicenseState>;
  activate(key: string): Promise<{ ok: boolean; state?: LicenseState; error?: string }>;
  deactivate(): Promise<LicenseState>;
  updaterState(): Promise<UpdateState>;
  checkUpdate(): Promise<UpdateState>;
  installUpdate(): void;
  onUpdateEvent(cb: (s: UpdateState) => void): () => void;
  appInfo(): Promise<{
    version: string;
    electron: string;
    node: string;
    platform: string;
    osRelease: string;
  }>;
  quit(): void;
  openLogs(): void;
}

/** 由 sandbox preload (src/preload/main.js) 注入，与搜索面板共用同一 preload */
export const boxkit = (window as unknown as { boxkit: SettingsBridge }).boxkit;
