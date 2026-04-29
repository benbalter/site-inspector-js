import { describe, it, expect } from "vitest";
import { StructuredDataCheck } from "./structured-data.js";
import type { EndpointData } from "../types.js";

function makeEndpoint(body: string): EndpointData {
  return {
    url: "https://example.com",
    statusCode: 200,
    headers: {},
    body,
    redirectChain: [],
  };
}

describe("StructuredDataCheck", () => {
  const check = new StructuredDataCheck();

  it("detects a single JSON-LD block (Organization)", async () => {
    const body = `<html><head>
      <script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>
    </head><body></body></html>`;
    const result = await check.run(makeEndpoint(body), "example.com");
    expect(result.data).toMatchObject({
      hasJsonLd: true,
      jsonLdCount: 1,
      schemas: [{ type: "Organization", name: "Acme" }],
      parseErrors: 0,
    });
  });

  it("detects multiple JSON-LD blocks", async () => {
    const body = `<html><head>
      <script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>
      <script type="application/ld+json">{"@type":"WebSite","name":"Acme Site"}</script>
    </head><body></body></html>`;
    const result = await check.run(makeEndpoint(body), "example.com");
    expect(result.data).toMatchObject({
      hasJsonLd: true,
      jsonLdCount: 2,
      schemas: [
        { type: "Organization", name: "Acme" },
        { type: "WebSite", name: "Acme Site" },
      ],
      parseErrors: 0,
    });
  });

  it("handles JSON-LD array (multiple items in one script tag)", async () => {
    const body = `<html><head>
      <script type="application/ld+json">[
        {"@type":"Organization","name":"Acme"},
        {"@type":"Person","name":"Jane"}
      ]</script>
    </head><body></body></html>`;
    const result = await check.run(makeEndpoint(body), "example.com");
    expect(result.data).toMatchObject({
      hasJsonLd: true,
      jsonLdCount: 2,
      schemas: [
        { type: "Organization", name: "Acme" },
        { type: "Person", name: "Jane" },
      ],
      parseErrors: 0,
    });
  });

  it("counts parse errors for malformed JSON-LD", async () => {
    const body = `<html><head>
      <script type="application/ld+json">{not valid json</script>
    </head><body></body></html>`;
    const result = await check.run(makeEndpoint(body), "example.com");
    expect(result.data).toMatchObject({
      hasJsonLd: false,
      jsonLdCount: 0,
      schemas: [],
      parseErrors: 1,
    });
  });

  it("returns defaults for page with no structured data", async () => {
    const body = `<html><head><title>Hello</title></head><body></body></html>`;
    const result = await check.run(makeEndpoint(body), "example.com");
    expect(result.data).toMatchObject({
      hasJsonLd: false,
      jsonLdCount: 0,
      schemas: [],
      parseErrors: 0,
      hasOpenSearch: false,
      hasMicrodata: false,
    });
  });

  it("detects OpenSearch link", async () => {
    const body = `<html><head>
      <link rel="search" type="application/opensearchdescription+xml" href="/search.xml">
    </head><body></body></html>`;
    const result = await check.run(makeEndpoint(body), "example.com");
    expect(result.data).toMatchObject({ hasOpenSearch: true });
  });

  it("detects microdata attributes", async () => {
    const body = `<html><body>
      <div itemscope itemtype="http://schema.org/Person">
        <span itemprop="name">Jane</span>
      </div>
    </body></html>`;
    const result = await check.run(makeEndpoint(body), "example.com");
    expect(result.data).toMatchObject({ hasMicrodata: true });
  });
});
