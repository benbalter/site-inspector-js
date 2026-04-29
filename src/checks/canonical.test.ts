import { describe, it, expect } from "vitest";
import type { EndpointData } from "../types.js";
import { CanonicalCheck } from "./canonical.js";

function makeEndpoint(
  body: string,
  url: string = "https://example.com/page",
  headers: Record<string, string> = {},
): EndpointData {
  return {
    url,
    statusCode: 200,
    headers,
    body,
    redirectChain: [],
  };
}

describe("CanonicalCheck", () => {
  const check = new CanonicalCheck();

  it("has the name 'canonical'", () => {
    expect(check.name).toBe("canonical");
  });

  it("extracts canonical from HTML link tag", async () => {
    const body = '<link rel="canonical" href="https://example.com/canonical">';
    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.name).toBe("canonical");
    expect(result.data.canonical).toBe("https://example.com/canonical");
    expect(result.data.source).toBe("html");
    expect(result.data.selfReferential).toBe(false);
    expect(result.data.noindex).toBe(false);
    expect(result.data.conflict).toBe(false);
  });

  it("detects self-referential canonical", async () => {
    const url = "https://example.com/page";
    const body = `<link rel="canonical" href="${url}">`;
    const result = await check.run(makeEndpoint(body, url), "example.com");

    expect(result.data.canonical).toBe(url);
    expect(result.data.selfReferential).toBe(true);
    expect(result.data.conflict).toBe(false);
  });

  it("handles canonical with different attribute order", async () => {
    const body = '<link href="https://example.com/page1" rel="canonical">';
    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.canonical).toBe("https://example.com/page1");
    expect(result.data.source).toBe("html");
  });

  it("returns null canonical when not present", async () => {
    const body = "<html><body>No canonical here</body></html>";
    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.canonical).toBeNull();
    expect(result.data.source).toBeNull();
    expect(result.data.selfReferential).toBe(false);
    expect(result.data.conflict).toBe(false);
  });

  it("extracts canonical from HTTP Link header", async () => {
    const body = "<html></html>";
    const headers = { link: '<https://example.com/canonical>; rel="canonical"' };
    const result = await check.run(
      makeEndpoint(body, "https://example.com/page", headers),
      "example.com",
    );

    expect(result.data.canonical).toBe("https://example.com/canonical");
    expect(result.data.source).toBe("http-header");
  });

  it("prefers HTML canonical over HTTP Link header", async () => {
    const body = '<link rel="canonical" href="https://example.com/html-canonical">';
    const headers = { link: '<https://example.com/header-canonical>; rel="canonical"' };
    const result = await check.run(
      makeEndpoint(body, "https://example.com/page", headers),
      "example.com",
    );

    expect(result.data.canonical).toBe("https://example.com/html-canonical");
    expect(result.data.source).toBe("html");
  });

  it("detects conflict between canonical and noindex", async () => {
    const body = `
      <link rel="canonical" href="https://example.com/other">
      <meta name="robots" content="noindex">
    `;
    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.canonical).toBe("https://example.com/other");
    expect(result.data.noindex).toBe(true);
    expect(result.data.conflict).toBe(true);
  });

  it("does not mark conflict when only canonical present", async () => {
    const body = '<link rel="canonical" href="https://example.com/other">';
    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.canonical).toBe("https://example.com/other");
    expect(result.data.noindex).toBe(false);
    expect(result.data.conflict).toBe(false);
  });

  it("does not mark conflict when only noindex present", async () => {
    const body = '<meta name="robots" content="noindex">';
    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.canonical).toBeNull();
    expect(result.data.noindex).toBe(true);
    expect(result.data.conflict).toBe(false);
  });

  it("detects noindex from meta robots tag with reversed attribute order", async () => {
    const body = '<meta content="noindex" name="robots">';
    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.noindex).toBe(true);
  });

  it("detects noindex with follow directive", async () => {
    const body = '<meta name="robots" content="noindex, follow">';
    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.noindex).toBe(true);
  });

  it("handles empty body gracefully", async () => {
    const result = await check.run(makeEndpoint(""), "example.com");

    expect(result.data.canonical).toBeNull();
    expect(result.data.noindex).toBe(false);
    expect(result.data.selfReferential).toBe(false);
    expect(result.data.conflict).toBe(false);
  });

  it("handles relative canonical URLs", async () => {
    const url = "https://example.com/page";
    const body = '<link rel="canonical" href="/canonical">';
    const result = await check.run(makeEndpoint(body, url), "example.com");

    expect(result.data.canonical).toBe("/canonical");
    expect(result.data.selfReferential).toBe(false);
  });

  it("handles canonical on different domain", async () => {
    const url = "https://example.com/page";
    const body = '<link rel="canonical" href="https://other.com/page">';
    const result = await check.run(makeEndpoint(body, url), "example.com");

    expect(result.data.canonical).toBe("https://other.com/page");
    expect(result.data.selfReferential).toBe(false);
  });

  it("handles invalid canonical URL gracefully", async () => {
    const url = "https://example.com/page";
    const body = '<link rel="canonical" href="not a valid url">';
    const result = await check.run(makeEndpoint(body, url), "example.com");

    expect(result.data.canonical).toBe("not a valid url");
    expect(result.data.selfReferential).toBe(false);
  });

  it("returns structured result with all expected fields", async () => {
    const body = '<link rel="canonical" href="https://example.com/page">';
    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result).toHaveProperty("name");
    expect(result).toHaveProperty("data");
    expect(result.data).toHaveProperty("canonical");
    expect(result.data).toHaveProperty("source");
    expect(result.data).toHaveProperty("selfReferential");
    expect(result.data).toHaveProperty("noindex");
    expect(result.data).toHaveProperty("conflict");
  });
});
