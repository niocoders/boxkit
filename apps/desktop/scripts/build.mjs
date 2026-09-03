import { build as viteBuild } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";

const root = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(root, "..");
const repoRoot = path.resolve(appRoot, "../..");

const esbAlias = {
  "@boxkit/shared": path.join(repoRoot, "packages/shared/src/index.ts"),
  "@boxkit/shared/ipc": path.join(repoRoot, "packages/shared/src/ipc.ts"),
  "@boxkit/shared/manifest": path.join(repoRoot, "packages/shared/src/manifest.ts"),
  "@boxkit/shared/types": path.join(repoRoot, "packages/shared/src/types.ts"),
  "@boxkit/sdk": path.join(repoRoot, "packages/sdk/src/index.ts"),
};

const esbCommon = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron"],
  sourcemap: "linked",
  logLevel: "info",
  minify: false,
  legalComments: "none",
  alias: esbAlias,
};

/** 主进程（依赖全部打包为单文件，仅 external electron） */
await build({
  ...esbCommon,
  entryPoints: [path.join(appRoot, "src/main/index.ts")],
  outfile: path.join(appRoot, "dist/main/index.js"),
});

/** 沙箱 preload：单文件、只依赖 electron 受限子集 */
for (const name of ["main", "plugin", "detach"]) {
  await build({
    ...esbCommon,
    entryPoints: [path.join(appRoot, `src/preload/${name}.ts`)],
    outfile: path.join(appRoot, `dist/preload/${name}.js`),
  });
}

/** 渲染层：search + settings 双入口 */
await viteBuild({
  root: path.join(appRoot, "src/renderer"),
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@boxkit/shared": path.join(repoRoot, "packages/shared/src/index.ts"),
      "@boxkit/shared/ipc": path.join(repoRoot, "packages/shared/src/ipc.ts"),
      "@boxkit/shared/manifest": path.join(repoRoot, "packages/shared/src/manifest.ts"),
      "@boxkit/shared/types": path.join(repoRoot, "packages/shared/src/types.ts"),
      "@boxkit/sdk": path.join(repoRoot, "packages/sdk/src/index.ts"),
    },
  },
  build: {
    outDir: path.join(appRoot, "dist/renderer"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        search: path.join(appRoot, "src/renderer/search/index.html"),
        settings: path.join(appRoot, "src/renderer/settings/index.html"),
        detach: path.join(appRoot, "src/renderer/detach/index.html"),
      },
    },
  },
  logLevel: "info",
});

console.log("\n[build] 全部完成 → apps/desktop/dist");
