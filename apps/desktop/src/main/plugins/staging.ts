import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { safeParseManifest, isSafePluginPath, type PluginManifest } from "@boxkit/shared";
import { pluginsDir, stagingDir } from "../core/paths.js";
import { logger } from "../core/logger.js";

const execFileP = promisify(execFile);
const STAGING_ID = /^s-[a-z0-9]+-[a-z0-9]{6}$/i;

export function isValidStagingId(value: unknown): value is string {
  return typeof value === "string" && STAGING_ID.test(value);
}

function safeStagingId(value: unknown): string {
  const id = String(value ?? "");
  if (!isValidStagingId(id)) throw new Error("暂存标识无效");
  const root = path.resolve(stagingDir());
  const full = path.resolve(root, id);
  if (!full.startsWith(root + path.sep)) throw new Error("暂存路径越界");
  return id;
}

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

function within(root: string, resource: string): string {
  if (!isSafePluginPath(resource)) throw new Error(`资源路径不安全: ${resource}`);
  const full = path.resolve(root, resource);
  const base = path.resolve(root);
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error(`资源路径越过插件根目录: ${resource}`);
  }
  return full;
}

/** 在交给平台解压器前检查 zip central directory，防止 zip-slip。 */
function validateZipEntries(src: string): void {
  const data = fs.readFileSync(src);
  const eocd = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const end = data.lastIndexOf(eocd);
  if (end < 0 || end + 22 > data.length) throw new Error("插件包不是有效的 zip 文件");
  const count = data.readUInt16LE(end + 10);
  const offset = data.readUInt32LE(end + 16);
  const cd = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let pos = offset;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > data.length || data.subarray(pos, pos + 4).compare(cd) !== 0) {
      throw new Error("插件包目录损坏");
    }
    const nameLen = data.readUInt16LE(pos + 28);
    const extraLen = data.readUInt16LE(pos + 30);
    const commentLen = data.readUInt16LE(pos + 32);
    const rawName = data.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");
    const name = rawName.replace(/\\/g, "/").replace(/\/+$/, "");
    if (name && !isSafePluginPath(name)) throw new Error(`插件包包含不安全路径: ${rawName}`);
    pos += 46 + nameLen + extraLen + commentLen;
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
  validateZipEntries(src);
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
  if (!/\.(bkx|zip|upx)$/i.test(filePath)) {
    throw new Error("仅支持 .bkx / .zip / .upx 插件包");
  }
  const stagingId = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpRoot = path.join(stagingDir(), `${stagingId}.tmp`);
  const tmpExtract = path.join(tmpRoot, "__raw__");
  const finalDir = path.join(stagingDir(), stagingId);
  try {
    await extractArchive(filePath, tmpExtract);

    // 定位清单：包根目录或唯一子目录
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
    const mainPath = within(root, manifest.main);
    if (!fs.existsSync(mainPath)) throw new Error(`入口文件 ${manifest.main} 不存在`);
    if (manifest.preload && !fs.existsSync(within(root, manifest.preload))) {
      throw new Error(`清单声明了 preload(${manifest.preload}) 但文件不存在`);
    }
    if (manifest.logo) within(root, manifest.logo);

    // 只把已校验的插件根复制到正式 staging 目录，避免临时目录和 __raw__ 混入安装包。
    fs.rmSync(finalDir, { recursive: true, force: true });
    fs.mkdirSync(finalDir, { recursive: true });
    fs.cpSync(root, finalDir, { recursive: true });
    fs.rmSync(tmpRoot, { recursive: true, force: true });

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
      logoDataUrl: logoToDataUrl(manifest.logo ? within(finalDir, manifest.logo) : undefined),
      conflict,
    };
  } catch (error) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(finalDir, { recursive: true, force: true });
    throw error;
  }
}

/** 用户确认后：把暂存目录正式落入 plugins/ */
export async function commitInstall(stagingId: string): Promise<PluginManifest> {
  const staged = path.join(stagingDir(), safeStagingId(stagingId));
  const manifest = readManifest(staged);
  if (!manifest) throw new Error("暂存目录无效或已被清理");
  const dest = path.join(pluginsDir(), manifest.name);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(pluginsDir(), { recursive: true });
  fs.renameSync(staged, dest);
  return manifest;
}

/** 用户取消确认时删除对应暂存目录。只接受 stageInstall 生成的 ID。 */
export function discardInstall(stagingId: string): void {
  try {
    fs.rmSync(path.join(stagingDir(), safeStagingId(stagingId)), { recursive: true, force: true });
  } catch {
    /* invalid or already removed staging IDs are treated as cancelled */
  }
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
