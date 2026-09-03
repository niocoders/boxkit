import { describe, expect, it } from "vitest";
import {
  HOST_API_PERMISSIONS,
  HOST_API_VERSION,
  INPUT_PAYLOAD_VERSION,
  getBK,
  inBoxKit,
} from "./index";
import type { BKApi, InputPayload, PluginEnterArgs, VersionedInputPayload } from "./index";

const positiveInput: InputPayload = {
  type: "files",
  files: [
    { path: "C:/tmp/a.txt", name: "a.txt", kind: "file" },
    { path: "C:/tmp/folder", name: "folder", kind: "directory" },
  ],
};

const positiveEnter: PluginEnterArgs = {
  code: "open",
  type: "text",
  payload: "hello",
  input: { version: INPUT_PAYLOAD_VERSION, payload: positiveInput },
};

function apiFixture(): BKApi {
  return {
    onPluginEnter: () => undefined,
    onPluginOut: () => undefined,
    setSubInput: () => undefined,
    removeSubInput: () => undefined,
    onSubInputChange: () => undefined,
    outPlugin: () => undefined,
    notify: () => undefined,
    copyText: () => undefined,
    readClipboardText: async () => "",
    writeClipboardText: async () => undefined,
    db: {
      get: async () => null,
      put: async () => undefined,
      remove: async () => undefined,
      all: async () => [],
    },
    openExternal: async () => undefined,
    setViewHeightRatio: () => undefined,
    getPrimaryDisplaySize: async () => ({ width: 1, height: 1 }),
    info: async () => ({ name: "fixture", displayName: "Fixture", version: "1.0.0", permissions: [], path: "." }),
    hostVersion: () => "1.0.0",
  };
}

describe("@boxkit/sdk public contract", () => {
  it("keeps the stable API and typed input versions explicit", () => {
    expect(HOST_API_VERSION).toBe("1.0.0");
    expect(INPUT_PAYLOAD_VERSION).toBe(1);
    expect(HOST_API_PERMISSIONS).toContain("clipboard");
    expect(positiveEnter.input?.payload).toEqual(positiveInput);
  });

  it("accepts a complete positive host API fixture", async () => {
    const fixture = apiFixture();
    expect(fixture.hostVersion()).toBe("1.0.0");
    await expect(fixture.info()).resolves.toMatchObject({ name: "fixture" });
  });

  it("rejects access when no host is installed", () => {
    expect(inBoxKit()).toBe(false);
    expect(() => getBK()).toThrow("未检测到 BoxKit 插件环境");
  });

  it("models a versioned typed payload independently of the legacy string", () => {
    const payload: VersionedInputPayload = {
      version: INPUT_PAYLOAD_VERSION,
      payload: { type: "text", text: "selected", source: "selection" },
    };
    expect(payload.payload.type).toBe("text");
  });
});
