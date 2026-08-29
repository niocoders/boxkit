import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  decodeTrialMeta,
  encodeTrialMeta,
  issueLicense,
  verifyLicense,
  verifyFailureText,
} from "./license.js";

const repoRoot = path.resolve(__dirname, "../../..");
const PRIV = path.join(repoRoot, "tools/license-cli/keys/dev-private.pem");
const PUB = fs.readFileSync(path.join(repoRoot, "tools/license-cli/keys/dev-public.pem"), "utf-8");

const payload = {
  product: "boxkit",
  plan: "pro",
  email: "user@example.com",
  issuedAt: Date.now() - 1000,
  expiresAt: Date.now() + 86_400_000,
  deviceId: null,
};

describe("license 核心逻辑", () => {
  it("签发并验签成功", () => {
    const key = issueLicense(payload, fs.readFileSync(PRIV, "utf-8"));
    const r = verifyLicense(key, { publicKeyPem: PUB, product: "boxkit", machineId: null });
    expect(r.ok).toBe(true);
    expect(r.payload?.plan).toBe("pro");
    expect(r.payload?.email).toBe("user@example.com");
  });

  it("与 license-cli 的签发格式互通（CLI issue → 客户端 verify）", () => {
    const out = execFileSync(
      "node",
      [
        path.join(repoRoot, "tools/license-cli/index.mjs"),
        "issue",
        "--private",
        PRIV,
        "--plan",
        "team",
        "--email",
        "cli@example.com",
        "--days",
        "30",
      ],
      { encoding: "utf-8" },
    );
    const key = out.trim().split("\n").pop()!.trim();
    expect(key.startsWith("BK1.")).toBe(true);
    const r = verifyLicense(key, { publicKeyPem: PUB, product: "boxkit", machineId: null });
    expect(r.ok).toBe(true);
    expect(r.payload?.plan).toBe("team");
  });

  it("篡改 payload 验签失败", () => {
    const key = issueLicense(payload, fs.readFileSync(PRIV, "utf-8"));
    const parts = key.split(".");
    const forged = JSON.stringify({ ...payload, plan: "lifetime" });
    const tampered = `BK1.${Buffer.from(forged).toString("base64url")}.${parts[2]}`;
    const r = verifyLicense(tampered, { publicKeyPem: PUB, product: "boxkit" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("signature");
  });

  it("过期授权返回 expired", () => {
    const key = issueLicense({ ...payload, expiresAt: Date.now() - 1000 }, fs.readFileSync(PRIV, "utf-8"));
    const r = verifyLicense(key, { publicKeyPem: PUB, product: "boxkit", now: Date.now() });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("expired");
    expect(verifyFailureText("expired")).toContain("过期");
  });

  it("设备绑定校验", () => {
    const key = issueLicense({ ...payload, deviceId: "device-A" }, fs.readFileSync(PRIV, "utf-8"));
    const bad = verifyLicense(key, {
      publicKeyPem: PUB,
      product: "boxkit",
      machineId: "device-B",
    });
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe("device");
    const good = verifyLicense(key, {
      publicKeyPem: PUB,
      product: "boxkit",
      machineId: "device-A",
    });
    expect(good.ok).toBe(true);
  });

  it("产品不匹配", () => {
    const key = issueLicense({ ...payload, product: "other-app" }, fs.readFileSync(PRIV, "utf-8"));
    const r = verifyLicense(key, { publicKeyPem: PUB, product: "boxkit" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("product");
  });

  it("格式错误", () => {
    expect(verifyLicense("hello-world", { publicKeyPem: PUB }).error).toBe("format");
    expect(verifyLicense("XX.aaa.bbb", { publicKeyPem: PUB }).error).toBe("format");
  });
});

describe("试用期元数据", () => {
  it("编码解码往返", () => {
    const ts = 1_756_000_000_000;
    expect(decodeTrialMeta(encodeTrialMeta(ts))).toBe(ts);
  });

  it("篡改检测", () => {
    const enc = encodeTrialMeta(Date.now());
    const [body] = enc.split(".");
    const forged = `${Buffer.from(String(Date.now() - 86_400_000 * 30)).toString("base64url")}.${body.split(".")[1] ?? "x"}`;
    expect(decodeTrialMeta(forged)).toBeNull();
    expect(decodeTrialMeta("garbage")).toBeNull();
  });
});
