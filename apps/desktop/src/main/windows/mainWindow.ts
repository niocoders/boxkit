import { BrowserWindow, screen } from "electron";
import path from "node:path";
import { logger } from "../core/logger.js";

let win: BrowserWindow | null = null;
let quitting = false;

/** 由入口注入：失焦时是否允许自动隐藏（插件打开时也需要隐藏，恒为 true） */
export const blurPolicy = { hideOnBlur: () => true };

export function setQuitting(v: boolean): void {
  quitting = v;
}

export function getMainWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

function resolveSearchPage(): { url?: string; file?: string } {
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) return { url: `${devUrl}/search/index.html` };
  return { file: path.join(__dirname, "../renderer/search/index.html") };
}

export function createMainWindow(): BrowserWindow {
  win = new BrowserWindow({
    // uTools 式固定面板：不拉伸、不最小化，尺寸恒定
    width: 760,
    height: 600,
    minWidth: 760,
    minHeight: 600,
    maxWidth: 760,
    maxHeight: 600,
    resizable: false,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    vibrancy: process.platform === "darwin" ? "under-window" : undefined,
    visualEffectState: "active",
    fullscreenable: false,
    skipTaskbar: true,
    title: "BoxKit",
    webPreferences: {
      preload: path.join(__dirname, "../preload/main.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  const page = resolveSearchPage();
  void (page.url ? win.loadURL(page.url) : win.loadFile(page.file!));

  win.on("blur", () => {
    if (blurPolicy.hideOnBlur()) hideMainWindow();
  });
  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      hideMainWindow();
    }
  });
  let resizeTimer: NodeJS.Timeout | null = null;
  win.on("resize", () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => onResizeCb?.(), 80);
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    logger.error("window", `搜索窗渲染进程退出: ${details.reason}`);
  });
  return win;
}

let onResizeCb: (() => void) | null = null;
export function setMainWindowResizeHandler(cb: () => void): void {
  onResizeCb = cb;
}

export function showMainWindow(): void {
  if (!win) return;
  if (!win.isVisible()) {
    const { workArea } = screen.getPrimaryDisplay();
    const [w] = win.getSize();
    win.setPosition(Math.round(workArea.x + (workArea.width - w) / 2), workArea.y + 120);
  }
  win.show();
  win.focus();
  win.webContents.focus();
}

export function hideMainWindow(): void {
  win?.hide();
}

export function toggleMainWindow(): void {
  if (win?.isVisible()) hideMainWindow();
  else showMainWindow();
}
