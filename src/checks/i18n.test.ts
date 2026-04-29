import { describe, it, expect } from "vitest";
import { I18nCheck } from "./i18n.js";
import type { EndpointData } from "../types.js";

function makeEndpoint(
  body: string,
  headers?: Record<string, string>,
): EndpointData {
  return {
    url: "https://example.com",
    statusCode: 200,
    headers: headers ?? { "content-type": "text/html" },
    body,
    redirectChain: [],
  };
}

describe("I18nCheck", () => {
  const check = new I18nCheck();

  it("has the correct name", () => {
    expect(check.name).toBe("i18n");
  });

  it("detects lang attribute and charset declaration", async () => {
    const html = `
      <html lang="en">
      <head>
        <meta charset="utf-8">
      </head>
      <body>
        <h1>Hello World</h1>
      </body>
      </html>
    `;
    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.name).toBe("i18n");
    expect(result.data.htmlLang).toBe("en");
    expect(result.data.charset).toBe("utf-8");
    expect(result.data.contentLanguage).toBeNull();
    expect(result.data.dir).toBeNull();
  });

  it("detects multilingual sites with hreflangs", async () => {
    const html = `
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <link rel="alternate" hreflang="es" href="https://example.com/es">
        <link rel="alternate" hreflang="fr" href="https://example.com/fr">
        <link rel="alternate" hreflang="x-default" href="https://example.com">
      </head>
      <body>
        <h1>Hello World</h1>
      </body>
      </html>
    `;
    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.htmlLang).toBe("en");
    expect(result.data.charset).toBe("utf-8");

    const hreflangs = result.data.hreflangs as Array<{
      lang: string;
      href: string;
    }>;
    expect(hreflangs).toHaveLength(3);
    expect(hreflangs.map((h) => h.lang)).toEqual(
      expect.arrayContaining(["es", "fr", "x-default"]),
    );

    expect(result.data.languageCount).toBe(2);
    expect(result.data.hasXDefault).toBe(true);
    expect(result.data.multilingual).toBe(true);
  });

  it("handles sites with no i18n configuration", async () => {
    const html = `
      <html>
      <head>
        <title>Page</title>
      </head>
      <body>
        <h1>Hello World</h1>
      </body>
      </html>
    `;
    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.htmlLang).toBeNull();
    expect(result.data.charset).toBeNull();
    expect(result.data.contentLanguage).toBeNull();
    expect(result.data.dir).toBeNull();
    expect(result.data.hreflangs).toEqual([]);
    expect(result.data.languageCount).toBe(0);
    expect(result.data.hasXDefault).toBe(false);
    expect(result.data.multilingual).toBe(false);
  });

  it("detects RTL dir attribute", async () => {
    const html = `
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="utf-8">
      </head>
      <body>
        <h1>مرحبا بالعالم</h1>
      </body>
      </html>
    `;
    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.htmlLang).toBe("ar");
    expect(result.data.dir).toBe("rtl");
    expect(result.data.charset).toBe("utf-8");
  });

  it("detects content-language header", async () => {
    const html = `
      <html lang="en">
      <body><h1>Hello</h1></body>
      </html>
    `;
    const result = await check.run(
      makeEndpoint(html, {
        "content-type": "text/html",
        "content-language": "en-US",
      }),
      "example.com",
    );

    expect(result.data.contentLanguage).toBe("en-US");
  });

  it("detects charset from Content-Type header", async () => {
    const html = `
      <html lang="en">
      <body><h1>Hello</h1></body>
      </html>
    `;
    const result = await check.run(
      makeEndpoint(html, {
        "content-type": "text/html; charset=iso-8859-1",
      }),
      "example.com",
    );

    expect(result.data.charset).toBe("iso-8859-1");
  });

  it("prefers meta charset over header charset", async () => {
    const html = `
      <html lang="en">
      <head>
        <meta charset="utf-8">
      </head>
      <body><h1>Hello</h1></body>
      </html>
    `;
    const result = await check.run(
      makeEndpoint(html, {
        "content-type": "text/html; charset=iso-8859-1",
      }),
      "example.com",
    );

    expect(result.data.charset).toBe("utf-8");
  });

  it("handles hreflangs with reversed attribute order", async () => {
    const html = `
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <link href="https://example.com/es" hreflang="es" rel="alternate">
        <link href="https://example.com/fr" rel="alternate" hreflang="fr">
      </head>
      <body>
        <h1>Hello World</h1>
      </body>
      </html>
    `;
    const result = await check.run(makeEndpoint(html), "example.com");

    const hreflangs = result.data.hreflangs as Array<{
      lang: string;
      href: string;
    }>;
    expect(hreflangs.length).toBeGreaterThanOrEqual(2);
    expect(hreflangs.map((h) => h.lang)).toEqual(
      expect.arrayContaining(["es", "fr"]),
    );
  });

  it("detects http-equiv charset declaration", async () => {
    const html = `
      <html lang="en">
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
      </head>
      <body><h1>Hello</h1></body>
      </html>
    `;
    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.htmlLang).toBe("en");
    expect(result.data.charset).toBe("utf-8");
  });

  it("handles empty document", async () => {
    const result = await check.run(makeEndpoint(""), "example.com");

    expect(result.data.htmlLang).toBeNull();
    expect(result.data.charset).toBeNull();
    expect(result.data.contentLanguage).toBeNull();
    expect(result.data.dir).toBeNull();
    expect(result.data.hreflangs).toEqual([]);
    expect(result.data.languageCount).toBe(0);
    expect(result.data.hasXDefault).toBe(false);
    expect(result.data.multilingual).toBe(false);
  });

  it("detects lang as multilingual when hreflangs present but not x-default", async () => {
    const html = `
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <link rel="alternate" hreflang="en" href="https://example.com/en">
      </head>
      <body>
        <h1>Hello World</h1>
      </body>
      </html>
    `;
    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.multilingual).toBe(true);
    expect(result.data.languageCount).toBe(1);
    expect(result.data.hasXDefault).toBe(false);
  });

  it("handles case-insensitive lang attribute", async () => {
    const html = `
      <HTML LANG="FR">
      <BODY><H1>Bonjour</H1></BODY>
      </HTML>
    `;
    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.htmlLang).toBe("FR");
  });

  it("handles lang attribute without quotes", async () => {
    const html = `
      <html lang=en>
      <body><h1>Hello</h1></body>
      </html>
    `;
    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.htmlLang).toBe("en");
  });

  it("handles dir attribute case insensitivity", async () => {
    const html = `
      <html lang="ar" dir="RTL">
      <body><h1>مرحبا</h1></body>
      </html>
    `;
    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.dir).toBe("rtl");
  });
});
