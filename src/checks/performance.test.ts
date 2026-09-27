import { describe, it, expect, vi, afterEach } from "vitest";
import { PerformanceCheck } from "./performance.js";
import type { EndpointData } from "../types.js";

function makeEndpoint(overrides: Partial<EndpointData> = {}): EndpointData {
  return {
    url: "https://example.com",
    finalUrl: "https://example.com",
    statusCode: 200,
    headers: {},
    setCookies: [],
    body: "<html></html>",
    redirectChain: [],
    ...overrides,
  };
}

describe("PerformanceCheck", () => {
  const check = new PerformanceCheck();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has the name 'performance'", () => {
    expect(check.name).toBe("performance");
  });

  it("uses the endpoint's own timing instead of fetching the page again", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await check.run(makeEndpoint({ responseTimeMs: 123 }), "example.com");

    expect(result.data.responseTimeMs).toBe(123);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports null timing when the endpoint has none", async () => {
    const result = await check.run(makeEndpoint(), "example.com");
    expect(result.data.responseTimeMs).toBeNull();
  });

  it("reports transfer size and compression from the headers", async () => {
    const endpoint = makeEndpoint({
      headers: { "content-length": "5000", "content-encoding": "gzip" },
    });

    const result = await check.run(endpoint, "example.com");

    expect(result.name).toBe("performance");
    expect(result.data.contentLengthBytes).toBe(5000);
    expect(result.data.contentEncoding).toBe("gzip");
    expect(result.data.compressed).toBe(true);
    expect(result.data.redirectCount).toBe(0);
    expect(result.data.serverTiming).toEqual([]);
  });

  it("measures the decoded body in bytes, not characters", async () => {
    // "é" is 2 bytes in UTF-8; "😀" is 4 bytes (and 2 UTF-16 code units).
    const endpoint = makeEndpoint({ body: "é😀", headers: {} });

    const result = await check.run(endpoint, "example.com");

    expect(result.data.decodedBytes).toBe(6);
    expect(result.data.contentLengthBytes).toBeNull();
  });

  it("sizes the page by its decoded body, not the compressed transfer", async () => {
    const endpoint = makeEndpoint({
      body: "x".repeat(750_000),
      headers: { "content-length": "20000", "content-encoding": "gzip" },
    });

    const result = await check.run(endpoint, "example.com");

    expect(result.data.sizeCategory).toBe("large");
  });

  it("returns compressed: false when no content-encoding", async () => {
    const result = await check.run(
      makeEndpoint({ headers: { "content-length": "200" } }),
      "example.com",
    );

    expect(result.data.contentEncoding).toBeNull();
    expect(result.data.compressed).toBe(false);
  });

  it("parses server-timing header", async () => {
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

  it("counts redirects from redirectChain", async () => {
    const endpoint = makeEndpoint({
      redirectChain: ["http://example.com", "https://example.com", "https://www.example.com"],
    });

    const result = await check.run(endpoint, "example.com");

    expect(result.data.redirectCount).toBe(3);
  });
});
