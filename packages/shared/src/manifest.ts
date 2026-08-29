import { z } from "zod";
import { PLUGIN_PERMISSIONS } from "./types.js";

/** 插件 feature 的 cmd：字符串关键字 或 正则匹配器（兼容 uTools 的 minNum 字段）。 */
export const cmdSchema = z.union([
  z.string().min(1),
  z.object({
    type: z.literal("regex"),
    match: z.string().min(1),
    minLength: z.number().int().min(1).max(200).optional(),
    /** uTools 风格：最少输入字符数（与 minLength 等价，读取时已归一） */
    minNum: z.number().int().min(1).max(200).optional(),
    explain: z.string().optional(),
  }),
]);
export type PluginCmd = z.infer<typeof cmdSchema>;

export const featureSchema = z.object({
  code: z
    .string()
    .min(1)
    .regex(/^[A-Za-z0-9_-]+$/, "feature.code 仅允许字母数字下划线中划线"),
  explain: z.string().min(1),
  cmds: z.array(cmdSchema).min(1),
});
export type PluginFeature = z.infer<typeof featureSchema>;

export const permissionsSchema = z.enum(PLUGIN_PERMISSIONS);

/**
 * plugin.json 校验 schema。
 * 设计上兼容 uTools 插件清单风格（features/cmds/main/preload），便于生态迁移。
 */
export const manifestSchema = z.object({
  /** 插件唯一 ID：小写字母数字与中划线（uTools 插件可只写 pluginName，会自动归一化） */
  name: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "name 仅允许小写字母、数字与中划线"),
  displayName: z.string().min(1).max(64),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/, "version 需符合 semver，如 1.0.0"),
  description: z.string().max(500).optional(),
  author: z.string().max(64).optional(),
  /** 插件入口 HTML（相对插件根目录） */
  main: z.string().default("index.html"),
  /** 可选的沙箱 preload 脚本（相对插件根目录），可获得 window.bk API */
  preload: z.string().optional(),
  logo: z.string().optional(),
  permissions: z.array(permissionsSchema).default([]),
  features: z.array(featureSchema).min(1),
  minHostVersion: z.string().optional(),
});
export type PluginManifest = z.infer<typeof manifestSchema>;

export class ManifestError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`plugin.json 校验失败: ${issues.join("; ")}`);
    this.name = "ManifestError";
    this.issues = issues;
  }
}

/**
 * uTools 风格清单归一化：
 * - pluginName → name（slug 化）+ displayName
 * - 正则 cmd 的 minNum → minLength
 * 原 input 不变，返回归一化副本。
 */
export function normalizeUtoolsManifest<T>(input: T): T {
  if (!input || typeof input !== "object") return input;
  const raw = { ...(input as Record<string, unknown>) };
  const pluginName = typeof raw.pluginName === "string" ? raw.pluginName.trim() : "";
  if (pluginName && typeof raw.name !== "string") {
    // ASCII slug 优先；无法构成合法 slug 的（纯中文等）退化为稳定哈希
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
    raw.name = slug;
    raw.displayName = raw.displayName ?? pluginName;
  }
  if (Array.isArray(raw.features)) {
    raw.features = raw.features.map((f: unknown) => {
      if (!f || typeof f !== "object") return f;
      const feat = { ...(f as Record<string, unknown>) };
      if (Array.isArray(feat.cmds)) {
        feat.cmds = feat.cmds.map((c: unknown) => {
          if (c && typeof c === "object" && (c as Record<string, unknown>).type === "regex") {
            const rc = { ...(c as Record<string, unknown>) };
            if (rc.minLength === undefined && rc.minNum !== undefined) {
              rc.minLength = rc.minNum;
            }
            return rc;
          }
          return c;
        });
      }
      return feat;
    });
  }
  return raw as T;
}

/** 解析并校验 plugin.json 内容（字符串或已 parse 的对象）；兼容 uTools 清单。 */
export function parseManifest(input: unknown): PluginManifest {
  const normalized =
    typeof input === "string"
      ? normalizeUtoolsManifest(JSON.parse(input))
      : normalizeUtoolsManifest(input);
  const result = manifestSchema.safeParse(normalized);
  if (!result.success) {
    throw new ManifestError(
      result.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`),
    );
  }
  return result.data;
}

export function safeParseManifest(input: unknown):
  | { ok: true; manifest: PluginManifest }
  | { ok: false; error: string } {
  try {
    return { ok: true, manifest: parseManifest(input) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
