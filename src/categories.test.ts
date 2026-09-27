import { describe, it, expect } from "vitest";
import { CHECK_CATEGORIES, checkLabel } from "./categories.js";
import { availableChecks } from "./checks/index.js";

describe("CHECK_CATEGORIES", () => {
  it("places every registered check in exactly one category", () => {
    const placed = CHECK_CATEGORIES.flatMap((c) => c.checks);
    expect([...placed].sort()).toEqual([...availableChecks()].sort());
  });
});

describe("checkLabel", () => {
  it("uses a curated label, falling back to title case", () => {
    expect(checkLabel("csp")).toBe("Content Security Policy");
    expect(checkLabel("mixed-content")).toBe("Mixed Content");
  });
});
