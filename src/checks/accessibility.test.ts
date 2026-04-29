import { describe, it, expect } from "vitest";
import { AccessibilityCheck } from "./accessibility.js";
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

describe("AccessibilityCheck", () => {
  const check = new AccessibilityCheck();

  it("has the correct name", () => {
    expect(check.name).toBe("accessibility");
  });

  it("detects well-structured HTML", async () => {
    const html = `
      <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
      </head>
      <body>
        <h1>Title</h1>
        <h2>Section</h2>
        <h2>Another Section</h2>
        <h3>Subsection</h3>
        <img src="a.png" alt="A photo">
        <img src="b.png" alt="Another photo">
      </body>
      </html>
    `;
    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.name).toBe("accessibility");
    expect(result.data.htmlLang).toBe(true);
    expect(result.data.langValue).toBe("en");
    expect(result.data.viewport).toBe(true);
    expect(result.data.viewportContent).toBe(
      "width=device-width, initial-scale=1",
    );

    const headings = result.data.headingStructure as {
      hasH1: boolean;
      h1Count: number;
      hierarchy: number[];
      isSequential: boolean;
    };
    expect(headings.hasH1).toBe(true);
    expect(headings.h1Count).toBe(1);
    expect(headings.hierarchy).toEqual([1, 2, 2, 3]);
    expect(headings.isSequential).toBe(true);

    const images = result.data.images as {
      total: number;
      withAlt: number;
      withoutAlt: number;
      altCoverage: number;
    };
    expect(images.total).toBe(2);
    expect(images.withAlt).toBe(2);
    expect(images.withoutAlt).toBe(0);
    expect(images.altCoverage).toBe(100);
  });

  it("handles missing lang attribute", async () => {
    const html = `<html><body><h1>Hello</h1></body></html>`;
    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.htmlLang).toBe(false);
    expect(result.data.langValue).toBeNull();
  });

  it("detects skipped heading levels", async () => {
    const html = `
      <html lang="en">
      <body>
        <h1>Title</h1>
        <h3>Skipped h2</h3>
      </body>
      </html>
    `;
    const result = await check.run(makeEndpoint(html), "example.com");

    const headings = result.data.headingStructure as {
      hasH1: boolean;
      h1Count: number;
      hierarchy: number[];
      isSequential: boolean;
    };
    expect(headings.hierarchy).toEqual([1, 3]);
    expect(headings.isSequential).toBe(false);
  });

  it("detects images without alt attributes", async () => {
    const html = `
      <html lang="en">
      <body>
        <img src="good.png" alt="Description">
        <img src="empty.png" alt="">
        <img src="missing.png">
      </body>
      </html>
    `;
    const result = await check.run(makeEndpoint(html), "example.com");

    const images = result.data.images as {
      total: number;
      withAlt: number;
      withoutAlt: number;
      altCoverage: number;
    };
    expect(images.total).toBe(3);
    expect(images.withAlt).toBe(1);
    expect(images.withoutAlt).toBe(2);
    expect(images.altCoverage).toBe(33);
  });

  it("handles empty document", async () => {
    const result = await check.run(makeEndpoint(""), "example.com");

    expect(result.data.htmlLang).toBe(false);
    expect(result.data.langValue).toBeNull();
    expect(result.data.viewport).toBe(false);
    expect(result.data.viewportContent).toBeNull();

    const headings = result.data.headingStructure as {
      hasH1: boolean;
      h1Count: number;
      hierarchy: number[];
      isSequential: boolean;
    };
    expect(headings.hasH1).toBe(false);
    expect(headings.h1Count).toBe(0);
    expect(headings.hierarchy).toEqual([]);
    expect(headings.isSequential).toBe(true);

    const images = result.data.images as {
      total: number;
      withAlt: number;
      withoutAlt: number;
      altCoverage: number;
    };
    expect(images.total).toBe(0);
    expect(images.altCoverage).toBe(0);
  });

  it("detects viewport with content before name", async () => {
    const html = `
      <html lang="en">
      <head>
        <meta content="width=device-width" name="viewport">
      </head>
      <body></body>
      </html>
    `;
    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.viewport).toBe(true);
    expect(result.data.viewportContent).toBe("width=device-width");
  });
});
