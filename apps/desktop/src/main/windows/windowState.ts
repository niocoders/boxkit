import { BrowserWindow, screen } from "electron";
import type { AppSettings } from "@boxkit/shared";
import { settings } from "../core/config.js";
import {
  clampBoundsToWorkArea,
  findDisplayById,
  fitWindowSize,
  placeWindowInWorkArea,
  sameWindowRect,
  type WindowRect,
  type WindowSize,
  type WorkArea,
} from "./windowGeometry.js";

const WINDOW_BOUNDS_KEY = "windowBounds";
const PERSIST_DELAY_MS = 200;

export interface StoredWindowBounds {
  bounds: WindowRect;
  displayId?: string;
  scaleFactor?: number;
}

export interface InitialWindowBounds {
  bounds: WindowRect;
  minimum: WindowSize;
  display: Electron.Display;
  restored: boolean;
}

const pendingStates = new Map<string, StoredWindowBounds>();
const pendingTimers = new Map<string, NodeJS.Timeout>();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseBounds(value: unknown): WindowRect | null {
  const record = asRecord(value);
  if (!record) return null;
  const x = finiteNumber(record.x);
  const y = finiteNumber(record.y);
  const width = finiteNumber(record.width);
  const height = finiteNumber(record.height);
  if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

function readBoundsMap(): Record<string, unknown> {
  const value = (settings.get() as unknown as Record<string, unknown>)[WINDOW_BOUNDS_KEY];
  const root = asRecord(value);
  return root ? { ...root } : {};
}

export function readStoredWindowBounds(kind: string): StoredWindowBounds | null {
  const raw = asRecord(readBoundsMap()[kind]);
  const bounds = parseBounds(raw?.bounds);
  if (!raw || !bounds) return null;
  const stored: StoredWindowBounds = { bounds };
  if (typeof raw.displayId === "string" || typeof raw.displayId === "number") stored.displayId = String(raw.displayId);
  const scaleFactor = finiteNumber(raw.scaleFactor);
  if (scaleFactor !== null && scaleFactor > 0) stored.scaleFactor = scaleFactor;
  return stored;
}

function writeWindowBounds(kind: string, state: StoredWindowBounds): void {
  const all = readBoundsMap();
  all[kind] = state;
  settings.set({ [WINDOW_BOUNDS_KEY]: all } as unknown as Partial<AppSettings>);
}

export function flushWindowBounds(kind: string): void {
  const timer = pendingTimers.get(kind);
  if (timer) clearTimeout(timer);
  pendingTimers.delete(kind);
  const state = pendingStates.get(kind);
  if (!state) return;
  pendingStates.delete(kind);
  writeWindowBounds(kind, state);
}

export function rememberWindowBounds(kind: string, win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  const bounds = win.getBounds();
  const display = screen.getDisplayMatching(bounds);
  pendingStates.set(kind, {
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    displayId: String(display.id),
    scaleFactor: display.scaleFactor,
  });
  const oldTimer = pendingTimers.get(kind);
  if (oldTimer) clearTimeout(oldTimer);
  pendingTimers.set(kind, setTimeout(() => flushWindowBounds(kind), PERSIST_DELAY_MS));
}

export function displayForSource(source: BrowserWindow | null): Electron.Display {
  if (source && !source.isDestroyed()) return screen.getDisplayMatching(source.getBounds());
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

function displayWithId(id: string | undefined): Electron.Display | undefined {
  return findDisplayById(screen.getAllDisplays(), id);
}

export function initialWindowBounds(
  kind: string,
  source: BrowserWindow | null,
  desired: WindowSize,
  minimum: WindowSize,
  placement?: { verticalRatio?: number },
): InitialWindowBounds {
  const sourceDisplay = displayForSource(source);
  const stored = readStoredWindowBounds(kind);
  const display = displayWithId(stored?.displayId) ?? sourceDisplay;
  const workArea = display.workArea as WorkArea;
  const fittedMinimum = fitWindowSize(minimum, workArea, minimum);
  if (stored) {
    return {
      bounds: clampBoundsToWorkArea(stored.bounds, workArea, minimum),
      minimum: fittedMinimum,
      display,
      restored: true,
    };
  }
  return {
    bounds: placeWindowInWorkArea(desired, workArea, minimum, placement),
    minimum: fittedMinimum,
    display,
    restored: false,
  };
}

export function constrainWindowToCurrentDisplay(win: BrowserWindow, minimum: WindowSize): Electron.Display {
  const display = screen.getDisplayMatching(win.getBounds());
  const workArea = display.workArea as WorkArea;
  const fittedMinimum = fitWindowSize(minimum, workArea, minimum);
  win.setMinimumSize(fittedMinimum.width, fittedMinimum.height);
  const current = win.getBounds();
  const next = clampBoundsToWorkArea(current, workArea, minimum);
  if (!sameWindowRect(current, next)) win.setBounds(next);
  return display;
}

export function placeWindowOnDisplay(
  win: BrowserWindow,
  display: Electron.Display,
  desired: WindowSize,
  minimum: WindowSize,
  placement?: { verticalRatio?: number },
): void {
  const workArea = display.workArea as WorkArea;
  const fittedMinimum = fitWindowSize(minimum, workArea, minimum);
  win.setMinimumSize(fittedMinimum.width, fittedMinimum.height);
  const next = placeWindowInWorkArea(desired, workArea, minimum, placement);
  if (!sameWindowRect(win.getBounds(), next)) win.setBounds(next);
}

export function watchWindowDisplay(kind: string, win: BrowserWindow, minimum: WindowSize): () => void {
  const sync = () => {
    if (win.isDestroyed()) return;
    constrainWindowToCurrentDisplay(win, minimum);
    rememberWindowBounds(kind, win);
  };
  screen.on("display-removed", sync);
  screen.on("display-metrics-changed", sync);
  return () => {
    screen.off("display-removed", sync);
    screen.off("display-metrics-changed", sync);
    flushWindowBounds(kind);
  };
}
