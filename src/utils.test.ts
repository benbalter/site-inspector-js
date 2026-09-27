import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  USER_AGENT,
  VERSION,
  fetchJson,
  fetchWithTimeout,
  letterGrade,
  normalizeDomain,
  parseHtml,
  probeUrl,
  readBody,
} from "./utils.js";
import { stubFetch } from "./testing/fetch-stub.js";

describe("normalizeDomain", () => {
  it.each([
    ["example.com", "example.com"],
    ["HTTPS://Example.COM/path?q=1", "example.com"],
    ["http://example.com:8080", "example.com"],
    ["example.com.", "example.com"],
    ["www.example.com", "example.com"],
    ["https://www.example.co.uk/", "example.co.uk"],
    ["www2.example.com", "www2.example.com"],
    ["www.com", "www.com"],
    ["  sub.example.com  ", "sub.example.com"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });
});

describe("parseHtml", () => {
  it("parses each endpoint's body once and shares the result", () => {
    const endpoint = {
      url: "https://example.com",
      finalUrl: "https://example.com",
      statusCode: 200,
      headers: {},
      setCookies: [],
      body: "<title>Hi</title>",
      redirectChain: [],
    };
    const $ = parseHtml(endpoint);
    expect($("title").text()).toBe("Hi");
    expect(parseHtml(endpoint)).toBe($);
    expect(parseHtml({ ...endpoint })).not.toBe($);
  });
});

describe("letterGrade", () => {
  it.each([
    [9, "A"],
    [7, "A"],
    [5, "B"],
    [3, "C"],
    [1, "D"],
    [0, "F"],
    [-1, "F"],
  ])("%i -> %s", (score, grade) => {
    expect(letterGrade(score)).toBe(grade);
  });
});

describe("USER_AGENT", () => {
  it("includes the package version", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(USER_AGENT).toContain(`site-inspector/${VERSION}`);
  });
});

describe("readBody", () => {
  it("reads the whole body when under the limit", async () => {
    expect(await readBody(new Response("hello"))).toBe("hello");
  });

  it("truncates bodies over the limit", async () => {
    expect(await readBody(new Response("x".repeat(100)), 10)).toBe("x".repeat(10));
  });

  it("returns an empty string when there is no body", async () => {
    expect(await readBody(new Response(null, { status: 204 }))).toBe("");
  });
});

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lowercases headers and keeps each Set-Cookie separately", async () => {
    stubFetch({
      "https://example.com": {
        headers: [
          ["X-Thing", "1"],
          ["Set-Cookie", "a=1"],
          ["Set-Cookie", "b=2"],
        ],
        body: "ok",
      },
    });

    const res = await fetchWithTimeout("https://example.com", 1000);

    expect(res.headers["x-thing"]).toBe("1");
    expect(res.setCookies).toEqual(["a=1", "b=2"]);
    expect(res.body).toBe("ok");
  });

  it("sends the User-Agent", async () => {
    const spy = stubFetch({ "https://example.com": {} });
    await fetchWithTimeout("https://example.com", 1000);
    expect(spy).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({ headers: { "User-Agent": USER_AGENT } }),
    );
  });
});

describe("fetchJson", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed JSON on success", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ key: "value" }),
    });

    const result = await fetchJson("https://example.com/data.json");

    expect(result).toEqual({ key: "value" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/data.json",
      expect.objectContaining({ signal: expect.any(AbortSignal), redirect: "follow" }),
    );
  });

  it("returns null on non-ok response", async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 404 });

    const result = await fetchJson("https://example.com/missing.json");

    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    fetchSpy.mockRejectedValue(new Error("Network error"));

    const result = await fetchJson("https://example.com/fail.json");

    expect(result).toBeNull();
  });

  it("returns null on abort", async () => {
    fetchSpy.mockImplementation(() => {
      throw new DOMException("Aborted", "AbortError");
    });

    const result = await fetchJson("https://example.com/slow.json");

    expect(result).toBeNull();
  });

  it("passes custom timeout", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ data: true }),
    });

    const result = await fetchJson("https://example.com/data.json", 10000);

    expect(result).toEqual({ data: true });
  });
});

describe("probeUrl", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true when status is 200", async () => {
    fetchSpy.mockResolvedValue({ status: 200 });

    const result = await probeUrl("https://example.com/test");

    expect(result).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/test",
      expect.objectContaining({
        method: "HEAD",
        signal: expect.any(AbortSignal),
        redirect: "follow",
      }),
    );
  });

  it("returns false when status is not 200", async () => {
    fetchSpy.mockResolvedValue({ status: 404 });

    const result = await probeUrl("https://example.com/missing");

    expect(result).toBe(false);
  });

  it("returns false on network error", async () => {
    fetchSpy.mockRejectedValue(new Error("Network error"));

    const result = await probeUrl("https://example.com/fail");

    expect(result).toBe(false);
  });

  it("uses custom method", async () => {
    fetchSpy.mockResolvedValue({ status: 200 });

    const result = await probeUrl("https://example.com/test", "GET");

    expect(result).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/test",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("retries as GET when the server rejects HEAD", async () => {
    fetchSpy.mockResolvedValueOnce({ status: 405 }).mockResolvedValueOnce({ status: 200 });

    const result = await probeUrl("https://example.com/test");

    expect(result).toBe(true);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "https://example.com/test",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("releases the response body", async () => {
    const cancel = vi.fn();
    fetchSpy.mockResolvedValue({ status: 200, body: { cancel } });

    await probeUrl("https://example.com/test");

    expect(cancel).toHaveBeenCalled();
  });

  it("returns false for 301 redirect status", async () => {
    fetchSpy.mockResolvedValue({ status: 301 });

    const result = await probeUrl("https://example.com/redir");

    expect(result).toBe(false);
  });

  it("returns false on abort", async () => {
    fetchSpy.mockImplementation(() => {
      throw new DOMException("Aborted", "AbortError");
    });

    const result = await probeUrl("https://example.com/slow");

    expect(result).toBe(false);
  });
});
