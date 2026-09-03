import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = path.resolve(packageDir, "../..");
const source = path.join(packageDir, "src", "index.ts");
const distDir = path.join(packageDir, "dist");
const tsc = path.join(repoDir, "node_modules", "typescript", "bin", "tsc");

const commonArgs = [
  source,
  "--target", "ES2022",
  "--lib", "ES2022,DOM,DOM.Iterable",
  "--rootDir", path.join(packageDir, "src"),
  "--strict",
  "--skipLibCheck",
  "--isolatedModules",
  "--esModuleInterop",
  "--forceConsistentCasingInFileNames",
  "--useDefineForClassFields",
  "--declarationMap", "false",
  "--sourceMap", "false",
];

function runTsc(args) {
  execFileSync(process.execPath, [tsc, ...commonArgs, ...args], {
    cwd: packageDir,
    stdio: "inherit",
  });
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

runTsc([
  "--module", "ESNext",
  "--moduleResolution", "Bundler",
  "--outDir", path.join(distDir, "esm"),
]);

runTsc([
  "--module", "CommonJS",
  "--moduleResolution", "Node",
  "--outDir", path.join(distDir, "cjs"),
]);

runTsc([
  "--module", "ESNext",
  "--moduleResolution", "Bundler",
  "--declaration",
  "--emitDeclarationOnly",
  "--outDir", path.join(distDir, "types"),
]);

// The package root is ESM, so mark only the CommonJS subtree explicitly.
writeFileSync(
  path.join(distDir, "cjs", "package.json"),
  `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
);

console.log("@boxkit/sdk: generated dist/esm, dist/cjs and dist/types");
