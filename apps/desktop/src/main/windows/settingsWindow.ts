import { BrowserWindow } from "electron";
import path from "node:path";
import { IPC } from "@boxkit/shared";

let win: BrowserWindow | null = null;
let pendingInstallPreview: unknown = null;

export function getSettingsWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

function flushInstallPreview(): void {
  const target = getSettingsWindow();
  if (!target || target.webContents.isLoadingMainFrame() || !pendingInstallPreview) return;
  target.show();
  target.focus();
  target.webContents.send(IPC.settingsInstallPreview, pendingInstallPreview);
  pendingInstallPreview = null;
}

/** 将协议导入的待确认安装可靠地投递给设置页。 */
export function queueInstallPreview(payload: unknown): void {
  pendingInstallPreview = payload;
  const target = getSettingsWindow();
  if (!target) {
    openSettingsWindow();
    return;
  }
  flushInstallPreview();
}

export function openSettingsWindow(): void {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 820,
    height: 580,
    minWidth: 720,
    minHeight: 520,
    title: "BoxKit 设置",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 16, y: 20 },
    show: false,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/main.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  void (devUrl
    ? win.loadURL(`${devUrl}/settings/index.html`)
    : win.loadFile(path.join(__dirname, "../renderer/settings/index.html")));
  win.webContents.on("did-finish-load", flushInstallPreview);
  win.once("ready-to-show", () => win?.show());
  win.on("closed", () => {
    win = null;
  });
}
