import { openSettingsWindow } from "./settingsWindow.js";

/** 兼容旧调用：个人中心已经并入设置的本地概览。 */
export function openProfileWindow(): void {
  openSettingsWindow("overview");
}

/** 个人中心独立 IPC 已移除；保留空函数避免旧入口导入失败。 */
export function registerProfileIpc(): void {}
