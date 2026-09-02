import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolsDir, "..");
const desktopRoot = path.join(repoRoot, "apps", "desktop");
const electronPackage = path.join(desktopRoot, "node_modules", "electron");
const electronCli = path.join(electronPackage, "cli.js");
const electronPath = require(electronPackage);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "boxkit-ui-"));
const artifactDir = path.join(repoRoot, "artifacts", "electron-ui");
const port = 9237;
let child;
let browser;

function fail(message) {
  throw new Error(message);
}

async function waitForEndpoint(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return response.json();
    } catch {
      // Electron is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail("Electron remote debugging endpoint did not start");
}

async function findPage(predicate, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = browser.contexts().flatMap((context) => context.pages()).find(predicate);
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail("Expected Electron renderer page was not found");
}

async function waitForText(page, text, timeout = 15000) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
}

async function main() {
  fs.mkdirSync(artifactDir, { recursive: true });
  child = spawn(electronPath, [".", "--no-sandbox", `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], {
    cwd: desktopRoot,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const childOutput = [];
  child.stdout.on("data", (chunk) => childOutput.push(String(chunk)));
  child.stderr.on("data", (chunk) => childOutput.push(String(chunk)));

  const endpoint = await waitForEndpoint();
  browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
  const search = await findPage((page) => page.url().includes("/renderer/search/index.html"));
  await search.waitForLoadState("domcontentloaded");
  await search.locator("input.input").waitFor({ state: "visible" });

  const searchSize = await search.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  if (searchSize.width < 760 || searchSize.height < 400) fail(`Unexpected search viewport: ${JSON.stringify(searchSize)}`);
  await search.screenshot({ path: path.join(artifactDir, "search.png") });

  const input = search.locator("input.input");
  await input.fill("设置");
  await waitForText(search, "BoxKit 设置");
  await input.press("ArrowDown");
  if (await search.locator(".r-item.active").count() < 1) fail("Keyboard navigation did not select a result");

  await input.fill("");
  await waitForText(search, "插件应用市场");
  const marketItem = search.locator(".g-item", { hasText: "插件应用市场" }).first();
  await marketItem.click();

  const settings = await findPage((page) => page.url().includes("/renderer/settings/index.html"));
  await settings.waitForLoadState("domcontentloaded");
  await waitForText(settings, "插件");
  await waitForText(settings, "插件市场");
  const settingsSize = await settings.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  if (settingsSize.width < 700 || settingsSize.height < 500) fail(`Unexpected settings viewport: ${JSON.stringify(settingsSize)}`);
  if (await settings.getByRole("button", { name: "插件市场", exact: true }).count() < 1) fail("Market segment was not selected on first open");
  await settings.screenshot({ path: path.join(artifactDir, "market.png") });

  await settings.getByRole("button", { name: /已安装/ }).click();
  await waitForText(settings, "尚未安装任何插件");
  if (await settings.getByRole("button", { name: /安装插件包/ }).count() < 1) fail("Local package install control is missing");
  if (await settings.getByRole("button", { name: "添加开发目录", exact: true }).count() < 1) fail("Development directory control is missing");

  await settings.getByRole("button", { name: /通用/ }).click();
  const clipboardSwitch = settings.getByRole("switch", { name: "剪贴板历史", exact: true });
  await clipboardSwitch.waitFor({ state: "visible" });
  const before = await clipboardSwitch.getAttribute("aria-checked");
  await clipboardSwitch.click();
  await settings.waitForFunction((expected) => {
    return document.querySelector('[role="switch"][aria-label="剪贴板历史"]')?.getAttribute("aria-checked") !== expected;
  }, before, { timeout: 5000 });
  const after = await clipboardSwitch.getAttribute("aria-checked");
  if (before === after) fail("Clipboard history switch did not change state");
  await clipboardSwitch.click();
  await settings.waitForFunction((expected) => {
    return document.querySelector('[role="switch"][aria-label="剪贴板历史"]')?.getAttribute("aria-checked") === expected;
  }, before, { timeout: 5000 });

  const report = {
    ok: true,
    searchSize,
    settingsSize,
    searchUrl: search.url(),
    settingsUrl: settings.url(),
    screenshots: ["artifacts/electron-ui/search.png", "artifacts/electron-ui/market.png"],
    childOutput: childOutput.join("").split(/\r?\n/).filter(Boolean).slice(-20),
  };
  fs.writeFileSync(path.join(artifactDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(`ELECTRON_UI_SMOKE_OK ${JSON.stringify(report)}`);
}

try {
  await main();
} catch (error) {
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, "failure.log"), String(error?.stack ?? error));
  console.error(`ELECTRON_UI_SMOKE_FAIL ${String(error?.message ?? error)}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  if (child && child.pid) {
    try {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      child.kill();
    }
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.rmSync(userData, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}
