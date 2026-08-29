import { BrowserWindow } from "electron";
import path from "node:path";

let win: BrowserWindow | null = null;

export function getSettingsWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
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
  win.once("ready-to-show", () => win?.show());
  win.on("closed", () => {
    win = null;
  });
}
