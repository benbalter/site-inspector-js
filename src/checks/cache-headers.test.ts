import { describe, it, expect } from "vitest";
import { CacheHeadersCheck } from "./cache-headers.js";
import type { EndpointData } from "../types.js";

function makeEndpoint(headers: Record<string, string> = {}): EndpointData {
  return {
    url: "https://example.com",
    statusCode: 200,
    headers,
    body: "",
    redirectChain: [],
  };
}

describe("CacheHeadersCheck", () => {
  const check = new CacheHeadersCheck();

  it("has name 'cache-headers'", () => {
    expect(check.name).toBe("cache-headers");
  });

  it("returns grade F when no cache headers are present", async () => {
    const endpoint = makeEndpoint();
    const result = await check.run(endpoint, "example.com");
    expect(result.data.grade).toBe("F");
    expect(result.data.score).toBe(0);
  });

  it("returns grade A with full caching headers", async () => {
    const endpoint = makeEndpoint({
      "cache-control": "public, max-age=3600, immutable",
      "etag": '"abc123"',
      "last-modified": "Wed, 21 Oct 2023 07:28:00 GMT",
      "vary": "Accept-Encoding",
    });
    const result = await check.run(endpoint, "example.com");
    expect(result.data.grade).toBe("A");
    expect(result.data.score).toBeGreaterThanOrEqual(7);
  });

  it("parses no-store directive", async () => {
    const endpoint = makeEndpoint({
      "cache-control": "no-store",
    });
    const result = await check.run(endpoint, "example.com");
    expect(result.data.noStore).toBe(true);
    expect(result.data.cacheControl).toBe("no-store");
  });

  it("returns etag as boolean true when present", async () => {
    const endpoint = makeEndpoint({
      "etag": '"strong-etag"',
    });
    const result = await check.run(endpoint, "example.com");
    expect(result.data.etag).toBe(true);
  });

  it("returns etag as boolean false when absent", async () => {
    const endpoint = makeEndpoint();
    const result = await check.run(endpoint, "example.com");
    expect(result.data.etag).toBe(false);
  });

  it("parses max-age correctly", async () => {
    const endpoint = makeEndpoint({
      "cache-control": "public, max-age=7200",
    });
    const result = await check.run(endpoint, "example.com");
    expect(result.data.maxAge).toBe(7200);
  });

  it("parses s-maxage correctly", async () => {
    const endpoint = makeEndpoint({
      "cache-control": "public, max-age=3600, s-maxage=86400",
    });
    const result = await check.run(endpoint, "example.com");
    expect(result.data.sMaxAge).toBe(86400);
    expect(result.data.maxAge).toBe(3600);
  });

  describe("directive parsing", () => {
    it("parses cache-control directives with multiple values", async () => {
      const endpoint = makeEndpoint({
        "cache-control": "public, max-age=3600, must-revalidate",
      });
      const result = await check.run(endpoint, "example.com");
      expect(result.data.isPublic).toBe(true);
      expect(result.data.maxAge).toBe(3600);
      expect(result.data.mustRevalidate).toBe(true);
    });

    it("parses no-cache directive", async () => {
      const endpoint = makeEndpoint({
        "cache-control": "no-cache",
      });
      const result = await check.run(endpoint, "example.com");
      expect(result.data.noCache).toBe(true);
    });

    it("parses private directive", async () => {
      const endpoint = makeEndpoint({
        "cache-control": "private, max-age=1800",
      });
      const result = await check.run(endpoint, "example.com");
      expect(result.data.isPrivate).toBe(true);
    });

    it("parses immutable directive", async () => {
      const endpoint = makeEndpoint({
        "cache-control": "public, max-age=31536000, immutable",
      });
      const result = await check.run(endpoint, "example.com");
      expect(result.data.immutable).toBe(true);
    });

    it("handles case-insensitivity in directives", async () => {
      const endpoint = makeEndpoint({
        "cache-control": "Public, Max-Age=3600, Immutable",
      });
      const result = await check.run(endpoint, "example.com");
      expect(result.data.isPublic).toBe(true);
      expect(result.data.maxAge).toBe(3600);
      expect(result.data.immutable).toBe(true);
    });

    it("handles whitespace in cache-control header", async () => {
      const endpoint = makeEndpoint({
        "cache-control": "  public  ,  max-age=3600  ,  immutable  ",
      });
      const result = await check.run(endpoint, "example.com");
      expect(result.data.isPublic).toBe(true);
      expect(result.data.maxAge).toBe(3600);
      expect(result.data.immutable).toBe(true);
    });
  });

  describe("scoring", () => {
    it("adds score for cache-control header", async () => {
      const endpoint = makeEndpoint({
        "cache-control": "public",
      });
      const result = await check.run(endpoint, "example.com");
      expect(result.data.score).toBe(2);
    });

    it("adds score for etag header", async () => {
      const endpoint = makeEndpoint({
        "etag": '"abc123"',
      });
      const result = await check.run(endpoint, "example.com");
      expect(result.data.score).toBe(2);
    });

    it("deducts score for no-store", async () => {
      const endpoint = makeEndpoint({
        "cache-control": "no-store",
      });
      const result = await check.run(endpoint, "example.com");
      expect(result.data.score).toBe(2 - 1); // cache-control - no-store
    });

    it("calculates correct grade boundaries", async () => {
      // Grade F: score < 1
      let endpoint = makeEndpoint();
      let result = await check.run(endpoint, "example.com");
      expect(result.data.grade).toBe("F");

      // Grade D: score >= 1
      endpoint = makeEndpoint({ "etag": '"abc"' });
      result = await check.run(endpoint, "example.com");
      expect(result.data.grade).toBe("D");

      // Grade C: score >= 3
      endpoint = makeEndpoint({
        "cache-control": "public",
        "etag": '"abc"',
      });
      result = await check.run(endpoint, "example.com");
      expect(result.data.grade).toBe("C");

      // Grade B: score >= 5 (cache-control=2, etag=2, last-modified=1)
      endpoint = makeEndpoint({
        "cache-control": "public, max-age=3600",
        "etag": '"abc"',
      });
      result = await check.run(endpoint, "example.com");
      expect(result.data.grade).toBe("B");

      // Grade A: score >= 7
      endpoint = makeEndpoint({
        "cache-control": "public, max-age=3600",
        "etag": '"abc"',
        "last-modified": "Wed, 21 Oct 2023 07:28:00 GMT",
        "vary": "Accept-Encoding",
        "pragma": "no-cache",
      });
      result = await check.run(endpoint, "example.com");
      expect(result.data.grade).toBe("A");
    });
  });

  describe("vary header parsing", () => {
    it("splits vary header into array", async () => {
      const endpoint = makeEndpoint({
        "vary": "Accept-Encoding, Accept-Language",
      });
      const result = await check.run(endpoint, "example.com");
      expect(result.data.vary).toEqual(["Accept-Encoding", "Accept-Language"]);
    });

    it("trims whitespace from vary values", async () => {
      const endpoint = makeEndpoint({
        "vary": "  Accept-Encoding  ,  Accept-Language  ",
      });
      const result = await check.run(endpoint, "example.com");
      expect(result.data.vary).toEqual(["Accept-Encoding", "Accept-Language"]);
    });

    it("returns empty array when vary is absent", async () => {
      const endpoint = makeEndpoint();
      const result = await check.run(endpoint, "example.com");
      expect(result.data.vary).toEqual([]);
    });
  });

  describe("other headers", () => {
    it("captures age header as number", async () => {
      const endpoint = makeEndpoint({
        "age": "3600",
      });
      const result = await check.run(endpoint, "example.com");
      expect(result.data.age).toBe(3600);
    });

    it("sets age to null when absent", async () => {
      const endpoint = makeEndpoint();
      const result = await check.run(endpoint, "example.com");
      expect(result.data.age).toBeNull();
    });

    it("captures expires header", async () => {
      const endpoint = makeEndpoint({
        "expires": "Wed, 21 Oct 2025 07:28:00 GMT",
      });
      const result = await check.run(endpoint, "example.com");
      expect(result.data.expires).toBe("Wed, 21 Oct 2025 07:28:00 GMT");
    });

    it("captures pragma header", async () => {
      const endpoint = makeEndpoint({
        "pragma": "no-cache",
      });
      const result = await check.run(endpoint, "example.com");
      expect(result.data.pragma).toBe("no-cache");
    });

    it("captures last-modified as boolean", async () => {
      const endpoint = makeEndpoint({
        "last-modified": "Wed, 21 Oct 2023 07:28:00 GMT",
      });
      const result = await check.run(endpoint, "example.com");
      expect(result.data.lastModified).toBe(true);
    });
  });

  it("handles max-age of 0", async () => {
    const endpoint = makeEndpoint({
      "cache-control": "max-age=0",
    });
    const result = await check.run(endpoint, "example.com");
    expect(result.data.maxAge).toBe(0);
    expect(result.data.score).toBe(2); // cache-control only, max-age=0 doesn't add points
  });

  it("handles all defaults when headers are null", async () => {
    const endpoint = makeEndpoint();
    const result = await check.run(endpoint, "example.com");
    expect(result.data).toEqual({
      cacheControl: null,
      etag: false,
      lastModified: false,
      vary: [],
      age: null,
      expires: null,
      pragma: null,
      maxAge: null,
      sMaxAge: null,
      noCache: false,
      noStore: false,
      isPublic: false,
      isPrivate: false,
      mustRevalidate: false,
      immutable: false,
      score: 0,
      grade: "F",
    });
  });
});
