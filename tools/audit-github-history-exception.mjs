import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const documentPath = path.join(root, "docs", "github-history-exception.md");
const text = fs.readFileSync(documentPath, "utf8");
const failures = [];

const requiredPhrases = [
  "refs/pull/1/head",
  "refs/pull/* is read-only",
  "HTTP 422",
  "旧 blob",
  "force-push",
  "当前公开树与路径历史",
  "撤销",
  "轮换",
  "不要复用旧密钥",
  "GitHub Support",
  "git fsck --full --no-reflogs --unreachable",
];
for (const phrase of requiredPhrases) {
  if (!text.includes(phrase)) failures.push(`missing required phrase: ${phrase}`);
}

const forbiddenPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:ghp|github_pat|github|glpat|xox[baprs])-[-_A-Za-z0-9]{12,}/i,
  /(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*[^`\s)]+/i,
  /[A-Za-z]:\\(?:Users|Documents|Desktop|Workspace|workspace)\\/i,
];
for (const pattern of forbiddenPatterns) {
  if (pattern.test(text)) failures.push(`forbidden document pattern: ${pattern}`);
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

for (const ref of ["refs/heads/main", "refs/heads/open-source/launcher-parity", "refs/tags/v1.0.0"]) {
  try {
    git(["show-ref", "--verify", "--quiet", ref]);
  } catch {
    failures.push(`missing local ref: ${ref}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("github history exception audit passed");
