import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EndpointData } from "../types.js";

function makeEndpoint(url = "https://example.com"): EndpointData {
  return {
    url,
    statusCode: 200,
    headers: { "content-type": "text/html" },
    body: "<html></html>",
    finalUrl: url,
    setCookies: [],
    redirectChain: [],
  };
}

const mockKill = vi.fn().mockResolvedValue(undefined);
const mockLaunch = vi.fn().mockResolvedValue({ port: 9222, kill: mockKill });
const mockLighthouse = vi.fn();

vi.mock("chrome-launcher", () => ({
  launch: (...args: unknown[]) => mockLaunch(...args),
}));

vi.mock("lighthouse", () => ({
  default: (...args: unknown[]) => mockLighthouse(...args),
}));

// Import after mocks are set up
const { LighthouseCheck } = await import("./lighthouse.js");

describe("LighthouseCheck", () => {
  const check = new LighthouseCheck();

  beforeEach(() => {
    vi.clearAllMocks();
    mockLaunch.mockResolvedValue({ port: 9222, kill: mockKill });
  });

  it("has the correct name", () => {
    expect(check.name).toBe("lighthouse");
  });

  it("returns scores and metrics on successful run", async () => {
    mockLighthouse.mockResolvedValue({
      lhr: {
        categories: {
          performance: { score: 0.95 },
          accessibility: { score: 0.88 },
          "best-practices": { score: 1.0 },
          seo: { score: 0.72 },
        },
        audits: {
          "first-contentful-paint": { numericValue: 1234.5 },
          "largest-contentful-paint": { numericValue: 2500.3 },
          "cumulative-layout-shift": { numericValue: 0.05 },
          "total-blocking-time": { numericValue: 150.7 },
          "speed-index": { numericValue: 3200.9 },
          interactive: { numericValue: 4500.1 },
        },
      },
    });

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.name).toBe("lighthouse");
    expect(result.data.available).toBe(true);

    const scores = result.data.scores as Record<string, number | null>;
    expect(scores.performance).toBe(95);
    expect(scores.accessibility).toBe(88);
    expect(scores.bestPractices).toBe(100);
    expect(scores.seo).toBe(72);

    const metrics = result.data.metrics as Record<string, number | null>;
    expect(metrics.firstContentfulPaint).toBe(1235);
    expect(metrics.largestContentfulPaint).toBe(2500);
    expect(metrics.cumulativeLayoutShift).toBe(0);
    expect(metrics.totalBlockingTime).toBe(151);
    expect(metrics.speedIndex).toBe(3201);
    expect(metrics.timeToInteractive).toBe(4500);

    expect(mockKill).toHaveBeenCalled();
  });

  it("rounds score correctly (0.95 → 95)", async () => {
    mockLighthouse.mockResolvedValue({
      lhr: {
        categories: {
          performance: { score: 0.95 },
          accessibility: { score: 0.555 },
          "best-practices": { score: 0.0 },
          seo: { score: null },
        },
        audits: {},
      },
    });

    const result = await check.run(makeEndpoint(), "example.com");
    const scores = result.data.scores as Record<string, number | null>;

    expect(scores.performance).toBe(95);
    expect(scores.accessibility).toBe(56);
    expect(scores.bestPractices).toBe(0);
    expect(scores.seo).toBeNull();
  });

  it("handles Chrome not available gracefully", async () => {
    mockLaunch.mockRejectedValue(new Error("No Chrome installations found"));

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.name).toBe("lighthouse");
    expect(result.data.available).toBe(false);
    expect(result.data.reason).toBe("Chrome or Lighthouse not available");
  });

  it("handles Lighthouse returning no results", async () => {
    mockLighthouse.mockResolvedValue(null);

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.name).toBe("lighthouse");
    expect(result.data.available).toBe(false);
    expect(result.data.reason).toBe("Lighthouse returned no results");
    expect(mockKill).toHaveBeenCalled();
  });

  it("handles Lighthouse returning result without lhr", async () => {
    mockLighthouse.mockResolvedValue({ lhr: undefined });

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.data.available).toBe(false);
    expect(result.data.reason).toBe("Lighthouse returned no results");
  });

  it("handles generic errors with the error message", async () => {
    mockLighthouse.mockRejectedValue(new Error("Connection refused"));

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.data.available).toBe(false);
    expect(result.data.reason).toBe("Connection refused");
    expect(mockKill).toHaveBeenCalled();
  });

  it("kills Chrome even when Lighthouse throws", async () => {
    mockLighthouse.mockRejectedValue(new Error("Something went wrong"));

    await check.run(makeEndpoint(), "example.com");

    expect(mockKill).toHaveBeenCalled();
  });

  it("handles missing audit metrics gracefully", async () => {
    mockLighthouse.mockResolvedValue({
      lhr: {
        categories: {
          performance: { score: 0.9 },
        },
        audits: {},
      },
    });

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.data.available).toBe(true);
    const metrics = result.data.metrics as Record<string, number | null>;
    expect(metrics.firstContentfulPaint).toBeNull();
    expect(metrics.largestContentfulPaint).toBeNull();
    expect(metrics.speedIndex).toBeNull();
  });

  it("kills Chrome when the check's signal aborts", async () => {
    const controller = new AbortController();
    mockLighthouse.mockImplementation(() => {
      controller.abort();
      return new Promise(() => {});
    });

    void check.run(makeEndpoint(), "example.com", {
      timeoutMs: 1000,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(mockKill).toHaveBeenCalled());
  });

  describe("network activity", () => {
    // Trimmed from a real Lighthouse 13.5 report of a news site.
    const lhr = {
      categories: { performance: { score: 0.5 } },
      entities: [
        { name: "nyt.com", origins: ["https://www.nytimes.com"], isFirstParty: true },
        { name: "Google Tag Manager", origins: ["https://www.googletagmanager.com"] },
        { name: "Amazon Ads", origins: ["https://c.amazon-adsystem.com"] },
      ],
      audits: {
        "network-requests": {
          details: {
            type: "table",
            items: [
              { url: "https://www.nytimes.com/", resourceType: "Document", entity: "nyt.com" },
              { url: "https://static01.nyt.com/a.js", resourceType: "Script", entity: "nyt.com" },
              { url: "https://static01.nyt.com/b.js", resourceType: "Script", entity: "nyt.com" },
              { url: "https://www.googletagmanager.com/gtm.js?id=x", resourceType: "Script" },
              { url: "data:image/png;base64,AAAA", resourceType: "Image" },
            ],
          },
        },
        "final-screenshot": {
          scoreDisplayMode: "informative",
          details: { type: "screenshot", timestamp: 1, data: "data:image/jpeg;base64,/9j/4AA" },
        },
      },
    };

    it("reports request count, hosts contacted, and third parties", async () => {
      mockLighthouse.mockResolvedValue({ lhr });
      const result = await check.run(makeEndpoint(), "example.com");

      expect(result.data.requestCount).toBe(5);
      expect(result.data.hostCount).toBe(3);
      expect(result.data.hosts).toEqual([
        "static01.nyt.com",
        "www.googletagmanager.com",
        "www.nytimes.com",
      ]);
      expect(result.data.thirdParties).toEqual(["Amazon Ads", "Google Tag Manager"]);
    });

    it("counts the inspected domain as first party when it redirected elsewhere", async () => {
      mockLighthouse.mockResolvedValue({
        lhr: {
          ...lhr,
          entities: [
            { name: "balter.com", origins: ["https://ben.balter.com"], isFirstParty: true },
            { name: "benbalter.com", origins: ["https://benbalter.com"] },
            { name: "Cloudflare", origins: ["https://static.cloudflareinsights.com"] },
          ],
        },
      });
      const result = await check.run(makeEndpoint(), "benbalter.com");
      expect(result.data.thirdParties).toEqual(["Cloudflare"]);
    });

    it("leaves the screenshot out unless asked for", async () => {
      mockLighthouse.mockResolvedValue({ lhr });
      const result = await check.run(makeEndpoint(), "example.com");
      expect(result.data).not.toHaveProperty("screenshot");
    });

    it("includes the final screenshot when the context asks for it", async () => {
      mockLighthouse.mockResolvedValue({ lhr });
      const result = await check.run(makeEndpoint(), "example.com", {
        timeoutMs: 1000,
        signal: new AbortController().signal,
        screenshot: true,
      });
      expect(result.data.screenshot).toBe("data:image/jpeg;base64,/9j/4AA");
    });

    it("caps the host list but still counts every host", async () => {
      const items = Array.from({ length: 150 }, (_, i) => ({ url: `https://h${i}.example/` }));
      mockLighthouse.mockResolvedValue({
        lhr: { ...lhr, audits: { "network-requests": { details: { items } } } },
      });
      const result = await check.run(makeEndpoint(), "example.com");
      expect(result.data.hostCount).toBe(150);
      expect(result.data.hosts).toHaveLength(100);
    });

    it("reports nulls when the report has no network data", async () => {
      mockLighthouse.mockResolvedValue({ lhr: { categories: {}, audits: {} } });
      const result = await check.run(makeEndpoint(), "example.com", {
        timeoutMs: 1000,
        signal: new AbortController().signal,
        screenshot: true,
      });
      expect(result.data.requestCount).toBeNull();
      expect(result.data.hostCount).toBeNull();
      expect(result.data.hosts).toEqual([]);
      expect(result.data.thirdParties).toEqual([]);
      expect(result.data.screenshot).toBeNull();
    });
  });
});
