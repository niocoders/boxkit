import { BrowserWindow } from "electron";
import type { DetachHostState } from "@boxkit/shared";
import { DETACH_TOOLBAR_HEIGHT, IPC } from "@boxkit/shared";
import type { PluginHost } from "../plugins/host.js";
import { getMainWindow, showMainWindow } from "./mainWindow.js";
import path from "node:path";

/**
 * 插件独立窗口：复用 PluginHost 的插件 WebContentsView，宿主页面只负责工具栏。
 * 每个插件至多持有一个独立窗口；关闭、归还和异常销毁都走同一条回收路径。
 */

interface DetachedState {
  window: BrowserWindow;
  pluginName: string;
  previousSize: { width: number; height: number };
  displayName: string;
  subinput: { placeholder: string; value: string } | null;
  alwaysOnTop: boolean;
  zoomFactor: number;
}

const detached = new Map<string, DetachedState>();
let quitting = false;

export function isDetached(pluginName: string): boolean {
  return detached.has(pluginName);
}

function stateOf(state: DetachedState): DetachHostState {
  return {
    pluginName: state.pluginName,
    displayName: state.displayName,
    subinput: state.subinput ? { ...state.subinput } : null,
    alwaysOnTop: state.alwaysOnTop,
    zoomFactor: state.zoomFactor,
  };
}

function pushState(state: DetachedState): void {
  if (!state.window.isDestroyed()) state.window.webContents.send(IPC.detachState, stateOf(state));
}

function findByWindow(window: BrowserWindow): DetachedState | null {
  for (const state of detached.values()) if (state.window === window) return state;
  return null;
}

export function detachPluginWindow(host: PluginHost, pluginName: string): boolean {
  if (detached.has(pluginName)) {
    const current = detached.get(pluginName)!;
    current.window.show();
    current.window.focus();
    return true;
  }
  const main = getMainWindow();
  if (!main) return false;

  const previousSize = { width: main.getSize()[0], height: main.getSize()[1] };
  const initial = host.detachedHostState(pluginName);
  const detachedResult = host.detachForDetachWindow(pluginName);
  if (!detachedResult.ok) return false;
  const restoreSize = detachedResult.restoreSize ?? previousSize;
  const window = new BrowserWindow({
    width: Math.max(680, previousSize.width),
    height: Math.max(520, previousSize.height + 160),
    minWidth: 520,
    minHeight: DETACH_TOOLBAR_HEIGHT + 160,
    title: `BoxKit 插件 - ${initial.displayName}`,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f5f7fb",
    webPreferences: {
      preload: path.join(__dirname, "../preload/detach.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  const state: DetachedState = {
    window,
    pluginName,
    previousSize: restoreSize,
    displayName: initial.displayName,
    subinput: initial.subinput,
    alwaysOnTop: false,
    zoomFactor: 1,
  };
  detached.set(pluginName, state);
  void (process.env.VITE_DEV_SERVER_URL
    ? window.loadURL(`${process.env.VITE_DEV_SERVER_URL}/detach/index.html`)
    : window.loadFile(path.join(__dirname, "../renderer/detach/index.html")));
  window.once("ready-to-show", () => {
    window.show();
    window.focus();
    pushState(state);
  });
  window.on("resize", () => host.layoutDetachedWindow(pluginName, window));
  window.on("closed", () => {
    if (quitting || detached.get(pluginName)?.window !== window) return;
    void reattachPluginWindow(host, pluginName);
  });
  window.webContents.on("did-finish-load", () => {
    host.attachToDetachedWindow(pluginName, window);
    pushState(state);
  });
  host.setDetachedWindow(pluginName, window);
  host.attachToDetachedWindow(pluginName, window);
  return true;
}

export function updateDetachedSubInput(pluginName: string, patch: { placeholder?: string; value?: string }): void {
  const state = detached.get(pluginName);
  if (!state) return;
  state.subinput = {
    placeholder: patch.placeholder ?? state.subinput?.placeholder ?? "",
    value: patch.value ?? state.subinput?.value ?? "",
  };
  if (!state.subinput.placeholder) state.subinput = null;
  pushState(state);
}

export function findDetachedHostBySender(senderId: number): DetachedState | null {
  for (const state of detached.values()) {
    if (!state.window.isDestroyed() && state.window.webContents.id === senderId) return state;
  }
  return null;
}

export function updateDetachedWindowState(
  pluginName: string,
  patch: Partial<Pick<DetachedState, "alwaysOnTop" | "zoomFactor">>,
): DetachHostState | null {
  const state = detached.get(pluginName);
  if (!state) return null;
  if (patch.alwaysOnTop !== undefined) {
    state.alwaysOnTop = patch.alwaysOnTop;
    state.window.setAlwaysOnTop(state.alwaysOnTop);
  }
  if (patch.zoomFactor !== undefined) {
    state.zoomFactor = Math.max(0.5, Math.min(2, patch.zoomFactor));
    state.window.webContents.setZoomFactor(state.zoomFactor);
  }
  pushState(state);
  return stateOf(state);
}

export function detachStateForWindow(window: BrowserWindow): DetachHostState | null {
  const state = findByWindow(window);
  return state ? stateOf(state) : null;
}

export function reattachPluginWindow(host: PluginHost, pluginName: string): boolean {
  const state = detached.get(pluginName);
  if (!state) return false;
  const { window, previousSize } = state;
  detached.delete(pluginName);
  try {
    host.releaseDetachedWindow(pluginName, window);
    host.reattachFromDetachedWindow(pluginName);
  } finally {
    if (!window.isDestroyed()) window.destroy();
    const main = getMainWindow();
    if (main) {
      main.setSize(previousSize.width, previousSize.height);
      showMainWindow();
      main.webContents.send(IPC.pluginState, { mode: "search", subinput: null });
    }
  }
  return true;
}

export function getDetachedWindow(pluginName: string): BrowserWindow | null {
  return detached.get(pluginName)?.window ?? null;
}

export function detachedPluginNames(): string[] {
  return [...detached.keys()];
}

export function closeAllDetached(): void {
  for (const state of detached.values()) if (!state.window.isDestroyed()) state.window.close();
}

/** 由入口在 quit 时调用。 */
export function destroyDetachedWindows(): void {
  quitting = true;
  const states = [...detached.values()];
  detached.clear();
  for (const { window } of states) if (!window.isDestroyed()) window.destroy();
}
