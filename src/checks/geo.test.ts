import { describe, it, expect, vi, beforeEach } from "vitest";
import { GeoCheck } from "./geo.js";
import type { EndpointData } from "../types.js";

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: vi.fn(),
  },
}));

describe("GeoCheck", () => {
  let check: GeoCheck;
  let mockEndpoint: EndpointData;

  beforeEach(() => {
    check = new GeoCheck();
    mockEndpoint = {
      url: "https://example.com",
      statusCode: 200,
      headers: {},
      body: "",
      redirectChain: [],
    };
    vi.clearAllMocks();
  });

  it("should have the correct name", () => {
    expect(check.name).toBe("geo");
  });

  it("should resolve IP and return geo data", async () => {
    const dns = await import("node:dns/promises");
    vi.mocked(dns.default.resolve4).mockResolvedValueOnce(["8.8.8.8"]);

    const result = await check.run(mockEndpoint, "example.com");

    expect(result.name).toBe("geo");
    expect(result.data.ip).toBe("8.8.8.8");
    expect(result.data.country).toBeTruthy();
    expect(result.data.ll).toBeTruthy();
  });

  it("should return null values when DNS resolution fails", async () => {
    const dns = await import("node:dns/promises");
    vi.mocked(dns.default.resolve4).mockRejectedValueOnce(
      new Error("ENOTFOUND")
    );

    const result = await check.run(mockEndpoint, "invalid-domain.test");

    expect(result.name).toBe("geo");
    expect(result.data.ip).toBeNull();
    expect(result.data.country).toBeNull();
    expect(result.data.region).toBeNull();
    expect(result.data.city).toBeNull();
    expect(result.data.ll).toBeNull();
    expect(result.data.timezone).toBeNull();
  });

  it("should return null values when no addresses are returned", async () => {
    const dns = await import("node:dns/promises");
    vi.mocked(dns.default.resolve4).mockResolvedValueOnce([]);

    const result = await check.run(mockEndpoint, "example.com");

    expect(result.name).toBe("geo");
    expect(result.data.ip).toBeNull();
    expect(result.data.country).toBeNull();
  });
});
