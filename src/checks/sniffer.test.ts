import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EndpointData } from "../types.js";

// Shared mock functions - declared before vi.mock so hoisting works
const mockAnalyze = vi.fn().mockReturnValue([]);
const mockResolve = vi.fn().mockReturnValue([]);
const mockSetCategories = vi.fn();
const mockSetTechnologies = vi.fn();

// Mock wappalyzer-core and fs before importing the module
vi.mock("node:fs", () => ({
  readFileSync: vi.fn((filePath: string) => {
    const p = String(filePath);
    if (p.endsWith("categories.json")) {
      return JSON.stringify({
        1: { name: "CMS", slug: "cms" },
        2: { name: "Web servers", slug: "web-servers" },
      });
    }
    return JSON.stringify({});
  }),
  readdirSync: vi.fn(() => ["_.json"]),
}));

vi.mock("node:module", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("node:module");
  return {
    ...actual,
    createRequire: () => (id: string) => {
      if (id.includes("wappalyzer-core")) {
        return {
          analyze: mockAnalyze,
          resolve: mockResolve,
          setCategories: mockSetCategories,
          setTechnologies: mockSetTechnologies,
        };
      }
      throw new Error(`Unexpected require: ${id}`);
    },
  };
});

const { SnifferCheck } = await import("./sniffer.js");

function makeEndpoint(overrides: Partial<EndpointData> = {}): EndpointData {
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

  beforeEach(() => {
    mockAnalyze.mockReset().mockReturnValue([]);
    mockResolve.mockReset().mockReturnValue([]);
  });

  it("has name 'sniffer'", () => {
    expect(check.name).toBe("sniffer");
  });

  it("detects a WordPress-like site from HTML", async () => {
    const wpDetection = [
      {
        technology: {
          name: "WordPress",
          slug: "wordpress",
          categories: [{ id: 1, slug: "cms", name: "CMS" }],
          website: "https://wordpress.org",
        },
        pattern: { confidence: 100 },
        version: "6.0",
      },
    ];
    mockAnalyze.mockReturnValue(wpDetection);
    mockResolve.mockReturnValue([
      {
        name: "WordPress",
        confidence: 100,
        version: "6.0",
        categories: [{ id: 1, slug: "cms", name: "CMS" }],
        website: "https://wordpress.org",
      },
    ]);

    const endpoint = makeEndpoint({
      body: '<meta name="generator" content="WordPress 6.0"><link href="/wp-content/themes/flavor/style.css">',
    });
    const result = await check.run(endpoint, "example.com");

    expect(result.name).toBe("sniffer");
    expect(result.data.technologies).toEqual([
      {
        name: "WordPress",
        categories: ["CMS"],
        version: "6.0",
        confidence: 100,
        website: "https://wordpress.org",
      },
    ]);

    // Verify analyze was called with correct structure
    expect(mockAnalyze).toHaveBeenCalledTimes(1);
    const call = mockAnalyze.mock.calls[0][0];
    expect(call.url).toBe("https://example.com");
    expect(call.html).toContain("wp-content");
    expect(call.meta).toHaveProperty("generator");
  });

  it("returns empty technologies array when nothing detected", async () => {
    const endpoint = makeEndpoint({
      body: "<html><body>Hello</body></html>",
    });
    const result = await check.run(endpoint, "example.com");
    expect(result.data.technologies).toEqual([]);
  });

  it("detects technology from headers", async () => {
    mockAnalyze.mockReturnValue([
      {
        technology: {
          name: "Nginx",
          slug: "nginx",
          categories: [{ id: 2, slug: "web-servers", name: "Web servers" }],
          website: "https://nginx.org",
        },
        pattern: { confidence: 100 },
        version: "1.21",
      },
    ]);
    mockResolve.mockReturnValue([
      {
        name: "Nginx",
        confidence: 100,
        version: "1.21",
        categories: [{ id: 2, slug: "web-servers", name: "Web servers" }],
        website: "https://nginx.org",
      },
    ]);

    const endpoint = makeEndpoint({
      headers: { server: "nginx/1.21" },
    });
    const result = await check.run(endpoint, "example.com");

    expect(result.data.technologies).toEqual([
      {
        name: "Nginx",
        categories: ["Web servers"],
        version: "1.21",
        confidence: 100,
        website: "https://nginx.org",
      },
    ]);

    // Verify headers were converted to array format
    const call = mockAnalyze.mock.calls[0][0];
    expect(call.headers.server).toEqual(["nginx/1.21"]);
  });

  it("groups multiple detections for same technology by highest confidence", async () => {
    mockAnalyze.mockReturnValue([]);
    mockResolve.mockReturnValue([
      {
        name: "WordPress",
        confidence: 50,
        version: "",
        categories: [{ id: 1, slug: "cms", name: "CMS" }],
        website: "https://wordpress.org",
      },
      {
        name: "WordPress",
        confidence: 100,
        version: "6.0",
        categories: [{ id: 1, slug: "cms", name: "CMS" }],
        website: "https://wordpress.org",
      },
    ]);

    const endpoint = makeEndpoint();
    const result = await check.run(endpoint, "example.com");

    const techs = result.data.technologies as Array<{ name: string; confidence: number }>;
    const wp = techs.filter((t) => t.name === "WordPress");
    expect(wp).toHaveLength(1);
    expect(wp[0].confidence).toBe(100);
  });

  it("has correct output shape", async () => {
    mockResolve.mockReturnValue([
      {
        name: "React",
        confidence: 100,
        version: "18",
        categories: [{ id: 3, slug: "js-frameworks", name: "JavaScript frameworks" }],
        website: "https://reactjs.org",
      },
    ]);

    const result = await check.run(makeEndpoint(), "example.com");
    const tech = (result.data.technologies as Array<Record<string, unknown>>)[0];
    expect(tech).toHaveProperty("name");
    expect(tech).toHaveProperty("categories");
    expect(tech).toHaveProperty("version");
    expect(tech).toHaveProperty("confidence");
    expect(tech).toHaveProperty("website");
    expect(Array.isArray(tech.categories)).toBe(true);
  });
});
