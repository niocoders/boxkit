import { app, protocol } from "electron";
import fs from "node:fs";
import path from "node:path";
import { IPC } from "@boxkit/shared";
import { ensureDirs } from "./core/paths.js";
import { logger, markLogFileReady, flushBufferedLogs } from "./core/logger.js";
import { settings } from "./core/config.js";
import { initCrash } from "./services/crash.js";
import { applyHotkey, unregisterAll } from "./services/hotkey.js";
import { applyAutostart } from "./services/autostart.js";
import { createTray, destroyTray } from "./services/tray.js";
import { initUpdater, SMOKING } from "./services/updater.js";
import { pluginManager } from "./plugins/manager.js";
import { commitInstall } from "./plugins/staging.js";
import { marketService } from "./services/market.js";
import { usageFlush } from "./core/usage.js";
import { cleanupStaging } from "./plugins/staging.js";
import { PluginHost } from "./plugins/host.js";
import { appProvider } from "./providers/apps.js";
import {
  createMainWindow,
  getMainWindow,
  setMainWindowResizeHandler,
  setQuitting,
  showMainWindow,
  toggleMainWindow,
} from "./windows/mainWindow.js";
import { openSettingsWindow } from "./windows/settingsWindow.js";
import { registerIpc, sendToMainWindow, toggleViaHotkey, toast } from "./ipc.js";

