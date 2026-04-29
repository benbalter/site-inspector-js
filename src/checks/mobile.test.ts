import { describe, it, expect } from "vitest";
import { MobileCheck } from "./mobile.js";
import type { EndpointData } from "../types.js";

function makeEndpoint(body: string): EndpointData {
  return {
    url: "https://example.com",
    statusCode: 200,
    headers: { "content-type": "text/html" },
    body,
    redirectChain: [],
  };
}

describe("MobileCheck", () => {
  const check = new MobileCheck();

  it("has the correct name", () => {
    expect(check.name).toBe("mobile");
  });

  it("detects fully mobile-ready page with all tags", async () => {
    const html = `
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="theme-color" content="#FF5722">
        <meta name="apple-mobile-web-app-capable" content="yes">
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
        <link rel="apple-touch-icon" href="/icon.png">
        <link rel="manifest" href="/manifest.json">
      </head>
      <body></body>
      </html>
    `;
    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.name).toBe("mobile");
    expect(result.data.hasViewport).toBe(true);
    expect(result.data.viewport).toBe("width=device-width, initial-scale=1");
    expect(result.data.themeColor).toBe("#FF5722");
    expect(result.data.appleTouchIcon).toBe(true);
    expect(result.data.manifestLink).toBe(true);
    expect(result.data.mobileWebAppCapable).toBe(true);
    expect(result.data.statusBarStyle).toBe("black-translucent");
    expect(result.data.score).toBe(9);
    expect(result.data.grade).toBe("A");
  });

  it("detects minimal mobile support with viewport only", async () => {
    const html = `
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
      </head>
      <body></body>
      </html>
    `;
    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.hasViewport).toBe(true);
    expect(result.data.viewport).toBe("width=device-width, initial-scale=1");
    expect(result.data.themeColor).toBeNull();
    expect(result.data.appleTouchIcon).toBe(false);
    expect(result.data.manifestLink).toBe(false);
    expect(result.data.mobileWebAppCapable).toBe(false);
    expect(result.data.statusBarStyle).toBeNull();
    expect(result.data.score).toBe(3);
    expect(result.data.grade).toBe("C");
  });

  it("returns F grade when no mobile tags present", async () => {
    const html = `
      <html>
      <head>
        <title>Test</title>
      </head>
      <body></body>
      </html>
    `;
    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.hasViewport).toBe(false);
    expect(result.data.viewport).toBeNull();
    expect(result.data.themeColor).toBeNull();
    expect(result.data.appleTouchIcon).toBe(false);
    expect(result.data.manifestLink).toBe(false);
    expect(result.data.mobileWebAppCapable).toBe(false);
    expect(result.data.statusBarStyle).toBeNull();
    expect(result.data.score).toBe(0);
    expect(result.data.grade).toBe("F");
  });

  it("detects apple-specific tags correctly", async () => {
    const html = `
      <html>
      <head>
        <meta name="viewport" content="width=device-width">
        <meta name="apple-mobile-web-app-capable" content="yes">
        <link rel="apple-touch-icon" href="/icon.png">
        <meta name="apple-mobile-web-app-status-bar-style" content="default">
      </head>
      <body></body>
      </html>
    `;
    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.mobileWebAppCapable).toBe(true);
    expect(result.data.appleTouchIcon).toBe(true);
    expect(result.data.statusBarStyle).toBe("default");
    expect(result.data.score).toBe(6);
    expect(result.data.grade).toBe("B");
  });

  it("handles content before name attribute order", async () => {
    const html = `
      <html>
      <head>
        <meta content="width=device-width" name="viewport">
        <meta content="#0088FF" name="theme-color">
      </head>
      <body></body>
      </html>
    `;
    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.viewport).toBe("width=device-width");
    expect(result.data.themeColor).toBe("#0088FF");
    expect(result.data.hasViewport).toBe(true);
  });

  it("handles manifest and theme-color with manifest", async () => {
    const html = `
      <html>
      <head>
        <meta name="viewport" content="width=device-width">
        <meta name="theme-color" content="#333">
        <link rel="manifest" href="/app.json">
      </head>
      <body></body>
      </html>
    `;
    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.manifestLink).toBe(true);
    expect(result.data.themeColor).toBe("#333");
    expect(result.data.score).toBe(6);
    expect(result.data.grade).toBe("B");
  });

  it("handles empty document", async () => {
    const result = await check.run(makeEndpoint(""), "example.com");

    expect(result.data.hasViewport).toBe(false);
    expect(result.data.viewport).toBeNull();
    expect(result.data.themeColor).toBeNull();
    expect(result.data.appleTouchIcon).toBe(false);
    expect(result.data.manifestLink).toBe(false);
    expect(result.data.mobileWebAppCapable).toBe(false);
    expect(result.data.statusBarStyle).toBeNull();
    expect(result.data.score).toBe(0);
    expect(result.data.grade).toBe("F");
  });

  it("returns D grade with minimal score", async () => {
    const html = `
      <html>
      <head>
        <meta name="theme-color" content="#FFF">
      </head>
      <body></body>
      </html>
    `;
    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.score).toBe(1);
    expect(result.data.grade).toBe("D");
  });
});
