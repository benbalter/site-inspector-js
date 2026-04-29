import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContentCheck } from "./content.js";
import type { EndpointData } from "../types.js";

function makeEndpoint(body: string, url = "https://example.com/"): EndpointData {
  return {
    url,
    statusCode: 200,
    headers: {},
    body,
    redirectChain: [],
  };
}

describe("ContentCheck", () => {
  const check = new ContentCheck();
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ status: 404 });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("has the name 'content'", () => {
    expect(check.name).toBe("content");
  });

  it("extracts all meta tags when present", async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>My Page</title>
  <meta name="description" content="A great page">
  <meta name="generator" content="WordPress 6.0">
</head>
<body></body>
</html>`;

    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.doctype).toBe("html");
    expect(result.data.title).toBe("My Page");
    expect(result.data.description).toBe("A great page");
    expect(result.data.generator).toBe("WordPress 6.0");
  });

  it("returns null when meta tags are absent", async () => {
    const html = "<html><body>Hello</body></html>";

    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.doctype).toBeNull();
    expect(result.data.title).toBeNull();
    expect(result.data.description).toBeNull();
    expect(result.data.generator).toBeNull();
  });

  it("handles meta tags with content before name", async () => {
    const html = `<!doctype html>
<html>
<head>
  <meta content="Reversed description" name="description">
  <meta content="Hugo 0.100" name="generator">
</head>
</html>`;

    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.description).toBe("Reversed description");
    expect(result.data.generator).toBe("Hugo 0.100");
  });

  it("detects robots.txt when present", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("robots.txt")) return { status: 200 };
      return { status: 404 };
    });

    const result = await check.run(makeEndpoint("<html></html>"), "example.com");

    expect(result.data.robotsTxt).toBe(true);
    expect(result.data.sitemapXml).toBe(false);
  });

  it("detects sitemap.xml when present", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("sitemap.xml")) return { status: 200 };
      return { status: 404 };
    });

    const result = await check.run(makeEndpoint("<html></html>"), "example.com");

    expect(result.data.robotsTxt).toBe(false);
    expect(result.data.sitemapXml).toBe(true);
  });

  it("returns false for robots/sitemap when fetch throws", async () => {
    fetchMock.mockRejectedValue(new Error("Network error"));

    const result = await check.run(makeEndpoint("<html></html>"), "example.com");

    expect(result.data.robotsTxt).toBe(false);
    expect(result.data.sitemapXml).toBe(false);
  });

  it("passes AbortSignal and follows redirects", async () => {
    fetchMock.mockResolvedValue({ status: 200 });

    await check.run(makeEndpoint("<html></html>", "https://test.org/"), "test.org");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://test.org/robots.txt",
      expect.objectContaining({ signal: expect.any(AbortSignal), redirect: "follow" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://test.org/sitemap.xml",
      expect.objectContaining({ signal: expect.any(AbortSignal), redirect: "follow" }),
    );
  });
});
