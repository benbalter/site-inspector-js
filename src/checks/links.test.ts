import { describe, it, expect, afterEach, vi } from "vitest";
import { LinksCheck } from "./links.js";
import { stubFetch, type FakeResponse } from "../testing/fetch-stub.js";
import type { EndpointData } from "../types.js";

function makeEndpoint(body: string): EndpointData {
  return {
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    statusCode: 200,
    headers: { "content-type": "text/html" },
    setCookies: [],
    body,
    redirectChain: [],
  };
}

/** The router stubFetch installed, so a test can wrap it. */
function routerOf(spy: ReturnType<typeof stubFetch>) {
  const route = spy.getMockImplementation();
  if (!route) throw new Error("stubFetch installed no implementation");
  return route;
}

/** Route the random not-found probe, whatever its random suffix, to `notFound`. */
function stubWithNotFound(notFound: FakeResponse, routes: Record<string, FakeResponse> = {}) {
  const spy = stubFetch(routes);
  const route = routerOf(spy);
  spy.mockImplementation(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/site-inspector-404-check-")) {
      return new Response(notFound.body ?? "", { status: notFound.status ?? 200 });
    }
    return route(input);
  });
  return spy;
}

describe("LinksCheck", () => {
  const check = new LinksCheck();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has the name 'links'", () => {
    expect(check.name).toBe("links");
  });

  it("reports a proper 404 for missing pages", async () => {
    stubWithNotFound({ status: 404 });
    const result = await check.run(makeEndpoint("<p>No links</p>"), "example.com");
    expect(result.data.notFoundStatus).toBe(404);
    expect(result.data.soft404).toBe(false);
  });

  it("flags a soft 404: a missing page answered with 200", async () => {
    stubWithNotFound({ status: 200 });
    const result = await check.run(makeEndpoint(""), "example.com");
    expect(result.data.notFoundStatus).toBe(200);
    expect(result.data.soft404).toBe(true);
  });

  it("reports an unknown when the not-found probe fails", async () => {
    stubFetch({});
    const result = await check.run(makeEndpoint(""), "example.com");
    expect(result.data.notFoundStatus).toBeNull();
    expect(result.data.soft404).toBeNull();
  });

  it("finds broken links, resolving relative ones and confirming with GET", async () => {
    const spy = stubWithNotFound(
      { status: 404 },
      {
        "https://example.com/about": { status: 200 },
        "https://example.com/gone": { status: 404 },
        "https://other.test/page": { status: 410 },
        "https://blocked.test/": { status: 403 },
      },
    );
    const html = `
      <a href="/about">About</a>
      <a href="gone#section">Gone</a>
      <a href="https://other.test/page">Other</a>
      <a href="https://blocked.test/">Blocks bots</a>
      <a href="mailto:hi@example.com">Mail</a>
      <a href="tel:+15555550100">Call</a>
      <a href="javascript:void(0)">JS</a>
      <a href="#top">Top</a>
      <a href="/about">About again</a>`;

    const result = await check.run(makeEndpoint(html), "example.com");

    expect(result.data.linksChecked).toBe(4);
    expect(result.data.brokenLinks).toEqual([
      { url: "https://example.com/gone", status: 404 },
      { url: "https://other.test/page", status: 410 },
    ]);
    expect(result.data.hasBrokenLinks).toBe(true);
    // A HEAD 404 is confirmed with GET before it counts.
    const methods = spy.mock.calls
      .filter(([u]) => u === "https://example.com/gone")
      .map(([, init]) => (init as RequestInit).method);
    expect(methods).toEqual(["HEAD", "GET"]);
  });

  it("doesn't count a link whose GET succeeds after HEAD said 404", async () => {
    const spy = stubWithNotFound({ status: 404 });
    const route = routerOf(spy);
    spy.mockImplementation(async (input, init) => {
      if (String(input) === "https://example.com/head-404") {
        return new Response(null, { status: (init as RequestInit).method === "HEAD" ? 404 : 200 });
      }
      return route(input, init);
    });

    const result = await check.run(makeEndpoint('<a href="/head-404">x</a>'), "example.com");

    expect(result.data.brokenLinks).toEqual([]);
    expect(result.data.hasBrokenLinks).toBe(false);
  });

  it("caps links per external host, and overall", async () => {
    const spy = stubWithNotFound({ status: 404 });
    const internal = Array.from({ length: 40 }, (_, i) => `<a href="/p${i}">p</a>`);
    const external = Array.from({ length: 10 }, (_, i) => `<a href="https://one.test/${i}">x</a>`);

    const result = await check.run(
      makeEndpoint([...internal, ...external].join("")),
      "example.com",
    );

    const probed = new Set(
      spy.mock.calls.map(([u]) => String(u)).filter((u) => !u.includes("404-check")),
    );
    expect([...probed].filter((u) => u.startsWith("https://one.test/"))).toHaveLength(2);
    expect([...probed].filter((u) => u.startsWith("https://example.com/"))).toHaveLength(20);
    expect(result.data.linksChecked).toBe(22);
    expect(result.data.linksFound).toBe(50);
  });
});
