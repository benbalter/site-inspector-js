import { describe, it, expect, vi, afterEach } from "vitest";
import { Endpoint, MAX_REDIRECTS } from "./endpoint.js";
import { stubFetch } from "./testing/fetch-stub.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Endpoint", () => {
  it("fetches a page and exposes its data", async () => {
    stubFetch({
      "https://example.com": {
        headers: { "Content-Type": "text/html", "X-Test": "1" },
        body: "<html></html>",
      },
    });

    const ep = new Endpoint("https://example.com");
    const data = await ep.fetch();

    expect(data).toMatchObject({
      url: "https://example.com",
      finalUrl: "https://example.com",
      statusCode: 200,
      body: "<html></html>",
      redirectChain: [],
    });
    expect(data.headers["x-test"]).toBe("1");
    expect(data.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(ep.info).toEqual({
      url: "https://example.com",
      up: true,
      statusCode: 200,
      redirect: false,
      redirectTarget: undefined,
    });
  });

  it("keeps every Set-Cookie header", async () => {
    stubFetch({
      "https://example.com": {
        headers: [
          ["Set-Cookie", "a=1; Secure"],
          ["Set-Cookie", "b=2; HttpOnly"],
        ],
      },
    });

    const data = await new Endpoint("https://example.com").fetch();
    expect(data.setCookies).toEqual(["a=1; Secure", "b=2; HttpOnly"]);
  });

  it("records each redirect hop", async () => {
    stubFetch({
      "http://example.com": { location: "https://example.com/" },
      "https://example.com/": { location: "/home", status: 302 },
      "https://example.com/home": { body: "home" },
    });

    const ep = new Endpoint("http://example.com");
    const data = await ep.fetch();

    expect(data.redirectChain).toEqual(["https://example.com/", "https://example.com/home"]);
    expect(data.finalUrl).toBe("https://example.com/home");
    expect(data.body).toBe("home");
    expect(ep.isRedirect).toBe(true);
    expect(ep.redirectTarget).toBe("https://example.com/home");
  });

  it("gives up after too many redirects", async () => {
    const routes: Record<string, { location: string }> = {};
    for (let i = 0; i <= MAX_REDIRECTS + 1; i++) {
      routes[`https://example.com/${i}`] = { location: `/${i + 1}` };
    }
    stubFetch(routes);

    const ep = new Endpoint("https://example.com/0");
    const data = await ep.fetch();

    expect(data.error).toMatch(/Too many redirects/);
    expect(ep.isUp).toBe(false);
  });

  it("reports the underlying cause when the host is unreachable", async () => {
    stubFetch({});

    const ep = new Endpoint("https://nope.invalid");
    const data = await ep.fetch();

    expect(data.statusCode).toBe(0);
    expect(data.error).toMatch(/ENOTFOUND/);
    expect(ep.info.up).toBe(false);
  });

  it("returns placeholder info before fetching", () => {
    const ep = new Endpoint("https://example.com");
    expect(ep.info).toMatchObject({ up: false, error: "Not fetched yet" });
  });

  it("shares one request across concurrent and repeated calls", async () => {
    const spy = stubFetch({ "https://example.com": { body: "ok" } });

    const ep = new Endpoint("https://example.com");
    await Promise.all([ep.fetch(), ep.fetch()]);
    await ep.fetch();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("flags 5xx responses as server errors while still up", async () => {
    stubFetch({ "https://example.com": { status: 503 } });

    const ep = new Endpoint("https://example.com");
    await ep.fetch();

    expect(ep.isUp).toBe(true);
    expect(ep.isServerError).toBe(true);
  });

  describe("isExternalRedirect", () => {
    it("is true for a redirect to another site", async () => {
      stubFetch({
        "https://example.com": { location: "https://other.com/" },
        "https://other.com/": {},
      });
      const ep = new Endpoint("https://example.com");
      await ep.fetch();
      expect(ep.isExternalRedirect).toBe(true);
    });

    it("is false between apex and www of the same domain", async () => {
      stubFetch({
        "https://example.com": { location: "https://www.example.com/" },
        "https://www.example.com/": {},
      });
      const ep = new Endpoint("https://example.com");
      await ep.fetch();
      expect(ep.isExternalRedirect).toBe(false);
    });

    it("is false when there is no redirect", async () => {
      stubFetch({ "https://example.com": {} });
      const ep = new Endpoint("https://example.com");
      await ep.fetch();
      expect(ep.isExternalRedirect).toBe(false);
    });
  });
});
