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
  it("支持中文首字母和轻量模糊匹配", () => {
    expect(matchScore("w", "微信")).not.toBeNull();
    expect(matchScore("vsc", "Visual Studio Code")).not.toBeNull();
  });
});

describe("searchQuery", () => {
  it("应用命中并携带路径", () => {
    const rs = searchQuery("vis", deps);
    expect(rs.find((r) => r.kind === "app")?.id).toBe("app:/Applications/Visual Studio Code.app");
  });
  it("中文关键字匹配插件 feature", () => {
    const hit = searchQuery("时间", deps).find((r) => r.kind === "plugin");
    expect(hit?.featureCode).toBe("timestamp");
    expect(hit?.pluginId).toBe("devtoolbox");
  });
  it("regex feature 命中及长度限制", () => {
    expect(searchQuery("123456", deps).find((r) => r.featureCode === "lucky")).toBeDefined();
    expect(searchQuery("123", deps).find((r) => r.featureCode === "lucky")).toBeUndefined();
  });
  it("插件关键字加权高于应用包含匹配", () => {
    expect(searchQuery("ts", deps)[0].kind).toBe("plugin");
  });
  it("空输入返回功能目录并保留最近使用", () => {
    const rs = searchQuery("", { ...deps, usage: { "app:/Applications/WeChat.app": { count: 3, last: Date.now() } } });
    expect(rs[0].id).toBe("app:/Applications/WeChat.app");
    expect(rs.some((r) => r.kind === "plugin" && r.featureCode === "timestamp")).toBe(true);
  });
  it("收藏只进入固定分组且不重复", () => {
    const rs = searchQuery("", { ...deps, pinnedIds: ["plugin:devtoolbox:timestamp"] });
    const ids = rs.map((r) => r.id);
    expect(rs.find((r) => r.section === "pinned")?.id).toBe("plugin:devtoolbox:timestamp");
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("文件和剪贴板可以被搜索", () => {
    const rs = searchQuery("notes", {
      ...deps,
      files: [{ name: "notes.md", path: "/tmp/notes.md" }],
      clipboard: [{ id: "1", kind: "text", text: "notes from clipboard", createdAt: 1, size: 20 }],
    });
    expect(rs.some((r) => r.kind === "file")).toBe(true);
    expect(rs.some((r) => r.kind === "clipboard")).toBe(true);
  });
  it("平台过滤和网络兜底", () => {
    expect(searchQuery("other", { ...deps, features: [{ pluginId: "p", displayName: "P", feature: { code: "x", explain: "其他", platform: ["platform-that-is-not-current"], cmds: ["other"] } }] }).find((r) => r.featureCode === "x")).toBeUndefined();
    expect(searchQuery("zzzznothing", { ...deps, apps: [], features: [], commands: [] }).some((r) => r.kind === "web")).toBe(true);
  });
});
