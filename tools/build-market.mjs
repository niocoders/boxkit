#!/usr/bin/env node
/**
 * 插件市场静态构建器（零依赖）：
 *   plugins/<id>/  →  market/plugins/<id>-<version>.bkx（zip 格式）
 *                     market/logo/<id>.<ext>
 *                     market/manifest.json
 *
 * 市场没有服务端：.bkx 与清单由本脚本生成，GitHub Pages 直接托管 market/ 目录。
 * 客户端设置 → 插件市场 的数据源就是 manifest.json；门户页 market/index.html 也读它。
 * 发布 = 修改 plugins/ 下源码后 push，CI（pages.yml）自动重建部署。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGINS_DIR = path.join(ROOT, "plugins");
const MARKET_DIR = path.join(ROOT, "market");

// ---------- zip（stored 无压缩；.bkx 即 zip 包，客户端三端解压器均支持） ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** 收集目录下全部文件（相对路径用 / 分隔，跳过隐藏文件） */
function walkFiles(dir, base = dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (ent.name.startsWith(".")) continue;
    const full = path.join(base, ent.name);
    if (ent.isDirectory()) walkFiles(full, full, out);
    else out.push({ rel: path.relative(dir, full).split(path.sep).join("/"), full });
  }
  return out;
}

/** 打包 stored zip：返回 Buffer。文件内容原样写入，仅做 CRC32。 */
function buildZip(files) {
  const now = dosDateTime(new Date());
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const f of files) {
    const name = Buffer.from(f.rel, "utf8");
    const data = fs.readFileSync(f.full);
    const crc = crc32(data);

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4); // version needed
    lfh.writeUInt16LE(0x0800, 6); // flags: UTF-8 文件名
    lfh.writeUInt16LE(0, 8); // method: stored
    lfh.writeUInt16LE(now.time, 10);
    lfh.writeUInt16LE(now.date, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(data.length, 18); // compressed = stored
    lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(name.length, 26);
    lfh.writeUInt16LE(0, 28);
    localParts.push(lfh, name, data);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4); // version made by
    cdh.writeUInt16LE(20, 6); // version needed
    cdh.writeUInt16LE(0x0800, 8);
    cdh.writeUInt16LE(0, 10);
    cdh.writeUInt16LE(now.time, 12);
    cdh.writeUInt16LE(now.date, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(data.length, 20);
    cdh.writeUInt32LE(data.length, 24);
    cdh.writeUInt16LE(name.length, 28);
    cdh.writeUInt16LE(0, 30); // extra
    cdh.writeUInt16LE(0, 32); // comment
    cdh.writeUInt16LE(0, 34); // disk
    cdh.writeUInt16LE(0, 36); // internal attrs
    cdh.writeUInt32LE(0, 38); // external attrs
    cdh.writeUInt32LE(offset, 42);
    centralParts.push(cdh, name);

    offset += lfh.length + name.length + data.length;
  }

  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, central, eocd]);
}

// ---------- 清单归一化（与客户端 packages/shared normalizeUtoolsManifest 语义一致） ----------

function normalizeManifest(raw, dirName) {
  const m = { ...raw };
  const pluginName = typeof m.pluginName === "string" ? m.pluginName.trim() : "";
  if (pluginName && typeof m.name !== "string") {
    let slug =
      pluginName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "";
    if (slug.length < 2 || !/^[a-z0-9]/.test(slug)) {
      const h = Array.from(pluginName).reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
      slug = `plugin-${h.toString(36)}`;
    }
    m.name = slug;
    m.displayName = m.displayName ?? pluginName;
  }
  m.name = m.name ?? dirName;
  m.displayName = m.displayName ?? m.pluginName ?? dirName;
  return m;
}

