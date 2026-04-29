import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PerformanceCheck } from "./performance.js";
import type { EndpointData } from "../types.js";

function makeEndpoint(
  overrides: Partial<EndpointData> = {},
): EndpointData {
  return {
    url: "https://example.com",
    statusCode: 200,
    headers: {},
    body: "<html></html>",
    redirectChain: [],
    ...overrides,
  };
}

function mockFetch(body = "ok", status = 200) {
  return vi.fn().mockResolvedValue({
    status,
    text: () => Promise.resolve(body),
  });
}

describe("PerformanceCheck", () => {
  const check = new PerformanceCheck();
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("has the name 'performance'", () => {
    expect(check.name).toBe("performance");
  });

  it("measures a normal page with content-length and gzip encoding", async () => {
    vi.stubGlobal("fetch", mockFetch());

    const endpoint = makeEndpoint({
      headers: {
        "content-length": "5000",
        "content-encoding": "gzip",
      },
    });

    const result = await check.run(endpoint, "example.com");

    expect(result.name).toBe("performance");
    expect(result.data.contentLengthBytes).toBe(5000);
    expect(result.data.contentEncoding).toBe("gzip");
    expect(result.data.compressed).toBe(true);
    expect(result.data.sizeCategory).toBe("tiny");
    expect(result.data.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.data.redirectCount).toBe(0);
    expect(result.data.serverTiming).toEqual([]);
  });

  it("returns compressed: false when no content-encoding", async () => {
    vi.stubGlobal("fetch", mockFetch());

    const endpoint = makeEndpoint({
      headers: { "content-length": "200" },
    });

    const result = await check.run(endpoint, "example.com");

    expect(result.data.contentEncoding).toBeNull();
    expect(result.data.compressed).toBe(false);
  });

  it("parses server-timing header", async () => {
    vi.stubGlobal("fetch", mockFetch());

    const endpoint = makeEndpoint({
      headers: {
        "server-timing": 'cache;dur=2.5;desc="Cache Read", db;dur=100',
      },
    });

    const result = await check.run(endpoint, "example.com");

    expect(result.data.serverTiming).toEqual([
      { name: "cache", duration: 2.5, description: "Cache Read" },
      { name: "db", duration: 100, description: null },
    ]);
  });

  it("categorizes a large page correctly", async () => {
    vi.stubGlobal("fetch", mockFetch());

    const endpoint = makeEndpoint({
      headers: { "content-length": "750000" },
    });

    const result = await check.run(endpoint, "example.com");

    expect(result.data.sizeCategory).toBe("large");
    expect(result.data.contentLengthBytes).toBe(750000);
  });

  it("handles fetch errors gracefully", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("timeout")),
    );

    const endpoint = makeEndpoint();

    const result = await check.run(endpoint, "example.com");

    expect(result.data.responseTimeMs).toBe(-1);
    // Other fields should still be populated
    expect(result.data.contentLengthBytes).toBe(endpoint.body.length);
    expect(result.data.sizeCategory).toBe("tiny");
  });

  it("counts redirects from redirectChain", async () => {
    vi.stubGlobal("fetch", mockFetch());

    const endpoint = makeEndpoint({
      redirectChain: [
        "http://example.com",
        "https://example.com",
        "https://www.example.com",
      ],
    });

    const result = await check.run(endpoint, "example.com");

    expect(result.data.redirectCount).toBe(3);
  });

  it("falls back to body length when content-length is absent", async () => {
    vi.stubGlobal("fetch", mockFetch());

    const body = "x".repeat(500);
    const endpoint = makeEndpoint({ body, headers: {} });

    const result = await check.run(endpoint, "example.com");

    expect(result.data.contentLengthBytes).toBe(500);
  });
});
