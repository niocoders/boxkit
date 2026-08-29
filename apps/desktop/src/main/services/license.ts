import { app, safeStorage } from "electron";
import fs from "node:fs";
import {
  encodeTrialMeta,
  decodeTrialMeta,
  verifyLicense,
  verifyFailureText,
  type LicensePayload,
  type LicenseState,
} from "@boxkit/shared";
import { licensePath, trialMetaPath } from "../core/paths.js";
import { logger } from "../core/logger.js";
import { getMachineId } from "./machine-id.js";

/**
 * 内置 License 公钥（Ed25519）。
 * ⚠️ 生产环境：用 tools/license-cli keygen 重新生成密钥对，替换这里的公钥，
 *    私钥离线保管、绝不入库。开发密钥对见 tools/license-cli/keys/。
 * 可用环境变量 BOXKIT_LICENSE_PUBLIC_KEY 覆盖（多行 PEM 用 \n 转义传入）。
 */
export const BOXKIT_LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAbEgEjJRX9FMA6ZezodH9/ZHJplug5yPywsN7BHtL0zY=
-----END PUBLIC KEY-----`;

const TRIAL_DAYS = 14;
const PRODUCT = "boxkit";

function publicKeyPem(): string {
  return process.env.BOXKIT_LICENSE_PUBLIC_KEY?.replace(/\\n/g, "\n") || BOXKIT_LICENSE_PUBLIC_KEY;
}

// ————— 试用期 —————

export function ensureTrial(): number {
  try {
    const raw = fs.readFileSync(trialMetaPath(), "utf-8");
    const startedAt = decodeTrialMeta(raw);
    if (startedAt) return startedAt;
  } catch {
    /* 首次启动 */
  }
  const startedAt = Date.now();
  try {
    fs.writeFileSync(trialMetaPath(), encodeTrialMeta(startedAt));
  } catch (e) {
    logger.error("license", "写入试用期标记失败", e);
  }
  return startedAt;
}

// ————— License 存取（safeStorage 加密） —————

function readStoredKey(): string | null {
  try {
    const raw = fs.readFileSync(licensePath());
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(raw);
    }
    return raw.toString("utf-8").startsWith("BK1.") ? raw.toString("utf-8") : null;
  } catch {
    return null;
  }
}

function writeStoredKey(key: string): void {
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(key)
    : Buffer.from(key, "utf-8");
  fs.writeFileSync(licensePath(), data);
}

// ————— 对外状态机 —————

export function licenseState(): LicenseState {
  const machineId = getMachineId();
  const stored = readStoredKey();
  if (stored) {
    const r = verifyLicense(stored, { publicKeyPem: publicKeyPem(), product: PRODUCT, machineId });
    if (r.ok && r.payload) {
      const p: LicensePayload = r.payload;
      const daysLeft =
        p.expiresAt === null
          ? null
          : Math.max(0, Math.ceil((p.expiresAt - Date.now()) / 86_400_000));
      return {
        mode: "licensed",
        daysLeft,
        email: p.email,
        plan: p.plan,
        expiresAt: p.expiresAt,
      };
    }
    if (r.error === "expired") {
      return { mode: "license-expired", daysLeft: 0 };
    }
    // 设备不匹配/签名无效 → 视为未授权，走试用期
    logger.warn("license", `已存授权校验失败(${r.error})，回退试用期`);
  }

  const startedAt = ensureTrial();
  const elapsed = Date.now() - startedAt;
  const daysLeft = Math.max(0, TRIAL_DAYS - Math.floor(elapsed / 86_400_000));
  return daysLeft > 0
    ? { mode: "trial", daysLeft, trialStartedAt: startedAt }
    : { mode: "trial-expired", daysLeft: 0, trialStartedAt: startedAt };
}

export function activateLicense(key: string): { ok: boolean; state?: LicenseState; error?: string } {
  const r = verifyLicense(key, {
    publicKeyPem: publicKeyPem(),
    product: PRODUCT,
    machineId: getMachineId(),
  });
  if (!r.ok) return { ok: false, error: verifyFailureText(r.error!) };
  try {
    writeStoredKey(key.trim());
  } catch (e) {
    logger.error("license", "保存授权失败", e);
    return { ok: false, error: "保存授权失败" };
  }
  logger.info("license", `授权激活成功: ${r.payload!.plan} <${r.payload!.email}>`);
  return { ok: true, state: licenseState() };
}

export function deactivateLicense(): void {
  try {
    fs.rmSync(licensePath(), { force: true });
  } catch {
    /* ignore */
  }
}

/** 插件功能是否可用（试用期或已授权均可用） */
export function canUsePlugins(): boolean {
  const s = licenseState();
  return s.mode === "licensed" || s.mode === "trial";
}

export function initLicenseOnBoot(): void {
  if (!app.isReady) return;
  ensureTrial();
}
