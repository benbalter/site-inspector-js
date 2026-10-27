import { describe, it, expect, afterEach, vi } from "vitest";
import { WebPresenceCheck } from "./web-presence.js";
import { stubFetch } from "../testing/fetch-stub.js";
import type { EndpointData } from "../types.js";

const endpoint: EndpointData = {
  url: "https://example.com",
  finalUrl: "https://example.com",
  statusCode: 200,
  headers: {},
  setCookies: [],
  body: "",
  redirectChain: [],
};

const WAYBACK =
  "https://web.archive.org/cdx/search/cdx?url=example.com&limit=1&output=json&fl=timestamp";
const TRANCO = "https://tranco-list.eu/api/ranks/domain/example.com";

describe("WebPresenceCheck", () => {
  const check = new WebPresenceCheck();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has the name 'web-presence'", () => {
    expect(check.name).toBe("web-presence");
  });

  it("reports the first archived snapshot and the latest Tranco rank", async () => {
    // Shaped like real responses: the CDX API's header row, then the earliest
    // capture; Tranco's ranks newest first.
    stubFetch({
      [WAYBACK]: { body: '[["timestamp"],\n["20110202130255"]]' },
      [TRANCO]: {
        body: JSON.stringify({
          ranks: [
            { date: "2026-10-26", rank: 33 },
            { date: "2026-10-25", rank: 32 },
          ],
          domain: "example.com",
        }),
      },
    });

    const result = await check.run(endpoint, "example.com");

    expect(result.data).toEqual({
      archived: true,
      firstArchived: "2011-02-02T13:02:55Z",
      archiveLookupFailed: false,
      ranked: true,
      trancoRank: 33,
      trancoRankDate: "2026-10-26",
      rankLookupFailed: false,
    });
  });

  it("reports a domain that was never archived or ranked", async () => {
    stubFetch({
      [WAYBACK]: { body: "[]" },
      [TRANCO]: { body: JSON.stringify({ ranks: [], domain: "example.com" }) },
    });

    const result = await check.run(endpoint, "example.com");

    expect(result.data).toMatchObject({
      archived: false,
      firstArchived: null,
      archiveLookupFailed: false,
      ranked: false,
      trancoRank: null,
      rankLookupFailed: false,
    });
  });

  it("separates failed lookups, like Tranco's rate limit, from absent data", async () => {
    stubFetch({ [TRANCO]: { status: 429, body: "Too Many Requests" } });

    const result = await check.run(endpoint, "example.com");

    expect(result.data).toMatchObject({
      archived: null,
      archiveLookupFailed: true,
      ranked: null,
      trancoRank: null,
      rankLookupFailed: true,
    });
  });
});
