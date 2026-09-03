import { exec } from "node:child_process";
import { logger } from "../core/logger.js";
import type { EngineCommand } from "./searchEngine.js";

export interface SystemCommand extends EngineCommand {
  /** 特殊指令由主进程直接处理，不走 shell */
  special?: "settings" | "quit";
  run?: () => Promise<string | null>; // 返回错误信息或 null
}

function sh(cmd: string, timeout = 5000): Promise<string | null> {
  return new Promise((resolve) => {
    exec(cmd, { timeout }, (err) => resolve(err ? err.message : null));
  });
}

function macCommands(): SystemCommand[] {
  return [
    {
      id: "sleep",
      title: "睡眠",
      keywords: ["sleep", "休眠", "睡眠"],
      builtinIcon: "🌙",
      run: () => sh("pmset sleepnow"),
    },
    {
      id: "lock",
      title: "熄灭屏幕",
      keywords: ["lock", "锁屏", "熄屏", "熄灭屏幕"],
      builtinIcon: "🔒",
      run: () => sh("pmset displaysleepnow"),
    },
    {
      id: "empty-trash",
      title: "清空废纸篓",
      keywords: ["trash", "废纸篓", "清空废纸篓", "垃圾"],
      builtinIcon: "🗑️",
      run: () => sh(`osascript -e 'tell application "Finder" to empty trash'`),
    },
    {
      id: "restart-finder",
      title: "重新启动访达",
      keywords: ["finder", "访达", "重启访达"],
      builtinIcon: "🖥️",
      run: () => sh("killall Finder"),
    },
  ];
}

function winCommands(): SystemCommand[] {
  return [
    {
      id: "lock",
      title: "锁定电脑",
      keywords: ["lock", "锁屏", "锁定"],
      builtinIcon: "🔒",
      run: () => sh("rundll32.exe user32.dll,LockWorkStation"),
    },
    {
      id: "sleep",
      title: "睡眠",
      keywords: ["sleep", "休眠", "睡眠"],
      builtinIcon: "🌙",
      run: () => sh("rundll32.exe powrprof.dll,SetSuspendState 0,1,0"),
    },
    {
      id: "empty-trash",
      title: "清空回收站",
      keywords: ["trash", "回收站", "清空回收站", "垃圾"],
      builtinIcon: "🗑️",
      run: () =>
        sh("powershell -NoProfile -Command \"Clear-RecycleBin -Force -ErrorAction SilentlyContinue\""),
    },
    {
      id: "task-manager",
      title: "任务管理器",
      keywords: ["task manager", "任务管理器", "进程"],
      builtinIcon: "📊",
      run: () => sh("start taskmgr"),
    },
    {
      id: "restart-explorer",
      title: "重启资源管理器",
      keywords: ["explorer", "资源管理器", "重启资源管理器"],
      builtinIcon: "🖥️",
      run: () => sh("taskkill /F /IM explorer.exe & start explorer.exe"),
    },
  ];
}

function linuxCommands(): SystemCommand[] {
  return [
    {
      id: "sleep",
      title: "睡眠",
      keywords: ["sleep", "休眠", "睡眠"],
      builtinIcon: "🌙",
      run: () => sh("systemctl suspend"),
    },
    {
      id: "lock",
      title: "锁屏",
      keywords: ["lock", "锁屏", "锁定"],
      builtinIcon: "🔒",
      run: () => sh("loginctl lock-session"),
    },
    {
      id: "empty-trash",
      title: "清空回收站",
      keywords: ["trash", "回收站", "清空回收站", "垃圾"],
      builtinIcon: "🗑️",
      run: () => sh("gio trash --empty"),
    },
  ];
}

const COMMON: SystemCommand[] = [
  {
    id: "settings",
    title: "BoxKit 设置",
    keywords: ["settings", "设置", "偏好", "preferences"],
    builtinIcon: "⚙️",
    special: "settings",
  },
  {
    id: "quit",
    title: "退出 BoxKit",
    keywords: ["quit", "退出", "关闭"],
    builtinIcon: "🚪",
    special: "quit",
  },
];

export function getSystemCommands(): SystemCommand[] {
  let platform: SystemCommand[] = [];
  switch (process.platform) {
    case "darwin":
      platform = macCommands();
      break;
    case "win32":
      platform = winCommands();
      break;
    case "linux":
      platform = linuxCommands();
      break;
  }
  return [...COMMON, ...platform];
}

export async function runSystemCommand(
  id: string,
  find: (id: string) => SystemCommand | undefined,
): Promise<{ ok: boolean; message?: string }> {
  const cmd = find(id);
  if (!cmd) return { ok: false, message: "未找到该命令" };
  if (cmd.special) return { ok: true };
  if (!cmd.run) return { ok: false, message: "该命令在当前平台不可用" };
  try {
    const err = await cmd.run();
    if (err) {
      logger.warn("command", `命令 ${id} 执行失败: ${err}`);
      return { ok: false, message: "执行失败（可能缺少系统权限）" };
    }
    return { ok: true };
  } catch (e) {
    logger.error("command", `命令 ${id} 异常`, e);
    return { ok: false, message: "执行异常" };
  }
}
