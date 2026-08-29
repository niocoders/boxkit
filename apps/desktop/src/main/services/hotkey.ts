import { globalShortcut } from "electron";
import { settings } from "../core/config.js";
import { logger } from "../core/logger.js";

let current = "";

export function applyHotkey(onToggle: () => void): { ok: boolean; error: string | null } {
  const accel = settings.get().hotkey;
  if (accel === current) return { ok: true, error: null };
  if (current) globalShortcut.unregister(current);
  current = "";
  if (!accel) return { ok: true, error: null };
  try {
    if (!globalShortcut.isRegistered(accel)) {
      const ok = globalShortcut.register(accel, onToggle);
      if (!ok) {
        logger.warn("hotkey", `快捷键被其他程序占用: ${accel}`);
        return { ok: false, error: `「${accel}」已被其他程序占用，请换一个组合键` };
      }
    }
    current = accel;
    logger.info("hotkey", `全局快捷键已注册: ${accel}`);
    return { ok: true, error: null };
  } catch (e) {
    logger.error("hotkey", `注册快捷键失败: ${accel}`, e);
    return { ok: false, error: `「${accel}」注册失败：组合键可能无效或被占用` };
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
