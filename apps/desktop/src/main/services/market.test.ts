import { describe, expect, it } from "vitest";
import { isValidMarketSha256 } from "./market.js";

describe("market integrity", () => {
  it("accepts only 64-character hexadecimal SHA-256 values", () => {
    expect(isValidMarketSha256("a".repeat(64))).toBe(true);
    expect(isValidMarketSha256("A1".repeat(32))).toBe(true);
    expect(isValidMarketSha256("a".repeat(63))).toBe(false);
    expect(isValidMarketSha256("g".repeat(64))).toBe(false);
    expect(isValidMarketSha256(undefined)).toBe(false);
  });
});
