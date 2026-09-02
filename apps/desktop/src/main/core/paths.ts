import { app } from "electron";
import path from "node:path";
import fs from "node:fs";

/** 统一的 userData 目录布局：插件、插件数据、日志、授权全部隔离存放。 */
export const userDataDir = () => app.getPath("userData");
export const pluginsDir = () => path.join(userDataDir(), "plugins");
export const pluginDataDir = () => path.join(userDataDir(), "plugin-data");
export const stagingDir = () => path.join(userDataDir(), "plugin-staging");
export const logsDir = () => path.join(userDataDir(), "logs");
export const configPath = () => path.join(userDataDir(), "config.json");
export const machineIdPath = () => path.join(userDataDir(), ".machine-id");

export function ensureDirs(): void {
  for (const dir of [userDataDir(), pluginsDir(), pluginDataDir(), stagingDir(), logsDir()]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
