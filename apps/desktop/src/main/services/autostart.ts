import { app } from "electron";
import { settings } from "../core/config.js";
export function applyAutostart(): void {
  // dev 模式下 Electron 是裸二进制，无法注册登录项，跳过避免报错
  if (!app.isPackaged) return;
  const want = settings.get().autostart;
  try {
    app.setLoginItemSettings({
      openAtLogin: want,
      // mac 上隐藏启动；该字段仅 darwin 支持
      ...(process.platform === "darwin" ? { openAsHidden: true } : {}),
    });
  } catch (e) {
    // Linux 某些桌面环境不支持，静默降级
    console.warn("[autostart] 设置失败", e);
  }
}
