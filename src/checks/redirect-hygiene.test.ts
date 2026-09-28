import { describe, it, expect, afterEach, vi } from "vitest";
import { RedirectHygieneCheck } from "./redirect-hygiene.js";
import { stubFetch } from "../testing/fetch-stub.js";
import type { EndpointData } from "../types.js";

const endpoint: EndpointData = {
  url: "https://example.com",
  finalUrl: "https://example.com/",
  statusCode: 200,
  headers: {},
  setCookies: [],
  body: "",
  redirectChain: [],
};

const HSTS = { "strict-transport-security": "max-age=31536000; includeSubDomains" };

describe("RedirectHygieneCheck", () => {
  const check = new RedirectHygieneCheck();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes HTTP to HTTPS on the same host with HSTS on every HTTPS hop", async () => {
    stubFetch({
      "http://example.com/": { location: "https://example.com/" },
      "https://example.com/": { headers: HSTS },
      "http://www.example.com/": { location: "https://www.example.com/" },
      "https://www.example.com/": { location: "https://example.com/", headers: HSTS },
    });
    const { data } = await check.run(endpoint, "example.com");
    expect(data.httpsFirst).toBe(true);
    expect(data.crossHostBeforeHttps).toBe(false);
    expect(data.hstsOnAllHttpsHops).toBe(true);
    expect(data.httpsHopsWithoutHsts).toEqual([]);
    expect(data.chains).toEqual([
      {
        start: "http://example.com/",
        hops: [
          { url: "http://example.com/", status: 301, hsts: false },
          { url: "https://example.com/", status: 200, hsts: true },
        ],
        error: null,
      },
      {
        start: "http://www.example.com/",
        hops: [
          { url: "http://www.example.com/", status: 301, hsts: false },
          { url: "https://www.example.com/", status: 301, hsts: true },
          { url: "https://example.com/", status: 200, hsts: true },
        ],
        error: null,
      },
    ]);
  });

  it("flags a redirect that leaves the host before upgrading to HTTPS", async () => {
    stubFetch({
      "http://example.com/": { location: "http://www.example.com/" },
      "http://www.example.com/": { location: "https://www.example.com/" },
      "https://www.example.com/": { headers: HSTS },
    });
    const { data } = await check.run(endpoint, "example.com");
    expect(data.httpsFirst).toBe(false);
    expect(data.crossHostBeforeHttps).toBe(true);
  });

  it("lists HTTPS redirect hops that don't send HSTS", async () => {
    stubFetch({
      "http://example.com/": { location: "https://example.com/" },
      "https://example.com/": { location: "https://example.com/home" },
      "https://example.com/home": { headers: HSTS },
    });
    const { data } = await check.run(endpoint, "example.com");
    expect(data.hstsOnAllHttpsHops).toBe(false);
    expect(data.httpsHopsWithoutHsts).toEqual(["https://example.com/"]);
  });

  it("only judges hosts under the domain for HSTS", async () => {
    // HSTS on a third-party host isn't the domain's to set.
    stubFetch({
      "http://example.com/": { location: "https://example.com/" },
      "https://example.com/": { location: "https://login.other.test/", headers: HSTS },
      "https://login.other.test/": {},
    });
    const { data } = await check.run(endpoint, "example.com");
    expect(data.hstsOnAllHttpsHops).toBe(true);
  });

  it("reports unknown when the HTTP site can't be reached", async () => {
    stubFetch({});
    const { data } = await check.run(endpoint, "example.com");
    expect(data.httpsFirst).toBeNull();
    expect(data.crossHostBeforeHttps).toBeNull();
    expect(data.hstsOnAllHttpsHops).toBeNull();
    expect((data.chains as { error: string | null }[])[0].error).toMatch(/fetch failed/);
  });

  it("reports unknown when HTTP serves content without redirecting", async () => {
    stubFetch({ "http://example.com/": { body: "hi" } });
    const { data } = await check.run(endpoint, "example.com");
    // Whether HTTP redirects at all is `properties.enforcesHttps`; nothing to judge here.
    expect(data.httpsFirst).toBeNull();
    expect(data.crossHostBeforeHttps).toBeNull();
  });

  it("stops at a redirect loop", async () => {
    stubFetch({
      "http://example.com/": { location: "http://example.com/a" },
      "http://example.com/a": { location: "http://example.com/" },
    });
    const { data } = await check.run(endpoint, "example.com");
    const [chain] = data.chains as { hops: unknown[]; error: string | null }[];
    expect(chain.error).toMatch(/Too many redirects/);
    expect(chain.hops.length).toBeLessThanOrEqual(11);
  });
});
