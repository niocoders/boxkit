import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { isSafePluginPath, safeParseManifest, type PluginManifest } from "@boxkit/shared";
import { pluginsDir, stagingDir } from "../core/paths.js";
import { logger } from "../core/logger.js";

const STAGING_ID = /^s-[a-z0-9]+-[a-z0-9]{6}$/i;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;

/** 安装器的默认硬预算。数值集中在此处，测试可用小预算覆盖。 */
export const INSTALL_LIMITS = {
  maxArchiveBytes: 50 * 1024 * 1024,
  maxEntries: 4096,
  maxEntryBytes: 100 * 1024 * 1024,
  maxExpandedBytes: 250 * 1024 * 1024,
  maxPathBytes: 4096,
  maxCompressionRatio: 200,
  maxManifestBytes: 1024 * 1024,
  maxLogoBytes: 2 * 1024 * 1024,
} as const;

export type InstallLimits = { -readonly [K in keyof typeof INSTALL_LIMITS]?: number };

export interface StageInstallOptions {
  /** 供测试和调用方显式指定宿主环境；省略时使用当前进程。 */
  platform?: string;
  hostVersion?: string;
  limits?: InstallLimits;
}

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
  conflict: "none" | "same-version" | "upgrade" | "downgrade";
}

interface ZipEntry {
  name: string;
  isDirectory: boolean;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  compressionMethod: number;
  flags: number;
  crc32: number;
}

function limitsOf(overrides?: InstallLimits): { [K in keyof typeof INSTALL_LIMITS]: number } {
  const limits: { [K in keyof typeof INSTALL_LIMITS]: number } = { ...INSTALL_LIMITS, ...(overrides ?? {}) };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`安装预算无效: ${key}`);
  }
  return limits;
}

function readManifest(dir: string, maxBytes: number = INSTALL_LIMITS.maxManifestBytes): PluginManifest | null {
  try {
    const file = path.join(dir, "plugin.json");
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    const parsed = safeParseManifest(JSON.parse(fs.readFileSync(file, "utf-8")));
    if (!parsed.ok) {
      logger.warn("staging", `${dir} 清单无效: ${parsed.error}`);
      return null;
    }
    return parsed.manifest;
  } catch {
    return null;
  }
}

function within(root: string, resource: string, maxPathBytes: number = INSTALL_LIMITS.maxPathBytes): string {
  if (!isSafePluginPath(resource)) throw new Error(`资源路径不安全: ${resource}`);
  if (Buffer.byteLength(resource, "utf8") > maxPathBytes) throw new Error(`资源路径过长: ${resource}`);
  const full = path.resolve(root, resource);
  const base = path.resolve(root);
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error(`资源路径越过插件根目录: ${resource}`);
  return full;
}

function readAt(fd: number, position: number, length: number): Buffer {
  if (!Number.isSafeInteger(position) || !Number.isSafeInteger(length) || position < 0 || length < 0) {
    throw new Error("插件包偏移无效");
  }
  const out = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const read = fs.readSync(fd, out, offset, length - offset, position + offset);
    if (read <= 0) throw new Error("插件包数据不完整");
    offset += read;
  }
  return out;
}

function zipNameIsSafe(rawName: string, maxPathBytes: number): string {
  if (rawName.includes("\0")) throw new Error("插件包包含空字节路径");
  const name = rawName.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!name || !isSafePluginPath(name) || Buffer.byteLength(name, "utf8") > maxPathBytes) {
    throw new Error(`插件包包含不安全或过长路径: ${rawName}`);
  }
  if (name.split("/").some((part) => part === "." || part.includes(":") || /[\u0001-\u001f\u007f]/.test(part))) {
    throw new Error(`插件包包含不安全路径: ${rawName}`);
  }
  return name;
}

function unixEntryType(versionMadeBy: number, externalAttributes: number): number {
  const creator = versionMadeBy >>> 8;
  return creator === 3 ? (externalAttributes >>> 16) & 0xf000 : 0;
}

