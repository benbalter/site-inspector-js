import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CarbonCheck } from "./carbon.js";
import { stubFetch } from "../testing/fetch-stub.js";
import type { EndpointData } from "../types.js";

function makeEndpoint(body: string): EndpointData {
  return {
    url: "https://example.com/",
    statusCode: 200,
    headers: {},
    body,
    finalUrl: "https://example.com/",
    setCookies: [],
    redirectChain: [],
  };
}

describe("CarbonCheck", () => {
  const check = new CarbonCheck();

  beforeEach(() => {
    // No routes: the greencheck lookup fails unless a test adds one.
    stubFetch({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has the name 'carbon'", () => {
    expect(check.name).toBe("carbon");
  });

  it("analyzes a rich HTML page with many resources", async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="/css/main.css">
  <link rel="stylesheet" href="/css/theme.css">
  <script src="/js/app.js"></script>
  <script src="/js/vendor.js"></script>
  <script src="/js/analytics.js"></script>
  <style>body { margin: 0; }</style>
  <style>.header { color: red; }</style>
  <script>console.log("init");</script>
</head>
<body>
  <img src="/img/hero.png">
  <img src="/img/logo.svg">
  <img src="/img/banner.jpg">
  <img src="/img/icon.png">
  <iframe src="https://www.youtube.com/embed/abc"></iframe>
  <iframe src="https://maps.google.com/embed"></iframe>
  <script>var x = 1;</script>
</body>
</html>`;

    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.name).toBe("carbon");
    expect(result.data.htmlSize).toBe(Buffer.byteLength(html, "utf8"));
    expect(result.data.htmlSizeKb).toBe(
      Math.round((Buffer.byteLength(html, "utf8") / 1024) * 10) / 10,
    );
    expect(result.data.externalScripts).toBe(3);
    expect(result.data.externalStylesheets).toBe(2);
    expect(result.data.images).toBe(4);
    expect(result.data.iframes).toBe(2);
    expect(result.data.totalExternalResources).toBe(11);
    expect(result.data.inlineScripts).toBe(2);
    expect(result.data.inlineStyles).toBe(2);
  });

  it("analyzes a minimal HTML page", async () => {
    const html = "<html><body>Hello</body></html>";

    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.htmlSize).toBe(Buffer.byteLength(html, "utf8"));
    expect(result.data.externalScripts).toBe(0);
    expect(result.data.externalStylesheets).toBe(0);
    expect(result.data.images).toBe(0);
    expect(result.data.iframes).toBe(0);
    expect(result.data.totalExternalResources).toBe(0);
    expect(result.data.inlineScripts).toBe(0);
    expect(result.data.inlineStyles).toBe(0);
    expect(result.data.inlineScriptSize).toBe(0);
    expect(result.data.inlineStyleSize).toBe(0);
  });

  it("handles an empty body", async () => {
    const result = await check.run(makeEndpoint(""), "example.com");

    expect(result.data.htmlSize).toBe(0);
    expect(result.data.htmlSizeKb).toBe(0);
    expect(result.data.externalScripts).toBe(0);
    expect(result.data.externalStylesheets).toBe(0);
    expect(result.data.images).toBe(0);
    expect(result.data.iframes).toBe(0);
    expect(result.data.totalExternalResources).toBe(0);
    expect(result.data.inlineScripts).toBe(0);
    expect(result.data.inlineStyles).toBe(0);
    expect(result.data.inlineScriptSize).toBe(0);
    expect(result.data.inlineStyleSize).toBe(0);
  });

  it("calculates inline script and style sizes correctly", async () => {
    const scriptContent = 'var a = "hello";';
    const styleContent = "body { color: red; }";
    const html = `<html><head><script>${scriptContent}</script><style>${styleContent}</style></head><body></body></html>`;

    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.inlineScripts).toBe(1);
    expect(result.data.inlineStyles).toBe(1);
    expect(result.data.inlineScriptSize).toBe(scriptContent.length);
    expect(result.data.inlineStyleSize).toBe(styleContent.length);
  });

  it("does not count script tags with src as inline", async () => {
    const html = `<html><head><script src="/app.js"></script><script>inline();</script></head></html>`;

    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.externalScripts).toBe(1);
    expect(result.data.inlineScripts).toBe(1);
    expect(result.data.inlineScriptSize).toBe("inline();".length);
  });

  describe("green hosting", () => {
    const GREENCHECK = "https://api.thegreenwebfoundation.org/api/v3/greencheck/example.com";

    it("reports a green host and who hosts it", async () => {
      // Trimmed from a real greencheck response.
      stubFetch({
        [GREENCHECK]: {
          body: JSON.stringify({
            url: "example.com",
            hosted_by: "Cloudflare",
            hosted_by_website: "https://www.cloudflare.com",
            listed_provider: true,
            green: true,
          }),
        },
      });
      const result = await check.run(makeEndpoint(""), "example.com");
      expect(result.data.greenHosting).toBe(true);
      expect(result.data.hostedBy).toBe("Cloudflare");
    });

    it("reports a host the Green Web Foundation doesn't know as not green", async () => {
      stubFetch({
        [GREENCHECK]: { body: JSON.stringify({ green: false, url: null, data: false }) },
      });
      const result = await check.run(makeEndpoint(""), "example.com");
      expect(result.data.greenHosting).toBe(false);
      expect(result.data.hostedBy).toBeNull();
    });

    it("reports null when the lookup fails", async () => {
      const result = await check.run(makeEndpoint(""), "example.com");
      expect(result.data.greenHosting).toBeNull();
      expect(result.data.hostedBy).toBeNull();
    });

    it("checks the host the page was served from, after redirects", async () => {
      const fetchSpy = stubFetch({});
      await check.run(
        { ...makeEndpoint(""), finalUrl: "https://www.example.org/home" },
        "example.com",
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.thegreenwebfoundation.org/api/v3/greencheck/www.example.org",
        expect.anything(),
      );
    });
  });
});
