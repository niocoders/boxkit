#!/usr/bin/env node
/**
 * 生成 BoxKit 应用图标（纯 Node 实现，无第三方依赖）：
 *   apps/desktop/build/icon.png         1024x1024 应用图标（electron-builder 自动转 icns）
 *   apps/desktop/resources/trayTemplate.png       22x22 托盘模板图标
 *   apps/desktop/resources/trayTemplate@2x.png    44x44
 *
 * 用法: node tools/gen-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolsDir, "..");

// ————— 最小 PNG 编码器（RGBA 8bit） —————
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // 每行前置 filter byte 0
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ————— 绘图原语 —————
function render(size, pixelFn) {
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x + 0.5, y + 0.5, size);
      const i = (y * size + x) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = a;
    }
  }
  return buf;
}

function inRoundedRect(x, y, size, radius) {
  if (x < 0 || x > size || y < 0 || y > size) return false;
  // 标准 rounded-rect SDF：将点钳制到内芯矩形后做距离测试
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

// zap 图标（feather，24 网格）多边形
const BOLT = [
  [13, 2],
  [3, 14],
  [10, 14],
  [9, 22],
  [21, 10],
  [14, 10],
  [16, 2],
].map(([x, y]) => [x / 24, y / 24]);

function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ————— 应用图标：渐变圆角矩形 + 白色闪电 —————
const SIZE = 1024;
const icon = render(SIZE, (x, y) => {
  if (!inRoundedRect(x, y, SIZE, 226)) return [0, 0, 0, 0];
  const t = y / SIZE;
  const r = lerp(0x4f, 0x23, t);
  const g = lerp(0x6b, 0xc4, t);
  const b = lerp(0xff, 0xff, t);
  const inBolt = pointInPolygon(x / SIZE, y / SIZE, BOLT);
  if (inBolt) {
    // 轻微内阴影效果： bolts 边缘 3px 渐变
    return [255, 255, 255, 255];
  }
  return [r, g, b, 255];
});

// ————— 托盘模板图标：纯黑闪电 + 透明底 —————
function trayIcon(size) {
  return render(size, (x, y) => {
    // 留 8% 边距
    const pad = size * 0.06;
    const nx = (x - pad) / (size - pad * 2);
    const ny = (y - pad) / (size - pad * 2);
    if (pointInPolygon(nx, ny, BOLT)) return [0, 0, 0, 255];
    return [0, 0, 0, 0];
  });
}

// ————— 输出 —————
const buildDir = path.join(repoRoot, "apps/desktop/build");
const resDir = path.join(repoRoot, "apps/desktop/resources");
fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(resDir, { recursive: true });

fs.writeFileSync(path.join(buildDir, "icon.png"), encodePng(SIZE, SIZE, icon));
fs.writeFileSync(path.join(resDir, "icon.png"), encodePng(SIZE, SIZE, icon));
fs.writeFileSync(path.join(resDir, "trayTemplate.png"), encodePng(22, 22, trayIcon(22)));
fs.writeFileSync(path.join(resDir, "trayTemplate@2x.png"), encodePng(44, 44, trayIcon(44)));

console.log("✓ 图标已生成: apps/desktop/build/icon.png, apps/desktop/resources/trayTemplate*.png");
