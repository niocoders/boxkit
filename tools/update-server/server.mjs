#!/usr/bin/env node
/**
 * BoxKit 本地更新服务器示例（零依赖）。
 *
 * 用途：在正式上线前，用本地目录模拟 generic 更新源，验证 electron-updater 全链路。
 *
 * 使用：
 *   1. pnpm pack 产出 zip + latest-mac.yml（electron-builder 生成在 apps/desktop/release）
 *   2. node tools/update-server/server.mjs <更新文件目录> [端口=8964]
 *   3. 客户端设置页「更新服务器」填 http://127.0.0.1:8964/ 或环境变量
 *      BOXKIT_UPDATE_URL=http://127.0.0.1:8964/
 *
 * 生产部署：任何支持静态文件 + 正确 MIME 的服务器/CDN 即可（nginx、OSS、Cloudflare R2），
 * 保证 latest-mac.yml / latest.yml 与安装包同源可下载。
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".");
const port = Number(process.argv[3] ?? 8964);

const MIME = {
  ".yml": "text/yaml; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".zip": "application/zip",
  ".dmg": "application/x-apple-diskimage",
  ".exe": "application/octet-stream",
  ".AppImage": "application/octet-stream",
  ".deb": "application/vnd.debian.binary-package",
};

http
  .createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const rel = url.replace(/^\/+/, "") || "";
    const full = path.resolve(root, rel);
    if (!full.startsWith(root + path.sep) && full !== root) {
      res.writeHead(403).end("forbidden");
      return;
    }
    fs.readFile(full, (err, data) => {
      if (err) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(full).toLowerCase()] ?? "application/octet-stream",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(data);
    });
  })
  .listen(port, () => {
    console.log(`✓ 更新服务器已启动: http://127.0.0.1:${port}/  （目录: ${root}）`);
    console.log("  验证: curl http://127.0.0.1:" + port + "/latest-mac.yml");
  });
