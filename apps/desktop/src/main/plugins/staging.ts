import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { safeParseManifest, type PluginManifest } from "@boxkit/shared";
import { pluginsDir, stagingDir } from "../core/paths.js";
import { logger } from "../core/logger.js";

const execFileP = promisify(execFile);

export interface StagedPlugin {
  stagingId: string;
  dir: string;
  manifest: PluginManifest;
  logoDataUrl?: string;
  conflict: "none" | "same-version" | "upgrade";
}

function readManifest(dir: string): PluginManifest | null {
  try {
    const raw = fs.readFileSync(path.join(dir, "plugin.json"), "utf-8");
    const parsed = safeParseManifest(JSON.parse(raw));
    if (!parsed.ok) {
      logger.warn("staging", `${dir} 清单无效: ${parsed.error}`);
      return null;
    }
    return parsed.manifest;
  } catch {
    return null;
  }
}

export function logoToDataUrl(file: string | undefined): string | undefined {
  if (!file) return undefined;
  try {
    const full = path.resolve(file);
    const ext = path.extname(full).toLowerCase();
    const mime =
      ext === ".png"
        ? "image/png"
        : ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".svg"
            ? "image/svg+xml"
            : ext === ".webp"
              ? "image/webp"
              : ext === ".gif"
                ? "image/gif"
                : null;
    if (!mime) return undefined;
    return `data:${mime};base64,${fs.readFileSync(full).toString("base64")}`;
  } catch {
    return undefined;
  }
}

/** 跨平台解压 zip/.bkx（.bkx 即 zip 包） */
async function extractArchive(src: string, dest: string): Promise<void> {
  fs.mkdirSync(dest, { recursive: true });
  if (process.platform === "win32") {
    // Win10 内置 tar 的 zip 支持实测不可靠 → 用 PowerShell Expand-Archive（要求 .zip 后缀）
    const zipCopy = path.join(dest, "__pkg.zip");
    fs.copyFileSync(src, zipCopy);
    const psPath = (v: string) => v.replace(/'/g, "''");
    try {
      await execFileP(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
         `Expand-Archive -LiteralPath '${psPath(zipCopy)}' -DestinationPath '${psPath(dest)}' -Force`],
        { timeout: 30000, windowsHide: true },
      );
    } finally {
      fs.rmSync(zipCopy, { force: true });
    }
  } else if (process.platform === "darwin") {
    await execFileP("ditto", ["-x", "-k", src, dest]);
  } else {
    await execFileP("unzip", ["-o", "-q", src, "-d", dest]);
  }
}

/** 解压并校验插件包，返回暂存信息（不正式安装）。 */
export async function stageInstall(
  filePath: string,
  installedVersions: Map<string, string>,
): Promise<StagedPlugin> {
  if (!/\.(bkx|zip)$/i.test(filePath)) {
    throw new Error("仅支持 .bkx / .zip 插件包");
  }
  const stagingId = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpExtract = path.join(stagingDir(), stagingId, "__raw__");
  await extractArchive(filePath, tmpExtract);

  // 定位清单：包根目录 或 唯一子目录
  let root = tmpExtract;
  if (!readManifest(root)) {
    const children = fs
      .readdirSync(tmpExtract, { withFileTypes: true })
      .filter((d) => d.isDirectory());
    const candidates = children.map((c) => path.join(tmpExtract, c.name)).filter(readManifest);
    if (candidates.length !== 1) {
      throw new Error(
        candidates.length === 0
          ? "插件包中未找到有效的 plugin.json"
          : "插件包中存在多个含 plugin.json 的目录，无法定位",
      );
    }
    root = candidates[0];
  }
  const manifest = readManifest(root);
  if (!manifest) throw new Error("plugin.json 校验失败");
  if (manifest.preload && !fs.existsSync(path.join(root, manifest.preload))) {
    throw new Error(`清单声明了 preload(${manifest.preload}) 但文件不存在`);
  }
  if (!fs.existsSync(path.join(root, manifest.main))) {
    throw new Error(`入口文件 ${manifest.main} 不存在`);
  }

  // 归一化：把插件根目录内容移到 staging/<id>/ 下
  // Windows 上新写入目录可能被杀毒/索引短暂锁定 → rename 失败时退避重试，仍失败退化为递归复制
  const finalDir = path.join(stagingDir(), stagingId);
  let moved = false;
  for (let attempt = 0; attempt < 5 && !moved; attempt++) {
    try {
      fs.renameSync(root, finalDir);
      moved = true;
    } catch {
      const delay = 200 * (attempt + 1);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
    }
  }
  if (!moved) {
    fs.cpSync(root, finalDir, { recursive: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
  fs.rmSync(tmpExtract, { recursive: true, force: true });

  const installed = installedVersions.get(manifest.name);
  const conflict =
    installed === undefined
      ? "none"
      : installed === manifest.version
        ? "same-version"
        : "upgrade";

  return {
    stagingId,
    dir: finalDir,
    manifest,
    logoDataUrl: logoToDataUrl(manifest.logo ? path.join(finalDir, manifest.logo) : undefined),
    conflict,
  };
}

/** 用户确认后：把暂存目录正式落入 plugins/ */
export async function commitInstall(stagingId: string): Promise<PluginManifest> {
  const staged = path.join(stagingDir(), stagingId);
  const manifest = readManifest(staged);
  if (!manifest) throw new Error("暂存目录无效或已被清理");
  const dest = path.join(pluginsDir(), manifest.name);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(pluginsDir(), { recursive: true });
  fs.renameSync(staged, dest);
  return manifest;
}

export function cleanupStaging(): void {
  try {
    const base = stagingDir();
    for (const name of fs.readdirSync(base)) {
      fs.rmSync(path.join(base, name), { recursive: true, force: true });
    }
  } catch {
    /* ignore */
  }
}
