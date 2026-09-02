import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  resolve: {
    alias: {
      "@boxkit/shared": path.join(repoRoot, "packages/shared/src/index.ts"),
      "@boxkit/sdk": path.join(repoRoot, "packages/sdk/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    fileParallelism: false,
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.test.ts",
      "tools/**/*.test.ts",
    ],
  },
});
