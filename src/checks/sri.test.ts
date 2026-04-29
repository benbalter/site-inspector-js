import { describe, it, expect } from "vitest";
import { SriCheck } from "./sri.js";
import type { EndpointData } from "../types.js";

function makeEndpoint(body: string): EndpointData {
  return {
    url: "https://example.com/",
    statusCode: 200,
    headers: {},
    body,
    redirectChain: [],
  };
}

describe("SriCheck", () => {
  const check = new SriCheck();

  it("has the name 'sri'", () => {
    expect(check.name).toBe("sri");
  });

  it("reports 100% when all external resources have SRI", async () => {
    const html = `<html><head>
      <script src="https://cdn.example.com/app.js" integrity="sha384-abc123" crossorigin="anonymous"></script>
      <link rel="stylesheet" href="https://cdn.example.com/style.css" integrity="sha384-def456" crossorigin="anonymous">
    </head></html>`;

    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.totalExternalScripts).toBe(1);
    expect(result.data.scriptsWithSri).toBe(1);
    expect(result.data.scriptsWithoutSri).toEqual([]);
    expect(result.data.totalExternalStylesheets).toBe(1);
    expect(result.data.stylesheetsWithSri).toBe(1);
    expect(result.data.stylesheetsWithoutSri).toEqual([]);
    expect(result.data.coverage).toBe(100);
  });

  it("reports mixed coverage when some resources lack SRI", async () => {
    const html = `<html><head>
      <script src="https://cdn.example.com/a.js" integrity="sha384-abc"></script>
      <script src="https://cdn.example.com/b.js"></script>
      <link rel="stylesheet" href="https://cdn.example.com/ok.css" integrity="sha384-xyz">
      <link rel="stylesheet" href="https://cdn.example.com/bad.css">
    </head></html>`;

    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.totalExternalScripts).toBe(2);
    expect(result.data.scriptsWithSri).toBe(1);
    expect(result.data.scriptsWithoutSri).toEqual(["https://cdn.example.com/b.js"]);
    expect(result.data.totalExternalStylesheets).toBe(2);
    expect(result.data.stylesheetsWithSri).toBe(1);
    expect(result.data.stylesheetsWithoutSri).toEqual(["https://cdn.example.com/bad.css"]);
    expect(result.data.totalExternal).toBe(4);
    expect(result.data.totalWithSri).toBe(2);
    expect(result.data.coverage).toBe(50);
  });

  it("returns 100% coverage when there are no external resources", async () => {
    const html = `<html><head><title>Hello</title></head><body></body></html>`;

    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.totalExternal).toBe(0);
    expect(result.data.coverage).toBe(100);
  });

  it("ignores internal scripts and stylesheets", async () => {
    const html = `<html><head>
      <script src="/js/app.js"></script>
      <script src="main.js"></script>
      <link rel="stylesheet" href="/css/style.css">
      <link rel="stylesheet" href="local.css">
    </head></html>`;

    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.totalExternalScripts).toBe(0);
    expect(result.data.totalExternalStylesheets).toBe(0);
    expect(result.data.totalExternal).toBe(0);
    expect(result.data.coverage).toBe(100);
  });

  it("counts protocol-relative URLs as external", async () => {
    const html = `<html><head>
      <script src="//cdn.example.com/proto.js"></script>
      <link rel="stylesheet" href="//cdn.example.com/proto.css">
    </head></html>`;

    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.totalExternalScripts).toBe(1);
    expect(result.data.scriptsWithoutSri).toEqual(["//cdn.example.com/proto.js"]);
    expect(result.data.totalExternalStylesheets).toBe(1);
    expect(result.data.stylesheetsWithoutSri).toEqual(["//cdn.example.com/proto.css"]);
    expect(result.data.coverage).toBe(0);
  });

  it("handles link tags with href before rel", async () => {
    const html = `<html><head>
      <link href="https://cdn.example.com/reversed.css" rel="stylesheet" integrity="sha256-abc">
    </head></html>`;

    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.totalExternalStylesheets).toBe(1);
    expect(result.data.stylesheetsWithSri).toBe(1);
    expect(result.data.coverage).toBe(100);
  });
});