function validateEntryKind(rawName: string, versionMadeBy: number, externalAttributes: number): boolean {
  const unixType = unixEntryType(versionMadeBy, externalAttributes);
  if (unixType !== 0 && unixType !== 0x4000 && unixType !== 0x8000) {
    throw new Error(`插件包包含链接或特殊文件: ${rawName}`);
  }
  // Do not allow DOS device/reparse-like special attributes to reach extraction.
  if ((externalAttributes & 0x400) !== 0) throw new Error(`插件包包含特殊文件: ${rawName}`);
  return rawName.endsWith("/") || unixType === 0x4000 || (externalAttributes & 0x10) !== 0;
}

function findEndOfCentralDirectory(fd: number, archiveBytes: number): number {
  const tailLength = Math.min(archiveBytes, 22 + 0xffff);
  const tail = readAt(fd, archiveBytes - tailLength, tailLength);
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) !== ZIP_EOCD_SIGNATURE) continue;
    const commentLength = tail.readUInt16LE(i + 20);
    if (i + 22 + commentLength === tail.length) return archiveBytes - tailLength + i;
  }
  throw new Error("插件包不是有效的 zip 文件");
}

/**
 * 解析并校验 ZIP central directory。解压过程不会接触未经检查的条目，
 * 从而同时覆盖 zip-slip、ZIP64、链接/特殊文件、zip bomb 和超长路径。
 */
