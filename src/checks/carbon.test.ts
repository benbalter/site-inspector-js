import { describe, it, expect, vi } from "vitest";
import { CarbonCheck } from "./carbon.js";
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

  describe("CO2 estimate", () => {
    // Values from @tgwf/co2 0.19.0's Sustainable Web Design v4 model.
    it("estimates grams of CO2 per view of the HTML document", async () => {
      const html = "x".repeat(1000);

      const result = await check.run(makeEndpoint(html), "example.com");

      expect(result.data.co2Model).toBe("swd-v4");
      expect(result.data.co2Scope).toBe("html");
      expect(result.data.co2GramsPerView).toBe(0.000148);
      expect(result.data.co2GramsPerViewGreenHosting).toBe(0.000121);
      expect(result.data.co2Error).toBeNull();
    });

    it("scales with the document size", async () => {
      const result = await check.run(makeEndpoint("x".repeat(51234)), "example.com");

      expect(result.data.co2GramsPerView).toBe(0.00759);
      expect(result.data.co2GramsPerViewGreenHosting).toBe(0.0062);
    });

    it("estimates zero for an empty body", async () => {
      const result = await check.run(makeEndpoint(""), "example.com");

      expect(result.data.co2GramsPerView).toBe(0);
      expect(result.data.co2GramsPerViewGreenHosting).toBe(0);
    });

    it("reports null, not zero, when CO2.js can't be loaded", async () => {
      vi.resetModules();
      vi.doMock("@tgwf/co2", () => {
        throw new Error("Cannot find package '@tgwf/co2'");
      });
      try {
        const { CarbonCheck: Fresh } = await import("./carbon.js");

        const result = await new Fresh().run(makeEndpoint("<html></html>"), "example.com");

        expect(result.data.htmlSize).toBe(13);
        expect(result.data.co2GramsPerView).toBeNull();
        expect(result.data.co2GramsPerViewGreenHosting).toBeNull();
        expect(result.data.co2Error).toEqual(expect.any(String));
      } finally {
        vi.doUnmock("@tgwf/co2");
        vi.resetModules();
      }
    });
  });
});
