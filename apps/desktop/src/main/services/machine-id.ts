import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { machineIdPath } from "../core/paths.js";

/**
 * 稳定设备指纹，用于 License 设备绑定。
 * macOS: IOPlatformUUID；Windows: MachineGuid；Linux: /etc/machine-id。
 * 拿不到时退化为本地随机持久化 ID（重装系统会变化，可接受）。
 */
export function readPlatformMachineId(): string | null {
  try {
    switch (process.platform) {
      case "darwin": {
        const out = execSync("ioreg -rd1 -c IOPlatformExpertDevice", { encoding: "utf-8", timeout: 3000 });
        const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
        return m ? m[1] : null;
      }
      case "win32": {
        const out = execSync(
          "reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid",
          { encoding: "utf-8", timeout: 3000 },
        );
        const m = out.match(/MachineGuid\s+REG_SZ\s+([^\s]+)/);
        return m ? m[1] : null;
      }
      case "linux": {
        for (const p of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
          try {
            const v = fs.readFileSync(p, "utf-8").trim();
            if (v) return v;
          } catch {
            /* try next */
          }
        }
        return null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

let cached: string | null = null;

export function getMachineId(): string {
  if (cached) return cached;
  const fromPlatform = readPlatformMachineId();
  if (fromPlatform) {
    cached = fromPlatform;
    return cached;
  }
  // 回退：本地随机 ID 持久化
  try {
    const existing = fs.readFileSync(machineIdPath(), "utf-8").trim();
    if (existing) {
      cached = existing;
      return cached;
    }
    const generated = crypto.randomUUID();
    fs.mkdirSync(path.dirname(machineIdPath()), { recursive: true });
    fs.writeFileSync(machineIdPath(), generated);
    cached = generated;
    return cached;
  } catch {
    cached = "unknown-device";
    return cached;
  }
}
