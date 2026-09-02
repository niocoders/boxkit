import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const ignoredDirs = new Set(["node_modules", ".git", ".zcode", "dist", "release", "out"]);
const allowedCompat = new Set([
  "apps/desktop/src/main/plugins/host.ts",
  "apps/desktop/src/preload/plugin.ts",
  "packages/sdk/src/index.ts",
  "packages/shared/src/manifest.ts",
  "packages/shared/src/manifest.test.ts",
  "packages/shared/src/ipc.ts",
  "packages/shared/src/types.ts",
  "NOTICE",
]);
const forbidden = [
  /Proprietary Software/i,
  /license-cli/i,
  /tools[\\/]license-cli/i,
  /\.gh-token/i,
  /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/,
];
const compatibility = new RegExp(["u", "tools"].join(""), "i");

function files(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...files(full));
    else if (entry.isFile() && /\.(md|json|ts|tsx|mjs|yml|yaml|css|html)$/.test(entry.name)) result.push(full);
  }
  return result;
}

const failures = [];
for (const file of files(root)) {
  const rel = path.relative(root, file);
  const normalized = rel.split(path.sep).join("/");
  if (normalized === "tools/audit-governance.mjs") continue;
  const text = fs.readFileSync(file, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(text)) failures.push(`${normalized}: forbidden pattern ${pattern}`);
  }
  if (compatibility.test(text) && !allowedCompat.has(normalized)) {
    failures.push(`${normalized}: compatibility name must stay in adapter/legal files`);
  }
}
if (!/^MIT License\s/m.test(fs.readFileSync(path.join(root, "LICENSE"), "utf8"))) failures.push("LICENSE: MIT header missing");
for (const required of ["NOTICE", "CONTRIBUTING.md", "SECURITY.md", "docs/third-party-licenses.md"]) {
  if (!fs.existsSync(path.join(root, required))) failures.push(`${required}: required governance file missing`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("governance audit passed");
