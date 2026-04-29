import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EndpointData } from "../types.js";

vi.mock("robots-parser", () => {
  const factory = vi.fn();
  return { default: factory, __esModule: true };
});

// Because the source uses createRequire, we need to hook into the CJS require.
// vitest's vi.mock handles the ESM side; for the createRequire path we also
// mock node:module so createRequire returns our mock.
const mockRobotsParser = vi.fn();
vi.mock("node:module", () => ({
  createRequire: () => () => mockRobotsParser,
}));

const mockSafeFetch = vi.fn();
vi.mock("../utils.js", () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}));

// Must import after mocks are set up
const { RobotsCheck } = await import("./robots.js");

function makeEndpoint(url = "https://example.com/page"): EndpointData {
  return {
    url,
    statusCode: 200,
    headers: {},
    body: "",
    redirectChain: [],
  };
}

describe("RobotsCheck", () => {
  const check = new RobotsCheck();

  beforeEach(() => {
    mockSafeFetch.mockReset();
    mockRobotsParser.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses robots.txt with sitemaps and crawl-delay", async () => {
    mockSafeFetch.mockResolvedValue({
      ok: true,
      body: "User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml",
    });

    mockRobotsParser.mockReturnValue({
      getSitemaps: () => ["https://example.com/sitemap.xml"],
      getCrawlDelay: () => 10,
      isAllowed: () => true,
    });

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.name).toBe("robots");
    expect(result.data.exists).toBe(true);
    expect(result.data.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
    expect(result.data.crawlDelay).toBe(10);
    expect(result.data.blocksGooglebot).toBe(false);
    expect(result.data.blocksAll).toBe(false);
    expect(result.data.error).toBeNull();
    expect(mockSafeFetch).toHaveBeenCalledWith("https://example.com/robots.txt", 10_000);
  });

  it("returns exists false when robots.txt is not found (404)", async () => {
    mockSafeFetch.mockResolvedValue({ ok: false, statusCode: 404 });

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.data.exists).toBe(false);
    expect(result.data.sitemaps).toEqual([]);
    expect(result.data.error).toBeNull();
  });

  it("returns exists false with error on fetch failure", async () => {
    mockSafeFetch.mockResolvedValue(null);

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.data.exists).toBe(false);
    expect(result.data.error).toBe("Fetch failed");
  });

  it("detects when Googlebot is blocked", async () => {
    mockSafeFetch.mockResolvedValue({
      ok: true,
      body: "User-agent: Googlebot\nDisallow: /",
    });

    mockRobotsParser.mockReturnValue({
      getSitemaps: () => [],
      getCrawlDelay: () => undefined,
      isAllowed: (url: string, agent: string) => agent !== "Googlebot",
    });

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.data.exists).toBe(true);
    expect(result.data.blocksGooglebot).toBe(true);
    expect(result.data.blocksAll).toBe(false);
    expect(result.data.crawlDelay).toBeNull();
  });

  it("detects when all bots are blocked", async () => {
    mockSafeFetch.mockResolvedValue({
      ok: true,
      body: "User-agent: *\nDisallow: /",
    });

    mockRobotsParser.mockReturnValue({
      getSitemaps: () => [],
      getCrawlDelay: () => undefined,
      isAllowed: () => false,
    });

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.data.exists).toBe(true);
    expect(result.data.blocksGooglebot).toBe(true);
    expect(result.data.blocksAll).toBe(true);
  });
});
