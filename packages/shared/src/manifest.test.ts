import { describe, expect, it } from "vitest";
import { parseManifest, safeParseManifest, ManifestError } from "./manifest.js";

const valid = {
  name: "demo-plugin",
  displayName: "示例插件",
  version: "1.0.0",
  main: "index.html",
  permissions: ["clipboard", "notify"],
  features: [{ code: "main", explain: "主功能", cmds: ["demo", { type: "regex", match: "^\\d{4}$" }] }],
};

describe("plugin.json 清单校验", () => {
  it("合法清单通过，默认值补齐", () => {
    const m = parseManifest(valid);
    expect(m.main).toBe("index.html");
    expect(m.permissions).toEqual(["clipboard", "notify"]);
    expect(m.features[0].cmds[1]).toEqual({ type: "regex", match: "^\\d{4}$" });
  });

  it("非法 name 拒绝", () => {
    const r = safeParseManifest({ ...valid, name: "Bad_Name" });
    expect(r.ok).toBe(false);
  });

  it("非法 version 拒绝", () => {
    const r = safeParseManifest({ ...valid, version: "1.0" });
    expect(r.ok).toBe(false);
  });

  it("空 features 拒绝", () => {
    const r = safeParseManifest({ ...valid, features: [] });
    expect(r.ok).toBe(false);
  });

  it("未知权限拒绝", () => {
    const r = safeParseManifest({ ...valid, permissions: ["root"] });
    expect(r.ok).toBe(false);
  });

  it("regex cmd 缺 match 拒绝", () => {
    const r = safeParseManifest({
      ...valid,
      features: [{ code: "x", explain: "x", cmds: [{ type: "regex" }] }],
    });
    expect(r.ok).toBe(false);
  });

  it("ManifestError 携带 issue 描述", () => {
    try {
      parseManifest({ name: "x" });
      throw new Error("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ManifestError);
      expect((e as ManifestError).issues.length).toBeGreaterThan(0);
    }
  });
});
