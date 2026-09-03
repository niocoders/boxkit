import { globalShortcut } from "electron";
import { settings } from "../core/config.js";
import { logger } from "../core/logger.js";

interface HotkeyConfig {
  hotkey: string;
  pluginHotkeys?: Record<string, string>;
}

let current = "";
const extraHandlers = new Map<string, () => void>();
const registeredExtra = new Map<string, string>();

function normalizeMap(map: Record<string, string> | undefined): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, accel] of Object.entries(map ?? {})) {
    if (typeof accel === "string" && accel.trim()) result.set(key, accel.trim());
  }
  return result;
}

function desiredExtras(config: HotkeyConfig): Map<string, string> {
  const desired = new Map<string, string>();
  for (const [key, accel] of normalizeMap(config.pluginHotkeys)) {
    if (key.startsWith("plugin:") && extraHandlers.has(key)) desired.set(key, accel);
  }
  return desired;
}

function conflict(accel: string): string {
  return `「${accel}」已被其他程序占用，请换一个组合键`;
}

/**
 * 先注册所有变更后的快捷键，全部成功后才替换旧注册。
 * 任一候选失败时，会撤销本次新注册，旧注册保持不变。
 */
export function applyConfiguredHotkeys(
  config: HotkeyConfig,
  onToggle: (() => void) | null = null,
): { ok: boolean; error: string | null } {
  const nextMain = onToggle ? config.hotkey.trim() : current;
  const desired = desiredExtras(config);
  const old = new Map<string, string>();
  if (current) old.set("main", current);
  for (const [key, accel] of registeredExtra) old.set(key, accel);

  const target = new Map<string, string>();
  if (nextMain) target.set("main", nextMain);
  for (const [key, accel] of desired) target.set(key, accel);

  const changed = [...target].filter(([key, accel]) => old.get(key) !== accel);
  const changedAccels = new Set<string>();
  for (const [key, accel] of changed) {
    if (changedAccels.has(accel)) return { ok: false, error: conflict(accel) };
    changedAccels.add(accel);
    const owner = [...old].find(([oldKey, oldAccel]) => oldAccel === accel && oldKey !== key);
    if (owner) return { ok: false, error: conflict(accel) };
    try {
      if (globalShortcut.isRegistered(accel)) return { ok: false, error: conflict(accel) };
    } catch (e) {
      logger.error("hotkey", `检查快捷键失败: ${accel}`, e);
      return { ok: false, error: `「${accel}」注册失败：组合键可能无效或被占用` };
    }
  }

  const added: string[] = [];
  try {
    for (const [key, accel] of changed) {
      const callback = key === "main" ? onToggle : extraHandlers.get(key);
      if (!callback || !globalShortcut.register(accel, callback)) {
        for (const registered of added) {
          try { globalShortcut.unregister(registered); } catch { /* ignore */ }
        }
        logger.warn("hotkey", `快捷键被其他程序占用: ${accel}`);
        return { ok: false, error: conflict(accel) };
      }
      added.push(accel);
    }
  } catch (e) {
    for (const registered of added) {
      try { globalShortcut.unregister(registered); } catch { /* ignore */ }
    }
    logger.error("hotkey", "注册快捷键失败", e);
    return { ok: false, error: "快捷键注册失败：组合键可能无效或被占用" };
  }

  for (const [key, accel] of old) {
    if (target.get(key) !== accel) {
      try { globalShortcut.unregister(accel); } catch { /* ignore */ }
    }
  }
  current = target.get("main") ?? "";
  registeredExtra.clear();
  for (const [key, accel] of target) {
    if (key !== "main") registeredExtra.set(key, accel);
  }
  for (const [key, accel] of changed) logger.info("hotkey", `全局快捷键已注册: ${key}=${accel}`);
  return { ok: true, error: null };
}

export function applyHotkey(
  onToggle: () => void,
  accel = settings.get().hotkey,
): { ok: boolean; error: string | null } {
  return applyConfiguredHotkeys({ ...settings.get(), hotkey: accel }, onToggle);
}

/** 同步插件和应用处理器，并按当前设置重新注册。 */
export function setExtraHotkeyHandlers(handlers: Map<string, () => void>): string | null {
  extraHandlers.clear();
  for (const [key, handler] of handlers) extraHandlers.set(key, handler);
  return applyConfiguredHotkeys(settings.get()).error;
}

export function refreshExtraHotkeys(): string | null {
  return applyConfiguredHotkeys(settings.get()).error;
}

export function unregisterHotkey(): void {
  if (current) globalShortcut.unregister(current);
  current = "";
}

export function unregisterAll(): void {
  unregisterHotkey();
  registeredExtra.clear();
  extraHandlers.clear();
  globalShortcut.unregisterAll();
}
