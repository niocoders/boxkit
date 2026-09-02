import { beforeEach, describe, expect, it } from "vitest";
import { settings } from "../core/config.js";
import { normalizePinnedIds } from "./favorites.js";
import { looksSensitiveText, sanitizeClipboardCapture } from "./clipboardHistory.js";

describe("favorites", () => {
  it("deduplicates and bounds persisted IDs", () => {
    const ids = normalizePinnedIds(["a", "a", "", 1, "b", "c"]);
    expect(ids).toEqual(["a", "b", "c"]);
  });
});

describe("clipboard history sanitization", () => {
  it("rejects common credentials and private keys", () => {
    expect(looksSensitiveText("password=secret")).toBe(true);
    expect(looksSensitiveText("Bearer abc.def")).toBe(true);
    const privateKeyMarker = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
    expect(looksSensitiveText(privateKeyMarker)).toBe(true);
    expect(sanitizeClipboardCapture({ text: "token: abc" })).toBeNull();
  });

  it("limits ordinary text and accepts image bytes within the cap", () => {
    const text = sanitizeClipboardCapture({ text: "hello" });
    expect(text?.kind).toBe("text");
    expect(sanitizeClipboardCapture({ image: new Uint8Array([1, 2, 3]) })?.kind).toBe("image");
  });
});

beforeEach(() => {
  settings.set({ clipboardHistoryEnabled: false });
});
