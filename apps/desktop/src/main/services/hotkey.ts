import { globalShortcut } from "electron";
import { settings } from "../core/config.js";
import { logger } from "../core/logger.js";

let current = "";

export function applyHotkey(onToggle: () => void): void {
  const accel = settings.get().hotkey;
  if (accel === current) return;
  if (current) globalShortcut.unregister(current);
  current = "";
  if (!accel) return;
  try {
    globalShortcut.register(accel, onToggle);
    current = accel;
    logger.info("hotkey", `全局快捷键已注册: ${accel}`);
  } catch (e) {
    logger.error("hotkey", `注册快捷键失败: ${accel}`, e);
  }
}

export function unregisterHotkey(): void {
  if (current) globalShortcut.unregister(current);
  current = "";
}

export function unregisterAll(): void {
  unregisterHotkey();
  globalShortcut.unregisterAll();
}
