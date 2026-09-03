import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolsDir, "..");
const desktopRoot = path.join(repoRoot, "apps", "desktop");
const fixtureRoot = path.join(repoRoot, "tests", "fixtures", "compat-plugin");
const artifactDir = path.join(repoRoot, "artifacts", "electron-compat");
const reportPath = path.join(artifactDir, "report.json");
const electronModule = require.resolve("electron", { paths: [repoRoot] });
const electronPath = require(electronModule);

let userData;
let child;
let browser;
let search;
let plugin;
const childOutput = [];

const report = {
  ok: false,
  platform: `${process.platform}/${process.arch}`,
  capabilities: {},
  skipped: [
    {
      capability: "native file dialogs",
      reason: "明确跳过：showOpenDialog/showSaveDialog 会阻塞 CDP，并需要 OS 原生选择器交互。",
    },
    {
      capability: "screen capture selection modal",
      reason: "明确跳过：screenCapture 会打开桌面覆盖层，结果依赖 OS 桌面合成与人工拖拽。",
    },
    {
      capability: "exit viewport restoration",
      reason: "明确跳过：当前 Electron/CDP 下插件调整主窗高度后，退出事件与主页面 viewport 更新不同步；退出事件本身仍单独验收。",
    },
  ],
  screenshots: [],
};

function mark(name, status, detail) {
  report.capabilities[name] = { status, ...(detail === undefined ? {} : { detail }) };
}

function fail(message) {
  throw new Error(message);
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForEndpoint(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return response.json();
    } catch {
      // Electron is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  fail("Electron remote debugging endpoint did not start");
}

function pages() {
  return browser?.contexts().flatMap((context) => context.pages()) ?? [];
}

async function findPage(predicate, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = pages().find(predicate);
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  fail("Expected Electron renderer page was not found");
}

async function waitForCapability(page, name, timeoutMs = 15000) {
  const locator = page.locator(`[data-capability="${name}"]`);
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await locator.getAttribute("data-status") === "pass") return;
    const status = await locator.getAttribute("data-status");
    if (status === "fail") fail(`Fixture capability failed: ${name}: ${await locator.textContent()}`);
    await page.waitForTimeout(100);
  }
  fail(`Fixture capability timed out: ${name}`);
}

async function result(page, name) {
  return page.locator(`[data-capability="${name}"]`).evaluate((el) => ({
    status: el.getAttribute("data-status"),
    text: el.textContent,
  }));
}

async function waitForSearchMode(page) {
  await page.waitForFunction(() => !document.querySelector(".p-name"), undefined, { timeout: 15000 });
  await page.locator("input.input").waitFor({ state: "visible" });
}

function prepareUserData() {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "boxkit-compat-"));
  const pluginDir = path.join(userData, "plugins", "compat-fixture");
  fs.mkdirSync(path.dirname(pluginDir), { recursive: true });
  fs.cpSync(fixtureRoot, pluginDir, { recursive: true });
  fs.mkdirSync(path.join(userData, "plugin-data"), { recursive: true });
  fs.mkdirSync(path.join(userData, "plugin-staging"), { recursive: true });
  fs.mkdirSync(path.join(userData, "logs"), { recursive: true });
  fs.writeFileSync(path.join(userData, "config.json"), JSON.stringify({
    hotkey: "Alt+Space",
    autostart: false,
    sentryEnabled: false,
    updateFeed: null,
    firstLaunchAt: Date.now(),
    disabledPlugins: [],
    devPluginPaths: [],
    marketUrl: null,
    pinnedIds: [],
    clipboardHistoryEnabled: false,
    clipboardHistoryLimit: 50,
  }, null, 2));
}

function ensureBuild() {
  const required = [
    path.join(desktopRoot, "dist", "main", "index.js"),
    path.join(desktopRoot, "dist", "preload", "main.js"),
    path.join(desktopRoot, "dist", "preload", "plugin.js"),
    path.join(desktopRoot, "dist", "renderer", "search", "index.html"),
  ];
  if (required.every((file) => fs.existsSync(file))) return;
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const build = spawnSync(command, ["--filter", "@boxkit/desktop", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
    windowsHide: true,
  });
  if (build.status !== 0) fail(`Desktop build failed with exit code ${build.status}`);
}

async function terminateChild() {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("error", resolve);
      killer.once("close", resolve);
    });
  } else {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once("close", resolve);
    });
  }
  child = null;
}

function cleanupUserData() {
  if (!userData) return;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(userData, { recursive: true, force: true });
      if (!fs.existsSync(userData)) break;
    } catch {
      // Windows may release renderer files shortly after taskkill.
    }
    const start = Date.now();
    while (Date.now() - start < 250) {}
  }
}

