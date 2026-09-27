import { describe, it, expect } from "vitest";
import { HstsCheck } from "./hsts.js";
import type { EndpointData } from "../types.js";

function makeEndpoint(headers: Record<string, string> = {}): EndpointData {
  return {
    url: "https://example.com",
    statusCode: 200,
    headers,
    body: "",
    finalUrl: "https://example.com",
    setCookies: [],
    redirectChain: [],
  };
}

describe("HstsCheck", () => {
  const check = new HstsCheck();

  it("has name 'hsts'", () => {
    expect(check.name).toBe("hsts");
  });

  it("parses a full HSTS header with all directives", async () => {
    const endpoint = makeEndpoint({
      "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
    });
    const result = await check.run(endpoint, "example.com");
    expect(result.data).toEqual({
      enabled: true,
      maxAge: 63072000,
      includeSubDomains: true,
      preload: true,
      preloadReady: true,
      rawHeader: "max-age=63072000; includeSubDomains; preload",
    });
  });

  it("parses a minimal header with just max-age", async () => {
    const endpoint = makeEndpoint({
      "strict-transport-security": "max-age=300",
    });
    const result = await check.run(endpoint, "example.com");
    expect(result.data).toEqual({
      enabled: true,
      maxAge: 300,
      includeSubDomains: false,
      preload: false,
      preloadReady: false,
      rawHeader: "max-age=300",
    });
  });

  it("returns disabled when header is missing", async () => {
    const endpoint = makeEndpoint();
    const result = await check.run(endpoint, "example.com");
    expect(result.data).toEqual({
      enabled: false,
      maxAge: null,
      includeSubDomains: false,
      preload: false,
      preloadReady: false,
      rawHeader: null,
    });
  });

  describe("preload readiness", () => {
    it("is not preload-ready when max-age is too low", async () => {
      const endpoint = makeEndpoint({
        "strict-transport-security": "max-age=100; includeSubDomains; preload",
      });
      const result = await check.run(endpoint, "example.com");
      expect(result.data.preloadReady).toBe(false);
      expect(result.data.preload).toBe(true);
      expect(result.data.includeSubDomains).toBe(true);
    });

    it("is not preload-ready when includeSubDomains is missing", async () => {
      const endpoint = makeEndpoint({
        "strict-transport-security": "max-age=63072000; preload",
      });
      const result = await check.run(endpoint, "example.com");
      expect(result.data.preloadReady).toBe(false);
      expect(result.data.includeSubDomains).toBe(false);
    });

    it("is not preload-ready when preload is missing", async () => {
      const endpoint = makeEndpoint({
        "strict-transport-security": "max-age=63072000; includeSubDomains",
      });
      const result = await check.run(endpoint, "example.com");
      expect(result.data.preloadReady).toBe(false);
      expect(result.data.preload).toBe(false);
    });

    it("is preload-ready at exactly 31536000 seconds", async () => {
      const endpoint = makeEndpoint({
        "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
      });
      const result = await check.run(endpoint, "example.com");
      expect(result.data.preloadReady).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("handles extra whitespace around directives", async () => {
      const endpoint = makeEndpoint({
        "strict-transport-security": "  max-age=31536000 ;  includeSubDomains ;  preload  ",
      });
      const result = await check.run(endpoint, "example.com");
      expect(result.data.maxAge).toBe(31536000);
      expect(result.data.includeSubDomains).toBe(true);
      expect(result.data.preload).toBe(true);
      expect(result.data.preloadReady).toBe(true);
    });

    it("handles mixed-case directives", async () => {
      const endpoint = makeEndpoint({
        "strict-transport-security": "Max-Age=31536000; IncludeSubDomains; Preload",
      });
      const result = await check.run(endpoint, "example.com");
      expect(result.data.maxAge).toBe(31536000);
      expect(result.data.includeSubDomains).toBe(true);
      expect(result.data.preload).toBe(true);
      expect(result.data.preloadReady).toBe(true);
    });
  });

  describe("max-age parsing (RFC 6797)", () => {
    const run = (value: string) =>
      check.run(makeEndpoint({ "strict-transport-security": value }), "example.com");

    it("accepts a quoted max-age", async () => {
      const result = await run('max-age="31536000"; includeSubDomains');
      expect(result.data.maxAge).toBe(31536000);
      expect(result.data.enabled).toBe(true);
    });

    it("tolerates whitespace around the equals sign", async () => {
      const result = await run("max-age = 600");
      expect(result.data.maxAge).toBe(600);
    });

    it("treats an empty max-age as missing, so HSTS isn't in effect", async () => {
      const result = await run("max-age=; includeSubDomains");
      expect(result.data.maxAge).toBeNull();
      expect(result.data.enabled).toBe(false);
    });

    it("treats a header with no max-age as not in effect", async () => {
      const result = await run("includeSubDomains; preload");
      expect(result.data.enabled).toBe(false);
    });

    it("treats max-age=0 as disabling HSTS", async () => {
      const result = await run("max-age=0");
      expect(result.data.maxAge).toBe(0);
      expect(result.data.enabled).toBe(false);
    });

    it("uses only the first of several comma-joined headers", async () => {
      const result = await run("max-age=31536000; includeSubDomains; preload, max-age=0");
      expect(result.data.maxAge).toBe(31536000);
      expect(result.data.preload).toBe(true);
      expect(result.data.preloadReady).toBe(true);
    });
  });
});
