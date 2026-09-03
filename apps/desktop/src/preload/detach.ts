import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "@boxkit/shared/ipc";
import type { DetachHostState } from "@boxkit/shared/types";

const api = {
  getState: (): Promise<DetachHostState | null> => ipcRenderer.invoke(IPC.detachGetState),
  onState: (cb: (state: DetachHostState) => void) => {
    const listener = (_event: unknown, state: DetachHostState) => cb(state);
    ipcRenderer.on(IPC.detachState, listener);
    return () => ipcRenderer.removeListener(IPC.detachState, listener);
  },
  input: (value: string) => ipcRenderer.send(IPC.detachInput, value),
  reattach: () => ipcRenderer.invoke(IPC.detachReattach),
  close: () => ipcRenderer.invoke(IPC.detachClose),
  toggleAlwaysOnTop: () => ipcRenderer.invoke(IPC.detachToggleAlwaysOnTop),
  setZoom: (zoomFactor: number) => ipcRenderer.invoke(IPC.detachSetZoom, zoomFactor),
  openPluginSettings: (pluginId: string) => ipcRenderer.send(IPC.uiOpenSettings, {
    tab: "plugins",
    view: "installed",
    pluginId,
  }),
};

contextBridge.exposeInMainWorld("detachHost", api);
