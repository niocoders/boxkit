import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(appRoot, "../..");

export default defineConfig({
  root: path.join(appRoot, "src/renderer"),
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@boxkit/shared": path.join(repoRoot, "packages/shared/src/index.ts"),
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
});
