/**
 * BoxKit License 核心逻辑（纯 Node crypto，无 Electron 依赖，可单测）。
 *
 * License Key 格式：BK1.<base64url(payloadJson)>.<base64url(ed25519签名)>
 * payload 字段：
 *   product   产品标识，客户端校验须为 boxkit
 *   plan      套餐名（pro / team / lifetime …）
 *   email     授权邮箱
 *   issuedAt  签发时间(ms)
 *   expiresAt 过期时间(ms)，null = 永久
 *   deviceId  绑定设备指纹，null = 不绑定设备
 *   seats     授权席位（服务端管理用，客户端不校验）
 *
 * 签发工具见 tools/license-cli（Ed25519 密钥对，离线签发）。
 */
import crypto from "node:crypto";

export const KEY_PREFIX = "BK1";
export const DEFAULT_PRODUCT = "boxkit";

export interface LicensePayload {
  product: string;
  plan: string;
  email: string;
  issuedAt: number;
  expiresAt: number | null;
  deviceId: string | null;
  seats?: number;
}

export type VerifyFailure =
  | "format"
  | "signature"
  | "product"
  | "expired"
  | "device"
  | "not-yet-valid";

export interface VerifyResult {
  ok: boolean;
  payload?: LicensePayload;
  error?: VerifyFailure;
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64url");
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

export function issueLicense(payload: LicensePayload, privateKeyPem: string): string {
  const body = b64urlEncode(Buffer.from(JSON.stringify(payload), "utf-8"));
  const signature = crypto.sign(null, Buffer.from(body, "utf-8"), privateKeyPem);
  return `${KEY_PREFIX}.${body}.${b64urlEncode(signature)}`;
}

export function verifyLicense(
  key: string,
  opts: { publicKeyPem: string; product?: string; machineId?: string | null; now?: number },
): VerifyResult {
  const now = opts.now ?? Date.now();
  const parts = key.trim().split(".");
  if (parts.length !== 3 || parts[0] !== KEY_PREFIX) {
    return { ok: false, error: "format" };
  }
  const [, body, sigB64] = parts;
  let signature: Buffer;
  try {
    signature = b64urlDecode(sigB64);
  } catch {
    return { ok: false, error: "format" };
  }
  const bodyBuf = Buffer.from(body, "utf-8");
  let valid = false;
  try {
    valid = crypto.verify(null, bodyBuf, opts.publicKeyPem, signature);
  } catch {
    return { ok: false, error: "signature" };
  }
  if (!valid) return { ok: false, error: "signature" };

  let payload: LicensePayload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString("utf-8")) as LicensePayload;
  } catch {
    return { ok: false, error: "format" };
  }

  if ((opts.product ?? DEFAULT_PRODUCT) !== payload.product) {
    return { ok: false, error: "product" };
  }
  if (payload.issuedAt > now) return { ok: false, error: "not-yet-valid" };
  if (payload.expiresAt !== null && payload.expiresAt < now) {
    return { ok: false, error: "expired" };
  }
  if (
    payload.deviceId !== null &&
    opts.machineId !== undefined &&
    opts.machineId !== null &&
    payload.deviceId !== opts.machineId
  ) {
    return { ok: false, error: "device" };
  }
  return { ok: true, payload };
}

/** 错误码 → 用户可读文案 */
export function verifyFailureText(e: VerifyFailure): string {
  switch (e) {
    case "format":
      return "授权码格式不正确";
    case "signature":
      return "授权码签名无效";
    case "product":
      return "授权码不属于本产品";
    case "expired":
      return "授权已过期";
    case "device":
      return "授权已绑定其他设备";
    case "not-yet-valid":
      return "授权尚未生效";
  }
}

// ————— 试用期元数据（轻度混淆防手改，不做反破解加固） —————

const TRIAL_SALT = "boxkit-trial-v1";

export function encodeTrialMeta(startedAt: number): string {
  const body = b64urlEncode(Buffer.from(String(startedAt)));
  const mac = crypto.createHmac("sha256", TRIAL_SALT).update(body).digest("base64url").slice(0, 16);
  return `${body}.${mac}`;
}

export function decodeTrialMeta(raw: string): number | null {
  const [body, mac] = raw.trim().split(".");
  if (!body || !mac) return null;
  const expect = crypto
    .createHmac("sha256", TRIAL_SALT)
    .update(body)
    .digest("base64url")
    .slice(0, 16);
  if (mac !== expect) return null;
  const ts = Number(b64urlDecode(body).toString("utf-8"));
  return Number.isFinite(ts) && ts > 0 ? ts : null;
}