export function validateZipEntries(src: string, overrides?: InstallLimits): ZipEntry[] {
  const limits = limitsOf(overrides);
  const stat = fs.statSync(src);
  if (!stat.isFile()) throw new Error("插件包不是普通文件");
  if (stat.size <= 0 || stat.size > limits.maxArchiveBytes) {
    throw new Error(`插件包超过下载预算（最多 ${limits.maxArchiveBytes} 字节）`);
  }
  const fd = fs.openSync(src, "r");
  try {
    const eocd = findEndOfCentralDirectory(fd, stat.size);
    const footer = readAt(fd, eocd, 22);
    const disk = footer.readUInt16LE(4);
    const centralDisk = footer.readUInt16LE(6);
    const entriesOnDisk = footer.readUInt16LE(8);
    const entryCount = footer.readUInt16LE(10);
    const centralBytes = footer.readUInt32LE(12);
    const centralOffset = footer.readUInt32LE(16);
    if (
      disk !== 0 ||
      centralDisk !== 0 ||
      entriesOnDisk !== entryCount ||
      entryCount === 0xffff ||
      centralBytes === 0xffffffff ||
      centralOffset === 0xffffffff
    ) {
      throw new Error("不支持 ZIP64 或分卷插件包");
    }
    if (entryCount > limits.maxEntries || centralBytes > limits.maxArchiveBytes) {
      throw new Error(`插件包条目或目录超过预算（最多 ${limits.maxEntries} 项）`);
    }
    if (centralOffset + centralBytes > eocd || centralOffset + centralBytes > stat.size) {
      throw new Error("插件包目录范围无效");
    }
    const central = readAt(fd, centralOffset, centralBytes);
    const entries: ZipEntry[] = [];
    const seen = new Set<string>();
    let position = 0;
    let expanded = 0;
    while (entries.length < entryCount) {
      if (position + 46 > central.length || central.readUInt32LE(position) !== ZIP_CENTRAL_SIGNATURE) {
        throw new Error("插件包目录损坏");
      }
      const versionMadeBy = central.readUInt16LE(position + 4);
      const flags = central.readUInt16LE(position + 8);
      const method = central.readUInt16LE(position + 10);
      const crc32 = central.readUInt32LE(position + 16);
      const compressedSize = central.readUInt32LE(position + 20);
      const uncompressedSize = central.readUInt32LE(position + 24);
      const nameLength = central.readUInt16LE(position + 28);
      const extraLength = central.readUInt16LE(position + 30);
      const commentLength = central.readUInt16LE(position + 32);
      const externalAttributes = central.readUInt32LE(position + 38);
      const localHeaderOffset = central.readUInt32LE(position + 42);
      const recordLength = 46 + nameLength + extraLength + commentLength;
      if (position + recordLength > central.length) throw new Error("插件包目录损坏");
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
        throw new Error("不支持 ZIP64 条目");
      }
      const rawName = central.subarray(position + 46, position + 46 + nameLength).toString("utf8");
      const name = zipNameIsSafe(rawName, limits.maxPathBytes);
      const isDirectory = validateEntryKind(rawName, versionMadeBy, externalAttributes);
      const key = name.toLocaleLowerCase();
      if (seen.has(key)) throw new Error(`插件包包含重复路径: ${rawName}`);
      seen.add(key);
      if ((flags & 0x1) !== 0) throw new Error(`插件包包含加密条目: ${rawName}`);
      if (method !== 0 && method !== 8 && !isDirectory) throw new Error(`插件包使用不支持的压缩方式: ${rawName}`);
      if (uncompressedSize > limits.maxEntryBytes) throw new Error(`插件包条目超过大小预算: ${rawName}`);
      if (!isDirectory) {
        expanded += uncompressedSize;
        if (expanded > limits.maxExpandedBytes) throw new Error("插件包展开后超过大小预算");
        if (compressedSize === 0 && uncompressedSize > 0) throw new Error(`插件包条目压缩数据无效: ${rawName}`);
        if (compressedSize > 0 && uncompressedSize / compressedSize > limits.maxCompressionRatio) {
          throw new Error(`插件包压缩比超过预算: ${rawName}`);
        }
      }
      if (localHeaderOffset + 30 > stat.size || localHeaderOffset >= centralOffset) throw new Error(`插件包条目偏移无效: ${rawName}`);
      if (localHeaderOffset + 30 + compressedSize > centralOffset) throw new Error(`插件包条目数据范围无效: ${rawName}`);
      entries.push({ name, isDirectory, compressedSize, uncompressedSize, localHeaderOffset, compressionMethod: method, flags, crc32 });
      position += recordLength;
    }
    if (position !== central.length) throw new Error("插件包目录包含额外数据");
    return entries;
  } finally {
    fs.closeSync(fd);
  }
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function extractArchive(src: string, dest: string, overrides?: InstallLimits): void {
  const limits = limitsOf(overrides);
  const entries = validateZipEntries(src, limits);
  const stat = fs.statSync(src);
  const fd = fs.openSync(src, "r");
  try {
    fs.mkdirSync(dest, { recursive: true });
    let writtenTotal = 0;
    for (const entry of entries) {
      const header = readAt(fd, entry.localHeaderOffset, 30);
      if (header.readUInt32LE(0) !== ZIP_LOCAL_SIGNATURE) throw new Error(`插件包本地条目损坏: ${entry.name}`);
      const localFlags = header.readUInt16LE(6);
      const localMethod = header.readUInt16LE(8);
      const nameLength = header.readUInt16LE(26);
      const extraLength = header.readUInt16LE(28);
      const localName = readAt(fd, entry.localHeaderOffset + 30, nameLength).toString("utf8").replace(/\\/g, "/");
      if (localFlags !== entry.flags || localMethod !== entry.compressionMethod || zipNameIsSafe(localName, limits.maxPathBytes) !== entry.name) {
        throw new Error(`插件包本地条目与目录不一致: ${entry.name}`);
      }
      const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
      const compressed = readAt(fd, dataStart, entry.compressedSize);
      const target = path.resolve(dest, entry.name);
      const base = path.resolve(dest);
      if (target !== base && !target.startsWith(base + path.sep)) throw new Error(`插件包路径越界: ${entry.name}`);
      if (entry.isDirectory) {
        fs.mkdirSync(target, { recursive: true });
        continue;
      }
      let output: Buffer;
      try {
        output = entry.compressionMethod === 0 ? compressed : inflateRawSync(compressed);
      } catch {
        throw new Error(`插件包条目解压失败: ${entry.name}`);
      }
      if (output.length !== entry.uncompressedSize || crc32(output) !== entry.crc32) throw new Error(`插件包展开内容校验失败: ${entry.name}`);
      writtenTotal += output.length;
      if (writtenTotal > limits.maxExpandedBytes) throw new Error("插件包展开后超过大小预算");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, output, { mode: 0o644, flag: "wx" });
    }
    if (fs.statSync(src).size !== stat.size) throw new Error("插件包在读取期间发生变化");
  } finally {
    fs.closeSync(fd);
  }
}

