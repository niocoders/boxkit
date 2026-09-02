import { describe, expect, it } from "vitest";
import { matchScore, searchQuery, type EngineDeps } from "./searchEngine.js";

const deps: EngineDeps = {
  apps: [
    { name: "Visual Studio Code", path: "/Applications/Visual Studio Code.app" },
    { name: "微信", path: "/Applications/WeChat.app" },
  ],
  commands: [
    { id: "sleep", title: "睡眠", keywords: ["sleep", "休眠"], builtinIcon: "🌙" },
    { id: "settings", title: "BoxKit 设置", keywords: ["settings", "设置"], builtinIcon: "⚙️" },
  ],
  features: [
    {
      pluginId: "devtoolbox",
      displayName: "DevToolbox",
      feature: { code: "timestamp", explain: "时间戳转换", cmds: ["时间戳", "ts"] },
    },
    {
      pluginId: "devtoolbox",
      displayName: "DevToolbox",
      feature: {
        code: "lucky",
        explain: "运气数字",
        cmds: [{ type: "regex", match: "^\\d{6}$", minLength: 6 }],
      },
    },
  ],
};

describe("matchScore", () => {
  it("精确 > 前缀 > 包含", () => {
    expect(matchScore("sleep", "sleep")!).toBeGreaterThan(matchScore("sl", "sleep")!);
    expect(matchScore("sl", "sleep")!).toBeGreaterThan(matchScore("le", "sleep")!);
    expect(matchScore("zz", "sleep")).toBeNull();
  });
  it("大小写不敏感", () => {
    expect(matchScore("SLEEP", "sleep")).toBe(100);
  });
});

describe("searchQuery", () => {
  it("应用命中并携带路径", () => {
    const rs = searchQuery("vis", deps);
    expect(rs[0].kind).toBe("app");
    expect(rs[0].id).toBe("app:/Applications/Visual Studio Code.app");
  });

  it("中文关键字匹配插件 feature", () => {
    const rs = searchQuery("时间", deps);
    const hit = rs.find((r) => r.kind === "plugin");
    expect(hit?.featureCode).toBe("timestamp");
    expect(hit?.pluginId).toBe("devtoolbox");
    expect(hit?.score).toBeGreaterThan(0);
  });

  it("regex feature 命中", () => {
    const rs = searchQuery("123456", deps);
    const hit = rs.find((r) => r.kind === "plugin" && r.featureCode === "lucky");
    expect(hit).toBeDefined();
  });

  it("regex feature 长度不足不命中", () => {
    const rs = searchQuery("123", deps);
    expect(rs.find((r) => r.featureCode === "lucky")).toBeUndefined();
  });

  it("插件关键字加权高于应用包含匹配", () => {
    const rs = searchQuery("ts", deps);
    expect(rs[0].kind).toBe("plugin");
  });

  it("空输入返回功能目录（插件/命令优先，可含应用）", () => {
    const rs = searchQuery("", deps);
    expect(rs.length).toBeGreaterThan(0);
    expect(rs.every((r) => ["plugin", "command", "app"].includes(r.kind))).toBe(true);
    // 插件功能必须出现在目录里
    expect(rs.some((r) => r.kind === "plugin" && r.featureCode === "timestamp")).toBe(true);
  });

  it("空输入时最近使用排在最前", () => {
    const rs = searchQuery("", {
      ...deps,
      usage: { "app:/Applications/WeChat.app": { count: 3, last: Date.now() } },
    });
    expect(rs[0].id).toBe("app:/Applications/WeChat.app");
  });

  it("使用频率为命中结果加权", () => {
    const plain = searchQuery("微信", deps);
    const boosted = searchQuery("微信", {
      ...deps,
      usage: { "app:/Applications/WeChat.app": { count: 5, last: Date.now() } },
    });
    const a = plain.find((r) => r.id === "app:/Applications/WeChat.app")!;
    const b = boosted.find((r) => r.id === "app:/Applications/WeChat.app")!;
    expect(b.score).toBeGreaterThan(a.score);
  });

  it("插件结果携带全部关键字（副命令）", () => {
    const rs = searchQuery("时间", deps);
    const hit = rs.find((r) => r.featureCode === "timestamp");
    expect(hit?.pluginCmds).toContain("时间戳");
    expect(hit?.pluginCmds).toContain("ts");
  });

  it("platform 字段过滤当前平台", () => {
    const rs = searchQuery("other", {
      ...deps,
      features: [{ pluginId: "platform-plugin", displayName: "Platform", feature: { code: "x", explain: "其他", platform: ["darwin"], cmds: ["other"] } }],
    });
    expect(rs.find((r) => r.featureCode === "x")).toBeUndefined();
  });
  it("无结果时提供网络搜索兜底", () => {
    const rs = searchQuery("zzzznothing", { ...deps, apps: [], features: [], commands: [] });
    expect(rs.some((r) => r.kind === "web")).toBe(true);
  });
});
