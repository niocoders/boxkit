import { BrowserWindow, screen } from "electron";
import path from "node:path";
import { logger } from "../core/logger.js";
import {
  constrainWindowToCurrentDisplay,
  displayForSource,
  flushWindowBounds,
  initialWindowBounds,
  placeWindowOnDisplay,
  rememberWindowBounds,
  watchWindowDisplay,
} from "./windowState.js";

let win: BrowserWindow | null = null;
let quitting = false;
let preserveRestoredPosition = false;
let stopDisplayWatch: (() => void) | null = null;

const SEARCH_SIZE = { width: 802, height: 418 } as const;
const SEARCH_MIN_SIZE = { width: 480, height: 260 } as const;

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
  const initial = initialWindowBounds("main", null, SEARCH_SIZE, SEARCH_MIN_SIZE, { verticalRatio: 0.15 });
  preserveRestoredPosition = initial.restored;
  win = new BrowserWindow({
    // 搜索面板的初始尺寸；在小工作区按当前 display 的 DIP 尺寸缩小。
    ...initial.bounds,
    minWidth: initial.minimum.width,
    minHeight: initial.minimum.height,
    resizable: false,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    // macOS 用 vibrancy 磨砂；Windows 10 不支持 backgroundMaterial，启用 acrylic
    // 会退化为近乎全透明的窗口，因此仅在 mac 启用，Windows 靠 CSS 近实底背景。
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
    rememberWindowBounds("main", win!);
    flushWindowBounds("main");
    if (!quitting) {
      e.preventDefault();
      hideMainWindow();
    }
  });
  let resizeTimer: NodeJS.Timeout | null = null;
  win.on("resize", () => {
    rememberWindowBounds("main", win!);
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => onResizeCb?.(), 80);
  });
  win.on("move", () => rememberWindowBounds("main", win!));
  stopDisplayWatch?.();
  stopDisplayWatch = watchWindowDisplay("main", win, SEARCH_MIN_SIZE);
  rememberWindowBounds("main", win);
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
    const target = displayForSource(null);
    if (preserveRestoredPosition) {
      // A saved display is authoritative on the first show after startup.
      constrainWindowToCurrentDisplay(win, SEARCH_MIN_SIZE);
      preserveRestoredPosition = false;
    } else {
      const currentDisplay = screen.getDisplayMatching(win.getBounds());
      if (String(currentDisplay.id) !== String(target.id)) {
        const [width, height] = win.getSize();
        placeWindowOnDisplay(win, target, { width, height }, SEARCH_MIN_SIZE, { verticalRatio: 0.15 });
      } else {
        constrainWindowToCurrentDisplay(win, SEARCH_MIN_SIZE);
      }
    }
    rememberWindowBounds("main", win);
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