// 自定义协议需在 app ready 前注册特权
protocol.registerSchemesAsPrivileged([
  {
    scheme: "bk-plugin",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  bootstrap();
}

function bootstrap(): void {
  // 让插件可通过 UA 识别宿主版本
  app.userAgentFallback = `BoxKit/${app.getVersion()} ${app.userAgentFallback}`;
  // 市场协议：Web 门户「导入到 BoxKit」按钮 → boxkit-market://install/<pluginId>
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("boxkit-market", process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient("boxkit-market");
  }
  // 单实例：二次唤起 → 显示主窗（也用于 .bkx 安装回调）
  // Windows/Linux 下双击 .bkx 会以文件路径为参数拉起新实例，走 second-instance 的 argv
  app.on("second-instance", (_e, argv) => {
    showMainWindow();
    handleBkxPath(argv.find((a) => /\.bkx$/i.test(a)));
  });

  app.on("open-file", (e, filePath) => {
    e.preventDefault();
    if (/\.bkx$/i.test(filePath)) handleBkxPath(filePath);
  });

  app.whenReady().then(onReady);

  app.on("window-all-closed", () => {
    // 托盘常驻应用：不退出
  });

  app.on("before-quit", () => {
    setQuitting(true);
    unregisterAll();
    pluginManager.flushAllDb();
    usageFlush();
    destroyTray();
  });

  app.on("quit", () => {
    flushBufferedLogs();
  });
}

let pluginHost: PluginHost;

/** 处理 .bkx 打开请求（mac open-file / win/linux argv），引导到设置页安装 */
function handleBkxPath(filePath?: string): void {
  if (!filePath) return;
  openSettingsWindow();
  toast(`请在「插件」页点击「安装插件包」选择：${path.basename(filePath)}`);
}

/** 处理市场协议：boxkit-market://install/<pluginId> → 下载并自动导入（无需确认） */
function handleMarketUrl(url?: string): void {
  const m = url?.match(/^boxkit-market:\/\/install\/([a-z0-9][a-z0-9-]*)$/i);
  if (!m) return;
  const pluginId = m[1];
  logger.info("boot", `市场协议导入: ${pluginId}`);
  void (async () => {
    try {
      const r = await marketService.installFromMarket(pluginId);
      if ("error" in r) {
        toast(r.error);
        return;
      }
      const manifest = await commitInstall(r.preview.stagingId);
      pluginManager.reloadAll();
      toast(`已从市场导入：${manifest.displayName} v${manifest.version}`);
      logger.info("boot", `市场导入完成: ${manifest.name}`);
    } catch (err) {
      logger.error("boot", "市场导入失败", err);
      toast("市场插件导入失败");
    }
  })();
}

function onReady(): void {
  ensureDirs();
  markLogFileReady();
  initCrash();

  // 面板应用：隐藏 Dock 图标
  if (process.platform === "darwin" && app.dock) app.dock.hide();

  settings.load();
  settings.onChange(() => {
    applyAutostart();
  });

  // 主窗
  createMainWindow();
  pluginHost = new PluginHost(
    pluginManager,
    toast,
    path.join(__dirname, "../preload/plugin.js"),
  );
  setMainWindowResizeHandler(() => {
    const win = getMainWindow();
    if (win) pluginHost.layout(win);
  });
  pluginHost.onStateChange((s) => sendToMainWindow(IPC.pluginState, s));
  pluginManager.onChange(() => sendToMainWindow(IPC.pluginChanged, null));

  registerIpc({
    pluginHost,
    onQuitRequest: () => app.quit(),
  });

  // 插件与数据
  cleanupStaging();
  pluginManager.init();

  // 应用扫描（后台）
  void appProvider.rescan();

  // 托盘 / 自启 / 快捷键 / 更新
  createTray({
    onToggle: toggleMainWindow,
    onSettings: openSettingsWindow,
    onCheckUpdate: () => {
      openSettingsWindow();
    },
    onQuit: () => app.quit(),
  });
  applyAutostart();

  if (SMOKING) {
    logger.info("boot", "冒烟测试模式：跳过全局快捷键与更新检查");
  } else {
    applyHotkey(toggleViaHotkey);
    initUpdater();
  }

  if (SMOKING) {
    smokeCheck();
    return;
  }
  // BOXKIT_IMPORT_TEST=<pluginId>：无头验证市场自动导入链路（下载→安装→重载）
  if (process.env.BOXKIT_IMPORT_TEST) {
    setTimeout(async () => {
      try {
        const pid = process.env.BOXKIT_IMPORT_TEST as string;
      const r = await marketService.installFromMarket(pid);
        if ("error" in r) throw new Error(r.error);
        const manifest = await commitInstall(r.preview.stagingId);
        pluginManager.reloadAll();
        const loaded = pluginManager.all().find((x) => x.manifest.name === manifest.name);
        console.log(`IMPORT_TEST_OK ${manifest.name} v${manifest.version} logo=${loaded?.logoDataUrl ? "yes" : "no"}`);
      } catch (err) {
        console.log("IMPORT_TEST_FAIL", String(err));
      }
      app.exit(0);
    }, 2500);
    return;
  }
  // BOXKIT_SHOT_TEST=<png路径|->：无头验证 screenCapture 内部链路（抓屏+DPR 裁剪）
  if (process.env.BOXKIT_SHOT_TEST) {
    setTimeout(async () => {
      try {
        const full = await pluginHost.debugGrabScreen();
        const img = (await import("electron")).nativeImage.createFromBuffer(full);
        const cropped = pluginHost.debugCropRect({ x: 100, y: 50, width: 200, height: 100 }, full);
        const cimg = (await import("electron")).nativeImage.createFromBuffer(cropped);
        console.log("SHOT_TEST_OK full=" + img.getSize().width + "x" + img.getSize().height + " crop=" + cimg.getSize().width + "x" + cimg.getSize().height);
        const out = process.env.BOXKIT_SHOT_TEST;
        if (out && out !== "-") fs.writeFileSync(out, cropped);
        app.exit(0);
      } catch (err) {
        console.log("SHOT_TEST_FAIL", String(err));
        app.exit(1);
      }
    }, 2500);
    return;
  }
  showMainWindow();
  // BOXKIT_PANEL_SHOT=<png路径>：展示面板数秒后离屏截图并退出（UI 对照/CI 用）
  if (process.env.BOXKIT_PANEL_SHOT) {
    const out = process.env.BOXKIT_PANEL_SHOT;
    setTimeout(async () => {
      try {
        const w = getMainWindow();
        if (!w) return app.exit(1);
        const img = await w.webContents.capturePage();
        fs.writeFileSync(out, img.toPNG());
        console.log("PANEL_SHOT_OK", out);
      } catch (e) {
        logger.error("boot", "面板截图失败", e);
        app.exit(1);
      }
      app.exit(0);
    }, 3500);
    return;
  }
  // 冷启动参数可能带 .bkx（双击安装）；等主窗就绪后再提示
  const bkxArg = process.argv.slice(1).find((a) => /\.bkx$/i.test(a));
  if (bkxArg) setTimeout(() => handleBkxPath(bkxArg), 800);
}

/** BOXKIT_SMOKE=1：初始化完成后自检并退出（CI / 快速验证用） */
function smokeCheck(): void {
  setTimeout(() => {
    const apps = appProvider.getApps().length;
    const plugins = pluginManager.all().map((p) => p.manifest.name);
    const mainWin = getMainWindow();
    const diag = {
      ok: mainWin !== null && apps > 0,
      apps,
      plugins,
      mainWindow: mainWin !== null,
      hotkey: settings.get().hotkey,
      platform: `${process.platform}/${process.arch}`,
      version: app.getVersion(),
    };
    console.log(`BOXKIT_SMOKE_OK ${JSON.stringify(diag)}`);
    app.quit();
  }, 2500);
}
