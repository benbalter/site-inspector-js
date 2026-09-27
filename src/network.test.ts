import { describe, it, expect, vi, beforeEach } from "vitest";

const lookup = vi.fn();
vi.mock("node:dns/promises", () => ({ default: { lookup } }));

const { isPublicAddress, resolvePublic } = await import("./network.js");

describe("isPublicAddress", () => {
  it("allows public addresses and refuses private, loopback, and metadata ones", () => {
    expect(isPublicAddress("93.184.216.34")).toBe(true);
    expect(isPublicAddress("2606:2800:220:1::")).toBe(true);
    for (const a of [
      "127.0.0.1",
      "10.1.2.3",
      "169.254.169.254",
      "::1",
      "fd00::1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isPublicAddress(a), a).toBe(false);
    }
    expect(isPublicAddress("not-an-ip")).toBe(false);
  });
});

describe("resolvePublic", () => {
  beforeEach(() => {
    lookup.mockReset();
  });

  it("returns the addresses when every one is public", async () => {
    lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    expect(await resolvePublic("mx.example.com")).toEqual(["93.184.216.34"]);
  });

  it("refuses a host with any non-public address", async () => {
    lookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    expect(await resolvePublic("evil.example.com")).toBeNull();
  });

  it("returns null when the host doesn't resolve", async () => {
    lookup.mockRejectedValue(Object.assign(new Error("nope"), { code: "ENOTFOUND" }));
    expect(await resolvePublic("missing.example.com")).toBeNull();
  });
});
