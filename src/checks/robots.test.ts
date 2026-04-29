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
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses robots.txt with sitemaps and crawl-delay", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      text: async () => "User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml",
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
    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/robots.txt");
  });

  it("returns exists false when robots.txt is not found (404)", async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 404 });

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.data.exists).toBe(false);
    expect(result.data.sitemaps).toEqual([]);
    expect(result.data.error).toBeNull();
  });

  it("returns exists false with error on fetch failure", async () => {
    fetchSpy.mockRejectedValue(new Error("Network failure"));

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.data.exists).toBe(false);
    expect(result.data.error).toBe("Network failure");
  });

  it("detects when Googlebot is blocked", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      text: async () => "User-agent: Googlebot\nDisallow: /",
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
    fetchSpy.mockResolvedValue({
      ok: true,
      text: async () => "User-agent: *\nDisallow: /",
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
