import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EndpointData } from "../types.js";

const mockResolve4 = vi.fn();
const mockResolve6 = vi.fn();
const mockResolveMx = vi.fn();
const mockResolveCaa = vi.fn();
const mockResolveCname = vi.fn();
const mockReverse = vi.fn();

vi.mock("node:dns/promises", () => {
  const MockResolver = function (this: Record<string, unknown>) {
    this.resolve4 = mockResolve4;
    this.resolve6 = mockResolve6;
    this.resolveMx = mockResolveMx;
    this.resolveCaa = mockResolveCaa;
    this.resolveCname = mockResolveCname;
    this.reverse = mockReverse;
  };
  return {
    default: { Resolver: MockResolver },
  };
});

import { DnsCheck } from "./dns.js";

const dummyEndpoint: EndpointData = {
  url: "https://example.com",
  statusCode: 200,
  headers: {},
  body: "",
  redirectChain: [],
};

describe("DnsCheck", () => {
  const check = new DnsCheck();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns A and AAAA records for a dual-stack domain", async () => {
    mockResolve4.mockResolvedValue(["93.184.216.34"]);
    mockResolve6.mockResolvedValue(["2606:2800:220:1:248:1893:25c8:1946"]);
    mockResolveMx.mockResolvedValue([{ exchange: "mx.example.com", priority: 10 }]);
    mockResolveCaa.mockResolvedValue([{ critical: 0, issue: "letsencrypt.org" }]);
    mockReverse.mockResolvedValue(["host.example.com"]);
    mockResolveCname.mockRejectedValue(new Error("NODATA"));

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.name).toBe("dns");
    expect(result.data.ipv6).toBe(true);
    expect(result.data.ip).toBe("93.184.216.34");
    expect(result.data.hostname).toBe("host.example.com");
    expect(result.data.cdn).toBeNull();
    expect(result.data.a).toEqual(["93.184.216.34"]);
    expect(result.data.aaaa).toEqual(["2606:2800:220:1:248:1893:25c8:1946"]);
    expect(result.data.mx).toEqual([{ exchange: "mx.example.com", priority: 10 }]);
  });

  it("detects Cloudflare CDN from CNAME", async () => {
    mockResolve4.mockResolvedValue(["104.16.132.229"]);
    mockResolve6.mockResolvedValue([]);
    mockResolveMx.mockResolvedValue([]);
    mockResolveCaa.mockRejectedValue(new Error("NODATA"));
    mockReverse.mockRejectedValue(new Error("ENOTFOUND"));
    mockResolveCname.mockResolvedValue(["example.com.cdn.cloudflare.net"]);

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.data.cdn).toBe("cloudflare");
    expect(result.data.ipv6).toBe(false);
    expect(result.data.hostname).toBeNull();
  });

  it("handles a domain with no IPv6 records", async () => {
    mockResolve4.mockResolvedValue(["1.2.3.4"]);
    mockResolve6.mockRejectedValue(new Error("NODATA"));
    mockResolveMx.mockResolvedValue([]);
    mockResolveCaa.mockRejectedValue(new Error("NODATA"));
    mockReverse.mockResolvedValue(["host.example.com"]);
    mockResolveCname.mockRejectedValue(new Error("NODATA"));

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.data.ipv6).toBe(false);
    expect(result.data.aaaa).toEqual([]);
    expect(result.data.ip).toBe("1.2.3.4");
  });

  it("handles complete DNS lookup failure gracefully", async () => {
    mockResolve4.mockRejectedValue(new Error("SERVFAIL"));
    mockResolve6.mockRejectedValue(new Error("SERVFAIL"));
    mockResolveMx.mockRejectedValue(new Error("SERVFAIL"));
    mockResolveCaa.mockRejectedValue(new Error("SERVFAIL"));
    mockResolveCname.mockRejectedValue(new Error("SERVFAIL"));

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.name).toBe("dns");
    expect(result.data.ip).toBeNull();
    expect(result.data.ipv6).toBe(false);
    expect(result.data.hostname).toBeNull();
    expect(result.data.cdn).toBeNull();
    expect(result.data.a).toEqual([]);
  });
});