function validatePluginTree(root: string, limits: { [K in keyof typeof INSTALL_LIMITS]: number }): number {
  let total = 0;
  const walk = (dir: string, relative: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (Buffer.byteLength(rel, "utf8") > limits.maxPathBytes) throw new Error(`插件路径过长: ${rel}`);
      const full = path.join(dir, entry.name);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error(`插件包含链接或特殊文件: ${rel}`);
      if (stat.isDirectory()) walk(full, rel);
      else {
        total += stat.size;
        if (stat.size > limits.maxEntryBytes || total > limits.maxExpandedBytes) throw new Error("插件展开后超过大小预算");
      }
    }
  };
  walk(root, "");
  return total;
}

const PLATFORM_ALIASES: Record<string, string> = {
  win: "win32",
  windows: "win32",
  mac: "darwin",
  macos: "darwin",
  osx: "darwin",
  win32: "win32",
  darwin: "darwin",
  linux: "linux",
};

function versionParts(value: string): { core: number[]; pre: string[] } | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value);
  if (!match) return null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4]?.split(".") ?? [] };
}

/** 返回 -1/0/1，用于插件最小宿主版本和安装升降级判断。 */
export function compareVersions(a: string, b: string): number {
  const pa = versionParts(a);
  const pb = versionParts(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1;
  }
  if (pa.pre.length === 0 && pb.pre.length > 0) return 1;
  if (pa.pre.length > 0 && pb.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    if (i >= pa.pre.length) return -1;
    if (i >= pb.pre.length) return 1;
    const aa = pa.pre[i];
    const bb = pb.pre[i];
    if (aa === bb) continue;
    const an = /^\d+$/.test(aa);
    const bn = /^\d+$/.test(bb);
    if (an && bn) return Number(aa) < Number(bb) ? -1 : 1;
    if (an !== bn) return an ? -1 : 1;
    return aa < bb ? -1 : 1;
  }
  return 0;
}

export function validateManifestCompatibility(
  manifest: Pick<PluginManifest, "platform" | "minHostVersion">,
  platform: string = process.platform,
  hostVersion = (() => {
    try {
      return app?.getVersion?.() || "0.0.0";
    } catch {
      return "0.0.0";
    }
  })(),
): void {
  const requested = manifest.platform === undefined
    ? []
    : (Array.isArray(manifest.platform) ? manifest.platform : [manifest.platform]).map((v) => PLATFORM_ALIASES[String(v).toLowerCase()] ?? String(v).toLowerCase());
  if (requested.length > 0 && !requested.includes("all") && !requested.includes("any") && !requested.includes(platform.toLowerCase())) {
    throw new Error(`插件不支持当前平台: ${platform}`);
  }
  if (manifest.minHostVersion && compareVersions(hostVersion, manifest.minHostVersion) < 0) {
    throw new Error(`插件需要更高版本的 BoxKit（至少 ${manifest.minHostVersion}）`);
  }
}

function logoToDataUrlWithLimit(file: string | undefined, maxBytes: number): string | undefined {
  if (!file) return undefined;
  try {
    const full = path.resolve(file);
    const stat = fs.statSync(full);
    if (!stat.isFile() || stat.size > maxBytes) return undefined;
    const ext = path.extname(full).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".svg" ? "image/svg+xml" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : null;
    if (!mime) return undefined;
    return `data:${mime};base64,${fs.readFileSync(full).toString("base64")}`;
  } catch {
    return undefined;
  }
}

