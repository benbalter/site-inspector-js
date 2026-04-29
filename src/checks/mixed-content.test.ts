import { describe, it, expect } from "vitest";
import { MixedContentCheck } from "./mixed-content.js";
import type { EndpointData } from "../types.js";

function makeEndpoint(body: string, url = "https://example.com/"): EndpointData {
  return { url, statusCode: 200, headers: {}, body, redirectChain: [] };
}

describe("MixedContentCheck", () => {
  const check = new MixedContentCheck();

  it("has the name 'mixed-content'", () => {
    expect(check.name).toBe("mixed-content");
  });

  it("reports no mixed content on a clean HTTPS page", async () => {
    const html = `<html>
      <head><script src="https://cdn.example.com/app.js"></script></head>
      <body><img src="https://cdn.example.com/logo.png"></body>
    </html>`;

    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.isHttps).toBe(true);
    expect(result.data.hasMixedContent).toBe(false);
    expect(result.data.totalMixedResources).toBe(0);
    expect(result.data.mixedContent).toEqual([]);
    expect(result.data.activeCount).toBe(0);
    expect(result.data.passiveCount).toBe(0);
  });

  it("detects mixed scripts and images on an HTTPS page", async () => {
    const html = `<html>
      <head><script src="http://cdn.example.com/app.js"></script></head>
      <body><img src="http://cdn.example.com/logo.png"></body>
    </html>`;

    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.isHttps).toBe(true);
    expect(result.data.hasMixedContent).toBe(true);
    expect(result.data.totalMixedResources).toBe(2);
    expect(result.data.activeCount).toBe(1);
    expect(result.data.passiveCount).toBe(1);

    const items = result.data.mixedContent as Array<{ url: string; type: string; severity: string }>;
    expect(items).toContainEqual({
      url: "http://cdn.example.com/app.js",
      type: "script",
      severity: "active",
    });
    expect(items).toContainEqual({
      url: "http://cdn.example.com/logo.png",
      type: "image",
      severity: "passive",
    });
  });

  it("skips analysis for HTTP pages", async () => {
    const html = `<html><head><script src="http://cdn.example.com/app.js"></script></head></html>`;

    const result = await check.run(makeEndpoint(html, "http://example.com/"), "example.com");

    expect(result.data.isHttps).toBe(false);
    expect(result.data.hasMixedContent).toBe(false);
    expect(result.data.totalMixedResources).toBe(0);
    expect(result.data.mixedContent).toEqual([]);
  });

  it("detects only passive mixed content (images)", async () => {
    const html = `<html><body>
      <img src="http://images.example.com/a.png">
      <img src="http://images.example.com/b.jpg">
    </body></html>`;

    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.hasMixedContent).toBe(true);
    expect(result.data.totalMixedResources).toBe(2);
    expect(result.data.activeCount).toBe(0);
    expect(result.data.passiveCount).toBe(2);

    const items = result.data.mixedContent as Array<{ type: string; severity: string }>;
    expect(items.every((i) => i.severity === "passive")).toBe(true);
    expect(items.every((i) => i.type === "image")).toBe(true);
  });

  it("classifies active vs passive severity correctly for all types", async () => {
    const html = `<html>
      <head>
        <script src="http://x.com/a.js"></script>
        <link href="http://x.com/style.css">
      </head>
      <body>
        <img src="http://x.com/img.png">
        <iframe src="http://x.com/frame"></iframe>
        <video src="http://x.com/vid.mp4"></video>
        <form action="http://x.com/submit"></form>
        <object data="http://x.com/obj.swf"></object>
      </body>
    </html>`;

    const result = await check.run(makeEndpoint(html), "example.com");
    const items = result.data.mixedContent as Array<{ type: string; severity: string }>;

    expect(result.data.totalMixedResources).toBe(7);
    expect(result.data.activeCount).toBe(5);
    expect(result.data.passiveCount).toBe(2);

    const activeTypes = items.filter((i) => i.severity === "active").map((i) => i.type);
    expect(activeTypes).toContain("script");
    expect(activeTypes).toContain("stylesheet");
    expect(activeTypes).toContain("iframe");
    expect(activeTypes).toContain("form");
    expect(activeTypes).toContain("object");

    const passiveTypes = items.filter((i) => i.severity === "passive").map((i) => i.type);
    expect(passiveTypes).toContain("image");
    expect(passiveTypes).toContain("media");
  });
});
