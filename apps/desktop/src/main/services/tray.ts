import { app, Menu, nativeImage, Tray } from "electron";
import path from "node:path";
import { logger } from "../core/logger.js";

let tray: Tray | null = null;

function trayIconPath(): string {
  // macOS 用黑色模板图标（随明暗主题反色）；Win/Linux 任务栏无模板机制，用彩色应用图标
  const name = process.platform === "darwin" ? "trayTemplate.png" : "icon.png";
  if (app.isPackaged) return path.join(process.resourcesPath, name);
  return path.join(__dirname, "../../../resources", name);
}

export interface TrayCallbacks {
  onToggle: () => void;
  onSettings: () => void;
  onCheckUpdate: () => void;
  onQuit: () => void;
}

export function createTray(cb: TrayCallbacks): void {
  try {
    const icon = nativeImage.createFromPath(trayIconPath());
    if (process.platform === "darwin") icon.setTemplateImage(true);
    tray = new Tray(icon);
    tray.setToolTip("BoxKit — 效率启动器");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "打开 BoxKit", click: cb.onToggle },
        { type: "separator" },
        { label: "设置…", accelerator: "Cmd+,", click: cb.onSettings },
        { label: "检查更新…", click: cb.onCheckUpdate },
        { type: "separator" },
        { label: "退出 BoxKit", click: cb.onQuit },
      ]),
    );
    tray.on("click", cb.onToggle);
  } catch (e) {
    logger.warn("tray", "托盘创建失败（不影响核心功能）", e);
  }
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
