import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EndpointData } from "../types.js";

vi.mock("open-graph-scraper");

import ogs from "open-graph-scraper";
import { OpenGraphCheck } from "./opengraph.js";

const ogsMock = vi.mocked(ogs);

function makeEndpoint(body: string): EndpointData {
  return {
    url: "https://example.com/",
    statusCode: 200,
    headers: {},
    body,
    redirectChain: [],
  };
}

describe("OpenGraphCheck", () => {
  const check = new OpenGraphCheck();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("has the name 'opengraph'", () => {
    expect(check.name).toBe("opengraph");
  });

  it("returns full OG and Twitter Card tags with socialReady true", async () => {
    ogsMock.mockResolvedValue({
      result: {
        ogTitle: "My Page",
        ogDescription: "A great page",
        ogImage: [{ url: "https://example.com/image.png" }],
        ogUrl: "https://example.com/",
        ogType: "website",
        ogSiteName: "Example",
        twitterCard: "summary_large_image",
        twitterSite: "@example",
        twitterTitle: "My Page on Twitter",
        twitterDescription: "A great page on Twitter",
        twitterImage: [{ url: "https://example.com/twitter.png" }],
        success: true,
      },
      error: false,
      html: "",
      response: {} as never,
    });

    const result = await check.run(makeEndpoint("<html></html>"), "example.com");

    expect(result.data.ogTitle).toBe("My Page");
    expect(result.data.ogDescription).toBe("A great page");
    expect(result.data.ogImage).toBe("https://example.com/image.png");
    expect(result.data.ogUrl).toBe("https://example.com/");
    expect(result.data.ogType).toBe("website");
    expect(result.data.ogSiteName).toBe("Example");
    expect(result.data.twitterCard).toBe("summary_large_image");
    expect(result.data.twitterSite).toBe("@example");
    expect(result.data.twitterTitle).toBe("My Page on Twitter");
    expect(result.data.twitterDescription).toBe("A great page on Twitter");
    expect(result.data.twitterImage).toBe("https://example.com/twitter.png");
    expect(result.data.socialReady).toBe(true);
  });

  it("returns socialReady true with only OG tags (no Twitter)", async () => {
    ogsMock.mockResolvedValue({
      result: {
        ogTitle: "OG Only",
        ogDescription: "Description",
        ogImage: [{ url: "https://example.com/og.png" }],
        success: true,
      },
      error: false,
      html: "",
      response: {} as never,
    });

    const result = await check.run(makeEndpoint("<html></html>"), "example.com");

    expect(result.data.ogTitle).toBe("OG Only");
    expect(result.data.ogDescription).toBe("Description");
    expect(result.data.ogImage).toBe("https://example.com/og.png");
    expect(result.data.twitterCard).toBeNull();
    expect(result.data.socialReady).toBe(true);
  });

  it("returns socialReady false when no OG tags present", async () => {
    ogsMock.mockResolvedValue({
      result: { success: true },
      error: false,
      html: "",
      response: {} as never,
    });

    const result = await check.run(makeEndpoint("<html></html>"), "example.com");

    expect(result.data.ogTitle).toBeNull();
    expect(result.data.ogDescription).toBeNull();
    expect(result.data.ogImage).toBeNull();
    expect(result.data.socialReady).toBe(false);
  });

  it("returns socialReady false with partial OG (missing image)", async () => {
    ogsMock.mockResolvedValue({
      result: {
        ogTitle: "Partial",
        ogDescription: "Has title and desc but no image",
        success: true,
      },
      error: false,
      html: "",
      response: {} as never,
    });

    const result = await check.run(makeEndpoint("<html></html>"), "example.com");

    expect(result.data.ogTitle).toBe("Partial");
    expect(result.data.ogDescription).toBe("Has title and desc but no image");
    expect(result.data.ogImage).toBeNull();
    expect(result.data.socialReady).toBe(false);
  });

  it("handles library errors gracefully", async () => {
    ogsMock.mockRejectedValue(new Error("Parse error"));

    const result = await check.run(makeEndpoint("<html></html>"), "example.com");

    expect(result.data.socialReady).toBe(false);
    expect(result.data.ogTitle).toBeNull();
    expect(result.data.ogDescription).toBeNull();
    expect(result.data.ogImage).toBeNull();
  });
});
