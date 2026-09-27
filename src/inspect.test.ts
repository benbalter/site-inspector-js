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

  it("reports progress: resolved, then each check starting and finishing", async () => {
    stubFetch(canonicalApex);
    const events: string[] = [];

    await inspect("example.com", {
      checks: ["content", "headers"],
      onProgress: (e) => {
        if (e.type === "resolved") events.push(`resolved:${e.checks.join(",")}`);
        else if (e.type === "check-start") events.push(`start:${e.check}`);
        else events.push(`done:${e.check}:${e.completed}/${e.total}`);
      },
    });

    expect(events[0]).toBe("resolved:content,headers");
    expect(events.filter((e) => e.startsWith("start:"))).toHaveLength(2);
    expect(events.filter((e) => e.startsWith("done:")).map((e) => e.split(":")[2])).toEqual([
      "1/2",
      "2/2",
    ]);
  });

  it("reports a down domain as resolved with no checks", async () => {
    stubFetch({});
    const onProgress = vi.fn();

    await inspect("down.invalid", { onProgress });

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress.mock.calls[0][0]).toMatchObject({ type: "resolved", checks: [] });
  });

  it("ignores errors thrown by the progress callback", async () => {
    stubFetch(canonicalApex);

    const result = await inspect("example.com", {
      checks: ["content"],
      onProgress: () => {
        throw new Error("listener bug");
      },
    });

    expect(result.checks.content.data.title).toBe("Hi");
  });
});
