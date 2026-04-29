import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EndpointData } from "../types.js";
import { FaviconCheck } from "./favicon.js";

function makeEndpoint(
  body: string,
  url: string = "https://example.com/page",
): EndpointData {
  return {
    url,
    statusCode: 200,
    headers: {},
    body,
    redirectChain: [],
  };
}

describe("FaviconCheck", () => {
  const check = new FaviconCheck();
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has the name 'favicon'", () => {
    expect(check.name).toBe("favicon");
  });

  it("detects favicon.ico present + HTML icons", async () => {
    const body =
      '<link rel="icon" href="/favicon.png" type="image/png"><link rel="apple-touch-icon" href="/apple.png">';
    fetchSpy.mockResolvedValue({ status: 200 });

    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.name).toBe("favicon");
    expect(result.data.faviconIco).toBe(true);
    expect(result.data.icons).toBe(2);
    expect(result.data.present).toBe(true);
    expect(result.data.hasAppleTouchIcon).toBe(true);
    expect(result.data.hasSvgIcon).toBe(false);
    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/favicon.ico", {
      method: "HEAD",
      signal: expect.any(AbortSignal),
      redirect: "follow",
    });
  });

  it("detects only HTML icons (no /favicon.ico)", async () => {
    const body =
      '<link rel="icon" href="/favicon.png" type="image/png"><link rel="icon" href="/favicon-32x32.png">';
    fetchSpy.mockResolvedValue({ status: 404 });

    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.faviconIco).toBe(false);
    expect(result.data.icons).toBe(2);
    expect(result.data.present).toBe(true);
    expect(result.data.hasAppleTouchIcon).toBe(false);
  });

  it("detects only /favicon.ico (no HTML icons)", async () => {
    const body = "<html></html>";
    fetchSpy.mockResolvedValue({ status: 200 });

    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.faviconIco).toBe(true);
    expect(result.data.icons).toBe(0);
    expect(result.data.present).toBe(true);
    expect(result.data.hasAppleTouchIcon).toBe(false);
  });

  it("detects SVG icon", async () => {
    const body =
      '<link rel="icon" href="/favicon.svg" type="image/svg+xml">';
    fetchSpy.mockResolvedValue({ status: 404 });

    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.hasSvgIcon).toBe(true);
    expect(result.data.icons).toBe(1);
  });

  it("detects SVG icon by file extension", async () => {
    const body = '<link rel="icon" href="/favicon.svg">';
    fetchSpy.mockResolvedValue({ status: 404 });

    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.hasSvgIcon).toBe(true);
  });

  it("detects apple-touch-icon", async () => {
    const body = '<link rel="apple-touch-icon" href="/apple-touch-icon.png">';
    fetchSpy.mockResolvedValue({ status: 404 });

    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.hasAppleTouchIcon).toBe(true);
    expect(result.data.icons).toBe(1);
  });

  it("extracts sizes from link tags", async () => {
    const body =
      '<link rel="icon" href="/icon-16x16.png" sizes="16x16"><link rel="icon" href="/icon-32x32.png" sizes="32x32">';
    fetchSpy.mockResolvedValue({ status: 404 });

    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.sizes).toEqual(["16x16", "32x32"]);
  });

  it("handles no favicons at all", async () => {
    const body = "<html><body>No favicons</body></html>";
    fetchSpy.mockResolvedValue({ status: 404 });

    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.faviconIco).toBe(false);
    expect(result.data.icons).toBe(0);
    expect(result.data.present).toBe(false);
    expect(result.data.hasAppleTouchIcon).toBe(false);
    expect(result.data.hasSvgIcon).toBe(false);
    expect(result.data.sizes).toEqual([]);
  });

  it("handles fetch timeout gracefully", async () => {
    const body = "<html></html>";
    fetchSpy.mockRejectedValue(new Error("Aborted"));

    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.faviconIco).toBe(false);
    expect(result.data.icons).toBe(0);
    expect(result.data.present).toBe(false);
  });

  it("handles various link tag formats", async () => {
    const body = `
      <link rel="icon" href="/favicon.png">
      <link rel='icon' href='/favicon.svg' type='image/svg+xml'>
      <link rel=icon href=/favicon.ico>
    `;
    fetchSpy.mockResolvedValue({ status: 404 });

    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.icons).toBe(3);
  });

  it("ignores link tags without rel=icon", async () => {
    const body =
      '<link rel="stylesheet" href="/style.css"><link rel="icon" href="/favicon.png">';
    fetchSpy.mockResolvedValue({ status: 404 });

    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.icons).toBe(1);
  });

  it("handles empty body", async () => {
    const body = "";
    fetchSpy.mockResolvedValue({ status: 404 });

    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.faviconIco).toBe(false);
    expect(result.data.icons).toBe(0);
    expect(result.data.present).toBe(false);
  });

  it("handles missing body gracefully", async () => {
    const endpoint: EndpointData = {
      url: "https://example.com/page",
      statusCode: 200,
      headers: {},
      body: null as unknown as string,
      redirectChain: [],
    };
    fetchSpy.mockResolvedValue({ status: 404 });

    const result = await check.run(endpoint, "example.com");

    expect(result.data.faviconIco).toBe(false);
    expect(result.data.icons).toBe(0);
    expect(result.data.present).toBe(false);
  });

  it("probes favicon.ico on correct origin", async () => {
    const body = "<html></html>";
    const url = "https://subdomain.example.com:8080/page";
    fetchSpy.mockResolvedValue({ status: 200 });

    const result = await check.run(makeEndpoint(body, url), "example.com");

    expect(result.data.faviconIco).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://subdomain.example.com:8080/favicon.ico",
      expect.any(Object),
    );
  });

  it("returns structured result with all expected fields", async () => {
    const body = '<link rel="icon" href="/favicon.png">';
    fetchSpy.mockResolvedValue({ status: 404 });

    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result).toHaveProperty("name");
    expect(result).toHaveProperty("data");
    expect(result.data).toHaveProperty("faviconIco");
    expect(result.data).toHaveProperty("icons");
    expect(result.data).toHaveProperty("hasAppleTouchIcon");
    expect(result.data).toHaveProperty("hasSvgIcon");
    expect(result.data).toHaveProperty("sizes");
    expect(result.data).toHaveProperty("present");
  });

  it("handles type attribute with various formats", async () => {
    const body = `
      <link rel="icon" href="/icon1.png" type="image/png">
      <link rel="icon" href="/icon2.svg" type='image/svg+xml'>
      <link rel="icon" href="/icon3.webp" type=image/webp>
    `;
    fetchSpy.mockResolvedValue({ status: 404 });

    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.icons).toBe(3);
    expect(result.data.hasSvgIcon).toBe(true);
  });
});