async function main() {
  fs.rmSync(artifactDir, { recursive: true, force: true });
  fs.mkdirSync(artifactDir, { recursive: true });
  ensureBuild();
  prepareUserData();
  const port = await freePort();

  child = spawn(electronPath, [
    ".",
    "--no-sandbox",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`,
  ], {
    cwd: desktopRoot,
    env: { ...process.env, BOXKIT_PLUGIN_DEVTOOLS: "0" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => childOutput.push(String(chunk)));
  child.stderr.on("data", (chunk) => childOutput.push(String(chunk)));

  const endpoint = await waitForEndpoint(port);
  browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
  search = await findPage((page) => page.url().includes("/renderer/search/index.html"));
  await search.waitForLoadState("domcontentloaded");
  await search.locator("input.input").waitFor({ state: "visible" });

  const searchSize = await search.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  if (searchSize.width < 760 || searchSize.height < 300) fail(`Unexpected search viewport: ${JSON.stringify(searchSize)}`);
  mark("主搜索页", "passed", searchSize);
  await search.screenshot({ path: path.join(artifactDir, "search.png") });
  report.screenshots.push("artifacts/electron-compat/search.png");

  const input = search.locator("input.input");
  await input.fill("compat-fixture");
  const feature = search.locator(".r-item", { hasText: "bk/legacy 兼容验收" }).first();
  await feature.waitFor({ state: "visible", timeout: 15000 });
  await feature.click();
  await search.locator(".p-name").filter({ hasText: "bk/legacy 兼容 Fixture" }).waitFor({ state: "visible", timeout: 15000 });
  mark("插件模式", "passed");

  plugin = await findPage((page) => page.url().startsWith("bk-plugin://compat-fixture/"));
  await plugin.waitForLoadState("domcontentloaded");
  await waitForCapability(plugin, "run-status");

  const enter = await result(plugin, "enter-payload");
  if (enter.status !== "pass" || !enter.text?.includes('"code":"compat"') || !enter.text?.includes('"type":"over"') || !enter.text?.includes('"payload":"compat-fixture"')) {
    fail(`Unexpected onPluginEnter result: ${JSON.stringify(enter)}`);
  }
  mark("onPluginEnter payload", "passed", enter.text);

  const placeholder = await input.getAttribute("placeholder");
  if (placeholder !== "输入兼容测试文本") fail(`Unexpected sub-input placeholder: ${placeholder}`);
  const subinputConfig = await result(plugin, "subinput-config");
  if (subinputConfig.status !== "pass") fail(`setSubInput did not pass: ${JSON.stringify(subinputConfig)}`);
  mark("setSubInput", "passed", { placeholder });

  await input.fill("cdp-subinput-value");
  await waitForCapability(plugin, "subinput-change");
  const subinputChange = await result(plugin, "subinput-change");
  if (!subinputChange.text?.includes("cdp-subinput-value")) fail(`Unexpected sub-input value: ${JSON.stringify(subinputChange)}`);
  mark("onSubInputChange", "passed", subinputChange.text);

  for (const capability of ["kv", "doc", "clipboard", "display", "permission-reject"]) {
    await waitForCapability(plugin, capability);
    const detail = await result(plugin, capability);
    mark(capability, "passed", detail.text);
  }

  await waitForCapability(plugin, "redirect-return");
  const redirect = await result(plugin, "redirect-return");
  await waitForCapability(plugin, "redirect-enter");
  const redirectEnter = await result(plugin, "redirect-enter");
  if (!redirect.text?.includes('"returned":true') || redirectEnter.status !== "pass" || !redirectEnter.text?.includes("redirect-payload")) {
    fail(`Unexpected redirect result: ${JSON.stringify({ redirect, redirectEnter })}`);
  }
  mark("redirect 返回", "passed", { redirect: redirect.text, enter: redirectEnter.text });

  const beforeResize = await plugin.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const resizeReturn = await plugin.evaluate(() => window.__compatResize());
  if (resizeReturn !== true) fail(`setExpendHeight returned ${String(resizeReturn)}`);
  await plugin.waitForFunction((previousHeight) => innerHeight > previousHeight + 100, beforeResize.height, { timeout: 10000 });
  const afterResize = await plugin.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await waitForCapability(plugin, "window-resize");
  mark("窗口尺寸变化", "passed", { before: beforeResize, after: afterResize });

  await plugin.screenshot({ path: path.join(artifactDir, "plugin.png") });
  report.screenshots.push("artifacts/electron-compat/plugin.png");

  await plugin.evaluate(() => window.utools.outPlugin());
  await waitForSearchMode(search);
  await waitForCapability(plugin, "out-event");
  const outEvent = await result(plugin, "out-event");
  mark("退出事件", "passed", outEvent.text);
  const restoredMode = await search.evaluate(() => ({
    placeholder: document.querySelector("input.input")?.getAttribute("placeholder"),
    pluginHeader: Boolean(document.querySelector(".p-name")),
  }));
  if (restoredMode.pluginHeader || restoredMode.placeholder !== "搜索功能 / 粘贴文件、图片") {
    fail(`Search mode was not restored: ${JSON.stringify(restoredMode)}`);
  }
  mark("退出后恢复搜索页", "passed", { mode: restoredMode, viewport: await search.evaluate(() => ({ width: innerWidth, height: innerHeight })) });
  await search.screenshot({ path: path.join(artifactDir, "exit.png") });
  report.screenshots.push("artifacts/electron-compat/exit.png");

  report.ok = true;
}

try {
  await main();
} catch (error) {
  report.error = String(error?.stack ?? error);
  const currentPage = plugin ?? search;
  if (currentPage) {
    try {
      const filename = plugin ? "failure-plugin.png" : "failure-search.png";
      await currentPage.screenshot({ path: path.join(artifactDir, filename) });
      report.screenshots.push(`artifacts/electron-compat/${filename}`);
    } catch {
      // The renderer may already have gone away.
    }
  }
  process.exitCode = 1;
} finally {
  report.childOutput = childOutput.join("").split(/\r?\n/).filter(Boolean).slice(-40);
  await browser?.close().catch(() => {});
  await terminateChild();
  cleanupUserData();
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  if (report.ok) console.log(`ELECTRON_COMPAT_SMOKE_OK ${JSON.stringify(report)}`);
  else console.error(`ELECTRON_COMPAT_SMOKE_FAIL ${report.error ?? "unknown failure"}`);
}
