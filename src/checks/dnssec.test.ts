import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EndpointData } from "../types.js";

const mockFetch = vi.fn();

vi.stubGlobal("fetch", mockFetch);

import { DnssecCheck } from "./dnssec.js";

const dummyEndpoint: EndpointData = {
  url: "https://example.com",
  statusCode: 200,
  headers: {},
  body: "",
  redirectChain: [],
};

describe("DnssecCheck", () => {
  const check = new DnssecCheck();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns DNSSEC enabled when DNSKEY and DS records exist", async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        Status: 0,
        AD: true,
        Answer: [{ type: 48, data: "256 3 13 ..." }],
      }),
    });

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.name).toBe("dnssec");
    expect(result.data.enabled).toBe(true);
    expect(result.data.adFlag).toBe(true);
    expect(result.data.hasDnskey).toBe(true);
    expect(result.data.hasDs).toBe(true);
    expect(result.data.hasRrsig).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("returns DNSSEC disabled when no records exist", async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        Status: 0,
        AD: false,
        Answer: undefined,
      }),
    });

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.name).toBe("dnssec");
    expect(result.data.enabled).toBe(false);
    expect(result.data.adFlag).toBe(false);
    expect(result.data.hasDnskey).toBe(false);
    expect(result.data.hasDs).toBe(false);
    expect(result.data.hasRrsig).toBe(false);
  });

  it("returns enabled when DNSKEY record exists", async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // DNSKEY response
        return Promise.resolve({
          json: async () => ({
            Status: 0,
            AD: false,
            Answer: [{ type: 48, data: "256 3 13 ..." }],
          }),
        });
      }
      // DS and RRSIG responses with empty answers
      return Promise.resolve({
        json: async () => ({
          Status: 0,
          AD: false,
          Answer: undefined,
        }),
      });
    });

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.data.enabled).toBe(true);
    expect(result.data.hasDnskey).toBe(true);
    expect(result.data.hasDs).toBe(false);
    expect(result.data.hasRrsig).toBe(false);
  });

  it("returns enabled when DS record exists", async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        // DS response
        return Promise.resolve({
          json: async () => ({
            Status: 0,
            AD: true,
            Answer: [{ type: 43, data: "257 3 8 ..." }],
          }),
        });
      }
      // DNSKEY and RRSIG responses with empty answers
      return Promise.resolve({
        json: async () => ({
          Status: 0,
          AD: false,
          Answer: undefined,
        }),
      });
    });

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.data.enabled).toBe(true);
    expect(result.data.hasDnskey).toBe(false);
    expect(result.data.hasDs).toBe(true);
    expect(result.data.hasRrsig).toBe(false);
    expect(result.data.adFlag).toBe(true);
  });

  it("sets AD flag when DNSKEY response has AD=true", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("type=48")) {
        // DNSKEY response with AD flag
        return {
          json: async () => ({
            Status: 0,
            AD: true,
            Answer: undefined,
          }),
        };
      }
      return {
        json: async () => ({
          Status: 0,
          AD: false,
          Answer: undefined,
        }),
      };
    });

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.data.adFlag).toBe(true);
  });

  it("handles fetch errors gracefully", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.name).toBe("dnssec");
    expect(result.data.enabled).toBe(false);
    expect(result.data.adFlag).toBe(false);
    expect(result.data.hasDnskey).toBe(false);
    expect(result.data.hasDs).toBe(false);
    expect(result.data.hasRrsig).toBe(false);
  });

  it("checks domain name from parameter", async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        Status: 0,
        AD: false,
        Answer: undefined,
      }),
    });

    await check.run(dummyEndpoint, "example.org");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("example.org"),
      expect.any(Object),
    );
  });

  it("passes correct record types to DoH API", async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        Status: 0,
        AD: false,
        Answer: undefined,
      }),
    });

    await check.run(dummyEndpoint, "example.com");

    // Should call with type=48 (DNSKEY), type=43 (DS), type=46 (RRSIG)
    const calls = mockFetch.mock.calls.map((call) => call[0] as string);
    expect(calls.some((url) => url.includes("type=48"))).toBe(true);
    expect(calls.some((url) => url.includes("type=43"))).toBe(true);
    expect(calls.some((url) => url.includes("type=46"))).toBe(true);
  });
});
