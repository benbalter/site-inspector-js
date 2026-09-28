import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { EndpointData } from "../types.js";
import { stubFetch } from "../testing/fetch-stub.js";

const mockIsCatchAll = vi.fn();
vi.mock("../utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils.js")>()),
  isCatchAll: (...args: unknown[]) => mockIsCatchAll(...args) as unknown,
}));

import { AdsTxtCheck, parseAdsTxt } from "./ads-txt.js";

const ORIGIN = "https://www.example.com";

function makeEndpoint(): EndpointData {
  return {
    url: "http://example.com/",
    finalUrl: `${ORIGIN}/`,
    statusCode: 200,
    headers: {},
    setCookies: [],
    body: "",
    redirectChain: [],
  };
}

// Modeled on a real publisher's ads.txt.
const ADS_TXT = [
  "# ads.txt file for example.com",
  "OWNERDOMAIN=example.com",
  "MANAGERDOMAIN=manager.example",
  "contact=adops@example.com",
  "subdomain=news.example.com",
  "google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0",
  "appnexus.com, 1234, RESELLER, f5ab79cb980f11d1 # comment",
  "rubiconproject.com, 11111, reseller",
  "openx.com, 5555, DIRECT;extension=data",
  "",
  "not a record",
  "example.net, 1, PARTNER",
].join("\r\n");

describe("parseAdsTxt", () => {
  it("parses records, variables, and invalid lines", () => {
    expect(parseAdsTxt(ADS_TXT)).toEqual({
      recordCount: 4,
      directCount: 2,
      resellerCount: 2,
      invalidLines: 2,
      ownerDomain: "example.com",
      managerDomains: ["manager.example"],
      contacts: ["adops@example.com"],
      subdomains: ["news.example.com"],
    });
  });

  it("counts records with too many fields as invalid", () => {
    expect(parseAdsTxt("a.com, 1, DIRECT, cert, extra").invalidLines).toBe(1);
  });

  it("handles an empty file", () => {
    expect(parseAdsTxt("").recordCount).toBe(0);
  });
});

describe("AdsTxtCheck", () => {
  const check = new AdsTxtCheck();

  beforeEach(() => {
    mockIsCatchAll.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has the correct name", () => {
    expect(check.name).toBe("ads-txt");
  });

  it("summarizes ads.txt and reports a missing app-ads.txt", async () => {
    stubFetch({
      [`${ORIGIN}/ads.txt`]: { headers: { "content-type": "text/plain" }, body: ADS_TXT },
      [`${ORIGIN}/app-ads.txt`]: { status: 404, body: "Not Found" },
    });
    const result = await check.run(makeEndpoint(), "example.com");
    expect(result).toEqual({
      name: "ads-txt",
      data: {
        adsTxt: {
          present: true,
          recordCount: 4,
          directCount: 2,
          resellerCount: 2,
          invalidLines: 2,
          ownerDomain: "example.com",
          managerDomains: ["manager.example"],
          contacts: ["adops@example.com"],
          subdomains: ["news.example.com"],
        },
        appAdsTxt: {
          present: false,
          recordCount: 0,
          directCount: 0,
          resellerCount: 0,
          invalidLines: 0,
          ownerDomain: null,
          managerDomains: [],
          contacts: [],
          subdomains: [],
        },
      },
    });
  });

  it("treats an HTML 200 as absent", async () => {
    stubFetch({
      [`${ORIGIN}/ads.txt`]: {
        headers: { "content-type": "text/html" },
        body: "<!doctype html><html><body>Page not found</body></html>",
      },
      [`${ORIGIN}/app-ads.txt`]: { body: "<html><body>hi</body></html>" },
    });
    const result = await check.run(makeEndpoint(), "example.com");
    expect((result.data.adsTxt as { present: boolean }).present).toBe(false);
    expect((result.data.appAdsTxt as { present: boolean }).present).toBe(false);
  });

  it("treats a plain-text catch-all response without records as absent", async () => {
    mockIsCatchAll.mockResolvedValue(true);
    stubFetch({
      [`${ORIGIN}/ads.txt`]: { headers: { "content-type": "text/plain" }, body: "OK" },
      [`${ORIGIN}/app-ads.txt`]: {
        headers: { "content-type": "text/plain" },
        body: "google.com, pub-1, DIRECT",
      },
    });
    const result = await check.run(makeEndpoint(), "example.com");
    expect((result.data.adsTxt as { present: boolean }).present).toBe(false);
    expect(result.data.appAdsTxt).toMatchObject({ present: true, directCount: 1 });
  });

  it("reports null when the request fails", async () => {
    stubFetch({});
    const result = await check.run(makeEndpoint(), "example.com");
    expect((result.data.adsTxt as { present: unknown }).present).toBeNull();
    expect((result.data.appAdsTxt as { present: unknown }).present).toBeNull();
  });

  it("passes the context timeout through", async () => {
    stubFetch({});
    await check.run(makeEndpoint(), "example.com", {
      timeoutMs: 1234,
      signal: new AbortController().signal,
    });
    expect(mockIsCatchAll).toHaveBeenCalledWith(ORIGIN, 1234);
  });
});
