import { spawn } from "node:child_process";

const steps = [
  ["typecheck", ["typecheck"]],
  ["unit tests", ["test"]],
  ["sdk build", ["build:sdk"]],
  ["desktop build", ["build"]],
  ["ui smoke", ["ui:smoke"]],
  ["plugin compatibility smoke", ["compat:smoke"]],
];

function run(label, args) {
  return new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
    const commandArgs = process.platform === "win32"
      ? ["/d", "/s", "/c", `pnpm.cmd run ${args.join(" ")}`]
      : ["run", ...args];
    const child = spawn(command, commandArgs, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed${signal ? ` (${signal})` : ` with exit code ${code}`}`));
    });
  });
}

for (const [label, args] of steps) {
  console.log(`\n[verify] ${label}`);
  await run(label, args);
}
console.log("\n[verify] all checks passed");