export function logoToDataUrl(file: string | undefined): string | undefined {
  return logoToDataUrlWithLimit(file, INSTALL_LIMITS.maxLogoBytes);
}

/** 解压并校验插件包，返回暂存信息（不正式安装）。 */
export async function stageInstall(
  filePath: string,
  installedVersions: Map<string, string>,
  options?: StageInstallOptions,
): Promise<StagedPlugin> {
  if (!/\.(bkx|zip|upx)$/i.test(filePath)) throw new Error("仅支持 .bkx / .zip / .upx 插件包");
  const limits = limitsOf(options?.limits);
  const stagingId = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpRoot = path.join(stagingDir(), `${stagingId}.tmp`);
  const tmpExtract = path.join(tmpRoot, "__raw__");
  const finalDir = path.join(stagingDir(), stagingId);
  try {
    extractArchive(filePath, tmpExtract, limits);
    let root = tmpExtract;
    if (!readManifest(root, limits.maxManifestBytes)) {
      const children = fs.readdirSync(tmpExtract, { withFileTypes: true }).filter((d) => d.isDirectory());
      const candidates = children.map((c) => path.join(tmpExtract, c.name)).filter((candidate) => readManifest(candidate, limits.maxManifestBytes));
      if (candidates.length !== 1) throw new Error(candidates.length === 0 ? "插件包中未找到有效的 plugin.json" : "插件包中存在多个含 plugin.json 的目录，无法定位");
      root = candidates[0];
    }
    const manifest = readManifest(root, limits.maxManifestBytes);
    if (!manifest) throw new Error("plugin.json 校验失败");
    validateManifestCompatibility(manifest, options?.platform, options?.hostVersion);
    const mainPath = within(root, manifest.main, limits.maxPathBytes);
    if (!fs.statSync(mainPath).isFile()) throw new Error(`入口文件 ${manifest.main} 不存在`);
    if (manifest.preload && !fs.statSync(within(root, manifest.preload, limits.maxPathBytes)).isFile()) throw new Error(`清单声明了 preload(${manifest.preload}) 但文件不存在`);
    if (manifest.logo) within(root, manifest.logo, limits.maxPathBytes);
    validatePluginTree(root, limits);

    fs.rmSync(finalDir, { recursive: true, force: true });
    // root and finalDir are siblings on the same userData volume; rename avoids a second unbounded copy.
    fs.renameSync(root, finalDir);
    fs.rmSync(tmpRoot, { recursive: true, force: true });

    const installed = installedVersions.get(manifest.name);
    const versionOrder = installed === undefined ? 1 : compareVersions(manifest.version, installed);
    const conflict = installed === undefined ? "none" : versionOrder === 0 ? "same-version" : versionOrder > 0 ? "upgrade" : "downgrade";
    return {
      stagingId,
      dir: finalDir,
      manifest,
      logoDataUrl: logoToDataUrlWithLimit(manifest.logo ? within(finalDir, manifest.logo, limits.maxPathBytes) : undefined, limits.maxLogoBytes),
      conflict,
    };
  } catch (error) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(finalDir, { recursive: true, force: true });
    throw error;
  }
}