function validate(m) {
  const errors = [];
  if (!/^[a-z0-9][a-z0-9-]*$/.test(m.name ?? "") || (m.name ?? "").length < 2)
    errors.push("name 需为 2-64 位小写字母/数字/中划线");
  if (!m.displayName) errors.push("缺少 displayName");
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(m.version ?? "")) errors.push("version 需符合 semver，如 1.0.0");
  if (!Array.isArray(m.features) || m.features.length === 0) errors.push("features 不能为空");
  if (!m.main) errors.push("缺少 main 入口");
  return errors;
}

// ---------- 主流程 ----------

const entries = [];
const errors = [];

for (const ent of fs.readdirSync(PLUGINS_DIR, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!ent.isDirectory()) continue;
  const dir = path.join(PLUGINS_DIR, ent.name);
  const manifestPath = path.join(dir, "plugin.json");
  if (!fs.existsSync(manifestPath)) {
    errors.push(`${ent.name}: 缺少 plugin.json`);
    continue;
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (e) {
    errors.push(`${ent.name}: plugin.json 解析失败（${e.message}）`);
    continue;
  }
  const m = normalizeManifest(raw, ent.name);
  const problems = validate(m);
  for (const p of problems) errors.push(`${ent.name}: ${p}`);
  if (problems.length) continue;
  if (!fs.existsSync(path.join(dir, m.main))) {
    errors.push(`${ent.name}: 入口文件 ${m.main} 不存在`);
    continue;
  }
  if (m.preload && !fs.existsSync(path.join(dir, m.preload))) {
    errors.push(`${ent.name}: 清单声明 preload(${m.preload}) 但文件不存在`);
    continue;
  }

  const bkxRel = `plugins/${m.name}-${m.version}.bkx`;
  entries.push({ dir, manifest: m, bkxRel });
}

if (errors.length) {
  console.error(`[build-market] 校验失败，共 ${errors.length} 处：`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
if (entries.length === 0) {
  console.error("[build-market] plugins/ 下没有可用插件");
  process.exit(1);
}

// 全量重建：先清掉上次生成物（manifest / .bkx / logo），门户 index.html 保留
fs.rmSync(path.join(MARKET_DIR, "manifest.json"), { force: true });
fs.rmSync(path.join(MARKET_DIR, "plugins"), { recursive: true, force: true });
fs.rmSync(path.join(MARKET_DIR, "logo"), { recursive: true, force: true });
fs.mkdirSync(path.join(MARKET_DIR, "plugins"), { recursive: true });

const manifestEntries = [];
for (const { dir, manifest: m, bkxRel } of entries) {
  const files = walkFiles(dir);
  const zip = buildZip(files);
  const bkxPath = path.join(MARKET_DIR, ...bkxRel.split("/"));
  fs.writeFileSync(bkxPath, zip);

  let logoRel;
  if (m.logo && fs.existsSync(path.join(dir, m.logo))) {
    const ext = path.extname(m.logo) || ".svg";
    logoRel = `logo/${m.name}${ext}`;
    fs.mkdirSync(path.join(MARKET_DIR, "logo"), { recursive: true });
    fs.copyFileSync(path.join(dir, m.logo), path.join(MARKET_DIR, ...logoRel.split("/")));
  }

  manifestEntries.push({
    pluginId: m.name,
    displayName: m.displayName,
    version: m.version,
    description: m.description || undefined,
    author: m.author || undefined,
    logoUrl: logoRel,
    fileUrl: bkxRel,
    fileSize: zip.length,
    sha256: crypto.createHash("sha256").update(zip).digest("hex"),
    keywords: m.features.flatMap((f) => f.cmds).filter((c) => typeof c === "string"),
  });
  console.log(`[build-market] ${m.name} v${m.version} → ${bkxRel}（${files.length} 个文件，${zip.length}B）`);
}

manifestEntries.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
const manifest = {
  updatedAt: new Date().toISOString(),
  /** 客户端与门户共用：MarketPlugin[]（fileUrl/logoUrl 为相对本清单的路径） */
  plugins: manifestEntries,
};
fs.writeFileSync(path.join(MARKET_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`[build-market] manifest.json 完成，共 ${manifestEntries.length} 个插件`);
