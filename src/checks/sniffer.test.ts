import { describe, it, expect } from "vitest";
import { SnifferCheck } from "./sniffer.js";
import type { EndpointData } from "../types.js";

function makeEndpoint(
  overrides: Partial<EndpointData> = {},
): EndpointData {
  return {
    url: "https://example.com",
    statusCode: 200,
    headers: {},
    body: "",
    redirectChain: [],
    ...overrides,
  };
}

describe("SnifferCheck", () => {
  const check = new SnifferCheck();

  it("has name 'sniffer'", () => {
    expect(check.name).toBe("sniffer");
  });

  it("detects a WordPress site", async () => {
    const endpoint = makeEndpoint({
      body: '<link rel="stylesheet" href="/wp-content/themes/flavor/style.css">',
    });
    const result = await check.run(endpoint, "example.com");
    expect(result.data.cms).toBe("WordPress");
  });

  it("detects a React / Next.js site", async () => {
    const endpoint = makeEndpoint({
      body: '<script id="__NEXT_DATA__" type="application/json">{}</script><div id="__next"><div data-reactroot="">',
    });
    const result = await check.run(endpoint, "example.com");
    expect(result.data.jsFrameworks).toContain("React");
    expect(result.data.jsFrameworks).toContain("Next.js");
  });

  it("returns empty/null for a plain site", async () => {
    const endpoint = makeEndpoint({
      body: "<html><body>Hello</body></html>",
    });
    const result = await check.run(endpoint, "example.com");
    expect(result.data.cms).toBeNull();
    expect(result.data.jsFrameworks).toEqual([]);
    expect(result.data.analytics).toEqual([]);
    expect(result.data.advertising).toEqual([]);
    expect(result.data.cdn).toBeNull();
  });

  it("detects CDN from headers", async () => {
    const cloudflare = makeEndpoint({
      headers: { server: "cloudflare" },
    });
    expect((await check.run(cloudflare, "example.com")).data.cdn).toBe(
      "Cloudflare",
    );

    const fastly = makeEndpoint({
      headers: { "x-served-by": "cache-lax12345" },
    });
    expect((await check.run(fastly, "example.com")).data.cdn).toBe("Fastly");

    const cloudfront = makeEndpoint({
      headers: { "x-amz-cf-id": "abc123" },
    });
    expect((await check.run(cloudfront, "example.com")).data.cdn).toBe(
      "AWS CloudFront",
    );
  });

  it("detects multiple analytics providers", async () => {
    const endpoint = makeEndpoint({
      body: `
        <script src="https://www.googletagmanager.com/gtag/js"></script>
        <script src="https://www.googletagmanager.com/gtm.js"></script>
        <script src="https://plausible.io/js/script.js"></script>
      `,
    });
    const result = await check.run(endpoint, "example.com");
    expect(result.data.analytics).toContain("Google Analytics");
    expect(result.data.analytics).toContain("Google Tag Manager");
    expect(result.data.analytics).toContain("Plausible");
  });
});
