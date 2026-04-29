import { describe, it, expect, vi, beforeEach } from "vitest";
import { HstsPreloadCheck } from "./hsts-preload.js";
import type { EndpointData } from "../types.js";

function makeEndpoint(headers: Record<string, string> = {}): EndpointData {
  return {
    url: "https://example.com",
    statusCode: 200,
    headers,
    body: "",
    redirectChain: [],
  };
}

describe("HstsPreloadCheck", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const check = new HstsPreloadCheck();

  it("has name 'hsts-preload'", () => {
    expect(check.name).toBe("hsts-preload");
  });

  it("returns preloaded status when domain is on the preload list", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/status")) {
        return {
          ok: true,
          json: async () => ({ status: "preloaded" }),
        };
      }
      if (url.includes("/preloadable")) {
        return {
          ok: true,
          json: async () => ({ status: "preloadable", issues: [] }),
        };
      }
      return { ok: false };
    }));

    const endpoint = makeEndpoint();
    const result = await check.run(endpoint, "example.com");

    expect(result.name).toBe("hsts-preload");
    expect(result.data).toEqual({
      preloaded: true,
      status: "preloaded",
      eligible: true,
      issues: [],
    });
  });

  it("returns not preloaded when domain is unknown", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/status")) {
        return {
          ok: true,
          json: async () => ({ status: "unknown" }),
        };
      }
      if (url.includes("/preloadable")) {
        return {
          ok: true,
          json: async () => ({ status: "unknown", issues: [] }),
        };
      }
      return { ok: false };
    }));

    const endpoint = makeEndpoint();
    const result = await check.run(endpoint, "example.com");

    expect(result.data).toEqual({
      preloaded: false,
      status: "unknown",
      eligible: false,
      issues: [],
    });
  });

  it("returns pending when domain is pending preload", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/status")) {
        return {
          ok: true,
          json: async () => ({ status: "pending" }),
        };
      }
      if (url.includes("/preloadable")) {
        return {
          ok: true,
          json: async () => ({ status: "preloadable", issues: [] }),
        };
      }
      return { ok: false };
    }));

    const endpoint = makeEndpoint();
    const result = await check.run(endpoint, "example.com");

    expect(result.data).toEqual({
      preloaded: false,
      status: "pending",
      eligible: true,
      issues: [],
    });
  });

  it("returns removed status when domain was removed from preload list", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/status")) {
        return {
          ok: true,
          json: async () => ({ status: "removed" }),
        };
      }
      if (url.includes("/preloadable")) {
        return {
          ok: true,
          json: async () => ({ status: "unknown", issues: [] }),
        };
      }
      return { ok: false };
    }));

    const endpoint = makeEndpoint();
    const result = await check.run(endpoint, "example.com");

    expect(result.data).toEqual({
      preloaded: false,
      status: "removed",
      eligible: false,
      issues: [],
    });
  });

  it("returns eligible with issues when domain has preload issues", async () => {
    const issues = [
      {
        code: "ONLY_PRELOAD_HEADER",
        summary: "Uses HSTS Preload header only",
        message: "The domain is only submittable via the form; there is no valid HSTS header",
      },
    ];

    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/status")) {
        return {
          ok: true,
          json: async () => ({ status: "unknown" }),
        };
      }
      if (url.includes("/preloadable")) {
        return {
          ok: true,
          json: async () => ({ status: "preloadable", issues }),
        };
      }
      return { ok: false };
    }));

    const endpoint = makeEndpoint();
    const result = await check.run(endpoint, "example.com");

    expect(result.data).toEqual({
      preloaded: false,
      status: "unknown",
      eligible: true,
      issues,
    });
  });

  it("handles API errors gracefully", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("Network error");
    }));

    const endpoint = makeEndpoint();
    const result = await check.run(endpoint, "example.com");

    expect(result.data).toEqual({
      preloaded: false,
      status: "unknown",
      eligible: false,
      issues: [],
    });
  });

  it("handles non-ok API responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      return { ok: false };
    }));

    const endpoint = makeEndpoint();
    const result = await check.run(endpoint, "example.com");

    expect(result.data).toEqual({
      preloaded: false,
      status: "unknown",
      eligible: false,
      issues: [],
    });
  });

  it("encodes domain properly in URLs", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/status")) {
        return {
          ok: true,
          json: async () => ({ status: "unknown" }),
        };
      }
      if (url.includes("/preloadable")) {
        return {
          ok: true,
          json: async () => ({ status: "unknown", issues: [] }),
        };
      }
      return { ok: false };
    });

    vi.stubGlobal("fetch", fetchMock);

    const endpoint = makeEndpoint();
    await check.run(endpoint, "example-test.com");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("domain=example-test.com")
    );
  });
});
