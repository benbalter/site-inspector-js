import { describe, it, expect, vi, afterEach } from "vitest";
import { inspect } from "./index.js";
import { Domain } from "./domain.js";
import { stubFetch } from "./testing/fetch-stub.js";

// End-to-end tests over the real Endpoint/Domain code, with fetch stubbed.

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A typical HTTPS site on the apex, with http and www redirecting to it. */
const canonicalApex = {
  "https://example.com": { body: "<html><title>Hi</title></html>" },
  "https://www.example.com": { location: "https://example.com/" },
  "http://example.com": { location: "https://example.com/" },
  "http://www.example.com": { location: "https://example.com/" },
  "https://example.com/": { body: "<html><title>Hi</title></html>" },
};

describe("Domain properties (real endpoints)", () => {
  it("treats www. input as the apex domain", async () => {
    stubFetch(canonicalApex);

    const domain = new Domain("www.example.com");
    await domain.resolve();

    expect(domain.domain).toBe("example.com");
    expect(domain.properties).toMatchObject({
      up: true,
      https: true,
      enforcesHttps: true,
      canonicallyWww: false,
      canonicallyHttps: true,
      redirect: false,
    });
    expect(domain.canonicalEndpoint.url).toBe("https://example.com");
  });

  it("doesn't count a redirect to another site's www as canonically www", async () => {
    stubFetch({
      "https://example.com": { location: "https://www.other.com/" },
      "https://www.example.com": { body: "www" },
      "http://example.com": { location: "https://www.other.com/" },
      "http://www.example.com": { location: "https://www.example.com" },
      "https://www.other.com/": { body: "other" },
    });

    const domain = new Domain("example.com");
    await domain.resolve();

    expect(domain.properties.canonicallyWww).toBe(false);
  });

  it("detects a downgrade on the canonical www endpoint", async () => {
    stubFetch({
      "https://example.com": { location: "https://www.example.com/" },
      "https://www.example.com": { location: "http://www.example.com/" },
      "http://example.com": { location: "http://www.example.com/" },
      "http://www.example.com": { body: "insecure" },
      "https://www.example.com/": { location: "http://www.example.com/" },
      "http://www.example.com/": { body: "insecure" },
    });

    const domain = new Domain("example.com");
    await domain.resolve();

    expect(domain.properties.canonicallyWww).toBe(true);
    expect(domain.canonicalEndpoint.url).toBe("https://www.example.com");
    expect(domain.properties.downgradesHttps).toBe(true);
  });

  it("flags a canonical endpoint that returns 5xx", async () => {
    stubFetch({
      "https://example.com": { status: 503 },
      "http://example.com": { location: "https://example.com" },
    });

    const domain = new Domain("example.com");
    await domain.resolve();

    expect(domain.properties.up).toBe(true);
    expect(domain.properties.serverError).toBe(true);
  });

  it("probes each endpoint once, even with concurrent resolves", async () => {
    const spy = stubFetch(canonicalApex);

    const domain = new Domain("example.com");
    await Promise.all([domain.resolve(), domain.resolve()]);
    void domain.properties;
    void domain.properties;

    const initialProbes = spy.mock.calls.filter(([url]) => !String(url).endsWith("/"));
    expect(initialProbes).toHaveLength(4);
  });
});

describe("inspect()", () => {
  it("runs the requested checks against the canonical endpoint", async () => {
    stubFetch(canonicalApex);

    const result = await inspect("example.com", { checks: ["content"] });

    expect(result.domain).toBe("example.com");
    expect(result.canonicalUrl).toBe("https://example.com");
    expect(Object.keys(result.checks)).toEqual(["content"]);
    expect(result.endpoints).toBeUndefined();
  });

  it("includes endpoints when allEndpoints is set", async () => {
    stubFetch(canonicalApex);

    const result = await inspect("example.com", { checks: ["content"], allEndpoints: true });

    expect(result.endpoints).toHaveLength(4);
  });

  it("short-circuits a down domain and explains why", async () => {
    const spy = stubFetch({});

    const result = await inspect("down.invalid", { checks: ["content"] });

    expect(result.properties.up).toBe(false);
    expect(result.checks).toEqual({});
    expect(result.endpoints?.every((e) => e.error?.includes("ENOTFOUND"))).toBe(true);
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it("rejects unknown checks before making any requests", async () => {
    const spy = stubFetch(canonicalApex);

    await expect(inspect("example.com", { checks: ["bogus"] })).rejects.toThrow(
      "Unknown checks: bogus",
    );
    expect(spy).not.toHaveBeenCalled();
  });
});
