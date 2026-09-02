import { describe, expect, it } from "vitest";
import { isValidStagingId } from "./staging.js";

describe("staging IDs", () => {
  it("accepts only generated shape", () => {
    expect(isValidStagingId("s-mkabc123-abcdef")).toBe(true);
    expect(isValidStagingId("../plugins")).toBe(false);
    expect(isValidStagingId("s-test-short")).toBe(false);
    expect(isValidStagingId("s-test-abcdef/../x")).toBe(false);
  });
});
