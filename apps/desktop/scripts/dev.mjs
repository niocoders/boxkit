/**
 * 开发模式：esbuild watch(main/preload) + vite dev server + electron。
 * 主进程代码变更需重启 electron（Ctrl+C 后重跑）；渲染层支持 HMR。
 */
import { context } from "esbuild";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(root, "..");
const repoRoot = path.resolve(appRoot, "../..");

const esbCommon = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron"],
  sourcemap: true,
  logLevel: "silent",
  alias: {
    "@boxkit/shared": path.join(repoRoot, "packages/shared/src/index.ts"),
    "@boxkit/shared/ipc": path.join(repoRoot, "packages/shared/src/ipc.ts"),
    "@boxkit/sdk": path.join(repoRoot, "packages/sdk/src/index.ts"),
  },
};

const esbCtxs = await Promise.all([
  context({
    ...esbCommon,
    entryPoints: [path.join(appRoot, "src/main/index.ts")],
    outfile: path.join(appRoot, "dist/main/index.js"),
  }),
  context({
    ...esbCommon,
    entryPoints: [path.join(appRoot, "src/preload/main.ts")],
    outfile: path.join(appRoot, "dist/preload/main.js"),
  }),
  context({
    ...esbCommon,
    entryPoints: [path.join(appRoot, "src/preload/plugin.ts")],
    outfile: path.join(appRoot, "dist/preload/plugin.js"),
  }),
]);
await Promise.all(esbCtxs.map((c) => c.watch()));
console.log("[dev] esbuild watch 就绪");

const vite = await createServer({
  root: path.join(appRoot, "src/renderer"),
  base: "/",
  plugins: [react()],
  server: { port: 5173, strictPort: true },
});
await vite.listen();
const viteUrl = "http://localhost:5173";
console.log(`[dev] vite dev server → ${viteUrl}`);

let electronProc;
const startElectron = () => {
  electronProc = spawn(
    path.join(appRoot, "node_modules/.bin/electron"),
    [".", "--no-sandbox"],
    {
      cwd: appRoot,
      stdio: "inherit",
      env: { ...process.env, VITE_DEV_SERVER_URL: viteUrl, ELECTRON_ENABLE_LOGGING: "1" },
    },
  );
  electronProc.on("exit", async (code) => {
    console.log(`[dev] electron 退出 (code=${code})，关闭开发服务…`);
    await Promise.all(esbCtxs.map((c) => c.dispose()));
    await vite.close();
    process.exit(code ?? 0);
  });
};
startElectron();

process.on("SIGINT", () => {
  electronProc?.kill("SIGTERM");
});
