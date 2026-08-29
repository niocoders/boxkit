#!/usr/bin/env node
/**
 * BoxKit License CLI（零依赖，Node 20+）
 *
 * 命令：
 *   keygen  [--out <dir>]                         生成 Ed25519 密钥对
 *   issue   --private <pem> --email <mail> [opts] 签发授权码
 *   verify  --public <pem> --key <BK1...> [--device <id>]  离线验证（与客户端同逻辑）
 *   show    --key <BK1...>                        仅解码 payload（不验签）
 *
 * 示例：
 *   node tools/license-cli/index.mjs keygen --out tools/license-cli/keys
 *   node tools/license-cli/index.mjs issue --private tools/license-cli/keys/dev-private.pem \
 *        --plan pro --email user@example.com --days 365
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

function arg(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function usage(code = 1) {
  console.log(`用法:
  keygen  [--out <dir>]
  issue   --private <pem> --email <mail> [--plan pro] [--days 365] [--expires <ISO>]
          [--device <machineId>] [--product boxkit] [--seats 1]
  verify  --public <pem> --key <BK1...> [--device <machineId>]
  show    --key <BK1...>`);
  process.exit(code);
}

const cmd = args[0];

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

// ————— keygen —————
if (cmd === "keygen") {
  const out = arg("out") ?? "boxkit-keys";
  fs.mkdirSync(out, { recursive: true });
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const priv = path.join(out, "private.pem");
  const pub = path.join(out, "public.pem");
  fs.writeFileSync(priv, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  fs.writeFileSync(pub, publicKey.export({ type: "spki", format: "pem" }));
  console.log(`✓ 密钥对已生成:
  私钥(离线保管，绝不入库): ${priv}
  公钥(内置到客户端):       ${pub}

下一步：把 public.pem 的内容替换 apps/desktop/src/main/services/license.ts 中的
BOXKIT_LICENSE_PUBLIC_KEY，重新构建客户端。`);
  process.exit(0);
}

// ————— issue —————
if (cmd === "issue") {
  const priv = arg("private");
  const email = arg("email");
  if (!priv || !email) usage();
  const plan = arg("plan") ?? "pro";
  const product = arg("product") ?? "boxkit";
  const deviceId = arg("device") ?? null;
  const seats = arg("seats") ? Number(arg("seats")) : undefined;
  const issuedAt = Date.now();
  let expiresAt = null;
  if (arg("days")) expiresAt = issuedAt + Number(arg("days")) * 86_400_000;
  if (arg("expires")) expiresAt = new Date(arg("expires")).getTime();

  const payload = { product, plan, email, issuedAt, expiresAt, deviceId, ...(seats ? { seats } : {}) };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf-8"));
  const signature = crypto.sign(null, Buffer.from(body, "utf-8"), fs.readFileSync(priv, "utf-8"));
  const key = `BK1.${body}.${b64url(signature)}`;
  console.log(`授权码 (plan=${plan} email=${email}${expiresAt ? ` 有效期至 ${new Date(expiresAt).toISOString().slice(0, 10)}` : " 永久"}${deviceId ? ` 绑定设备 ${deviceId}` : ""}):\n\n${key}`);
  process.exit(0);
}

// ————— verify / show —————
if (cmd === "verify" || cmd === "show") {
  const key = arg("key");
  if (!key) usage();
  const parts = key.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "BK1") {
    console.error("✗ 格式错误：应为 BK1.<payload>.<signature>");
    process.exit(1);
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
  } catch {
    console.error("✗ payload 解码失败");
    process.exit(1);
  }

  if (cmd === "show") {
    console.log(JSON.stringify(payload, null, 2));
    process.exit(0);
  }

  const pub = arg("public");
  if (!pub) usage();
  const ok = crypto.verify(null, Buffer.from(parts[1], "utf-8"), fs.readFileSync(pub, "utf-8"), Buffer.from(parts[2], "base64url"));
  if (!ok) {
    console.error("✗ 签名无效");
    process.exit(1);
  }
  const now = Date.now();
  if (payload.product !== "boxkit") {
    console.error("✗ product 不匹配");
    process.exit(1);
  }
  if (payload.expiresAt !== null && payload.expiresAt < now) {
    console.error("✗ 授权已过期");
    process.exit(1);
  }
  if (payload.deviceId && arg("device") && payload.deviceId !== arg("device")) {
    console.error("✗ 设备不匹配");
    process.exit(1);
  }
  console.log(`✓ 签名有效\n${JSON.stringify(payload, null, 2)}`);
  process.exit(0);
}

usage();