function exists(target: string): boolean {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

function backupPath(name: string, stagingId: string): string {
  return path.join(stagingDir(), `.${name}.${stagingId}.backup`);
}

function candidatePath(name: string, stagingId: string): string {
  return path.join(stagingDir(), `.${name}.${stagingId}.candidate`);
}

function restoreBackup(dest: string, backup: string): void {
  if (!exists(backup)) return;
  try {
    if (exists(dest)) fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(backup, dest);
    return;
  } catch (renameError) {
    try {
      if (exists(dest)) fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(backup, dest, { recursive: true, dereference: false, errorOnExist: false });
      fs.rmSync(backup, { recursive: true, force: true });
    } catch {
      throw new Error(`插件升级回滚失败，备份仍保留在暂存目录（${String(renameError)}）`);
    }
  }
}

/** 用户确认后：candidate → backup → 同卷原子替换；任何替换失败都恢复旧目录。 */
export async function commitInstall(stagingId: string, options?: { allowDowngrade?: boolean }): Promise<PluginManifest> {
  const id = safeStagingId(stagingId);
  const staged = path.join(stagingDir(), id);
  const manifest = readManifest(staged);
  if (!manifest) throw new Error("暂存目录无效或已被清理");
  validateManifestCompatibility(manifest);
  validatePluginTree(staged, INSTALL_LIMITS);
  const dest = path.join(pluginsDir(), manifest.name);
  const candidate = candidatePath(manifest.name, id);
  const backup = backupPath(manifest.name, id);
  let oldBackedUp = false;
  let replaced = false;
  try {
    fs.mkdirSync(pluginsDir(), { recursive: true });
    fs.rmSync(candidate, { recursive: true, force: true });
    fs.rmSync(backup, { recursive: true, force: true });
    if (exists(dest)) {
      const destinationStat = fs.lstatSync(dest);
      if (destinationStat.isSymbolicLink() || !destinationStat.isDirectory()) throw new Error("正式插件目录不是普通目录");
      const current = readManifest(dest);
      if (current && compareVersions(manifest.version, current.version) < 0 && !options?.allowDowngrade) throw new Error("降级安装需要单独确认");
    }
    // Both stagingDir() and pluginsDir() are children of userData; rename stays on one volume.
    fs.renameSync(staged, candidate);
    if (exists(dest)) {
      fs.renameSync(dest, backup);
      oldBackedUp = true;
    }
    fs.renameSync(candidate, dest);
    replaced = true;
    if (oldBackedUp) {
      try {
        fs.rmSync(backup, { recursive: true, force: true });
      } catch (error) {
        logger.warn("staging", "旧插件备份清理失败，将在下次启动恢复处理", error);
      }
    }
    return manifest;
  } catch (error) {
    try {
      if (!replaced && oldBackedUp) restoreBackup(dest, backup);
    } catch (rollbackError) {
      logger.error("staging", "插件安装失败且回滚失败", rollbackError);
      throw rollbackError;
    } finally {
      if (!replaced) fs.rmSync(candidate, { recursive: true, force: true });
    }
    throw error;
  } finally {
    if (replaced) fs.rmSync(candidate, { recursive: true, force: true });
  }
}

/** 用户取消确认时删除对应暂存目录。只接受 stageInstall 生成的 ID。 */
export function discardInstall(stagingId: string): void {
  try {
    fs.rmSync(path.join(stagingDir(), safeStagingId(stagingId)), { recursive: true, force: true });
  } catch {
    /* invalid or already removed staging IDs are treated as cancelled */
  }
}

/** 清理暂存，同时恢复上次崩溃后尚未完成替换的 backup。 */
export function cleanupStaging(): void {
  try {
    const base = stagingDir();
    for (const name of fs.readdirSync(base)) {
      const full = path.join(base, name);
      if (name.endsWith(".backup")) {
        const manifest = readManifest(full);
        if (manifest) {
          const dest = path.join(pluginsDir(), manifest.name);
          try {
            if (!exists(dest)) {
              fs.mkdirSync(pluginsDir(), { recursive: true });
              fs.renameSync(full, dest);
            } else {
              fs.rmSync(full, { recursive: true, force: true });
            }
          } catch (error) {
            logger.warn("staging", `插件备份恢复失败: ${manifest.name}`, error);
          }
        } else {
          fs.rmSync(full, { recursive: true, force: true });
        }
      } else {
        fs.rmSync(full, { recursive: true, force: true });
      }
    }
  } catch {
    /* ignore */
  }
}
