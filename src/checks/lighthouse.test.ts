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

  describe("insecure requests and third parties", () => {
    // Detail shapes from Lighthouse 13's is-on-https and third-parties-insight audits.
    const table = (items: object[]) => ({ details: { type: "table", headings: [], items } });

    function runWith(audits: Record<string, unknown>) {
      mockLighthouse.mockResolvedValue({
        lhr: { categories: { performance: { score: 0.9 } }, audits },
      });
      return check.run(makeEndpoint(), "example.com");
    }

    it("lists insecure requests, capped, with the full count", async () => {
      const items = Array.from({ length: 25 }, (_, i) => ({
        url: `http://example.com/img${i}.png`,
        resolution: "Allowed",
      }));

      const result = await runWith({ "is-on-https": { score: 0, ...table(items) } });

      expect(result.data.insecureRequestCount).toBe(25);
      expect(result.data.insecureRequests).toHaveLength(20);
      expect((result.data.insecureRequests as string[])[0]).toBe("http://example.com/img0.png");
    });

    it("counts only requests that actually went out over HTTP", async () => {
      // upgrade-insecure-requests and mixed-content blocking stop these from loading.
      const items = [
        { url: "http://example.com/a.png", resolution: "Allowed" },
        { url: "http://example.com/b.png", resolution: "Allowed with warning" },
        { url: "http://example.com/c.js", resolution: "Blocked" },
        { url: "http://example.com/d.png", resolution: "Automatically upgraded to HTTPS" },
      ];

      const result = await runWith({ "is-on-https": { score: 0, ...table(items) } });

      expect(result.data.insecureRequests).toEqual([
        "http://example.com/a.png",
        "http://example.com/b.png",
      ]);
      expect(result.data.insecureRequestCount).toBe(2);
    });

    it("reports no insecure requests on a clean page", async () => {
      const result = await runWith({ "is-on-https": { score: 1, ...table([]) } });

      expect(result.data.insecureRequestCount).toBe(0);
      expect(result.data.insecureRequests).toEqual([]);
    });

    it("summarizes third parties from third-parties-insight", async () => {
      const items = Array.from({ length: 12 }, (_, i) => ({
        entity: `Vendor ${i}`,
        mainThreadTime: 12 - i + 0.4,
        transferSize: 1000 * (i + 1),
        subItems: {
          type: "subitems",
          items: [{ url: `https://vendor${i}.example/x.js`, mainThreadTime: 1, transferSize: 1 }],
        },
      }));
      items[0] = { ...items[0], entity: "Google Tag Manager", mainThreadTime: 88.6 };

      const result = await runWith({
        "third-parties-insight": { score: 1, ...table(items), isEntityGrouped: true },
      });

      const parties = result.data.thirdParties as Array<Record<string, unknown>>;
      expect(parties).toHaveLength(10);
      expect(parties[0]).toEqual({
        entity: "Google Tag Manager",
        transferSize: 1000,
        mainThreadTime: 89,
      });
      expect(parties[1].entity).toBe("Vendor 1");
    });

    it("falls back to the pre-13 third-party-summary audit", async () => {
      const result = await runWith({
        "third-party-summary": table([
          {
            entity: { type: "link", text: "YouTube", url: "https://youtube.com" },
            transferSize: 5000,
            blockingTime: 30,
            mainThreadTime: 120,
          },
        ]),
      });

      expect(result.data.thirdParties).toEqual([
        { entity: "YouTube", transferSize: 5000, mainThreadTime: 120 },
      ]);
    });

    it("reports null when the audits didn't run", async () => {
      const result = await runWith({
        "third-parties-insight": { score: null, scoreDisplayMode: "notApplicable" },
      });

      expect(result.data.insecureRequests).toBeNull();
      expect(result.data.insecureRequestCount).toBeNull();
      expect(result.data.thirdParties).toBeNull();
    });
  });
});
