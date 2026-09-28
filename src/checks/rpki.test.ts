import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EndpointData } from "../types.js";
import { stubFetch } from "../testing/fetch-stub.js";

vi.mock("node:dns/promises");

import dns from "node:dns/promises";
import { RpkiCheck } from "./rpki.js";

const mockResolve4 = vi.mocked(dns.resolve4);
const mockResolve6 = vi.mocked(dns.resolve6);

const endpoint: EndpointData = {
  url: "https://github.com",
  finalUrl: "https://github.com",
  statusCode: 200,
  headers: {},
  setCookies: [],
  body: "",
  redirectChain: [],
};

const BASE = "https://stat.ripe.net/data";
const NETINFO_V4 = `${BASE}/network-info/data.json?resource=140.82.112.3&sourceapp=site-inspector`;
const RPKI_V4 = `${BASE}/rpki-validation/data.json?resource=36459&prefix=140.82.112.0%2F24&sourceapp=site-inspector`;
const NETINFO_V6 = `${BASE}/network-info/data.json?resource=2606%3A50c0%3A8000%3A%3A153&sourceapp=site-inspector`;
const RPKI_V6 = `${BASE}/rpki-validation/data.json?resource=54113&prefix=2606%3A50c0%3A8000%3A%3A%2F48&sourceapp=site-inspector`;

/** Wrap data in RIPEstat's real response envelope. */
function ripe(data: object) {
  return {
    body: JSON.stringify({
      messages: [],
      see_also: [],
      version: "1.1",
      data_call_status: "supported",
      cached: false,
      status: "ok",
      status_code: 200,
      time: "2026-09-27T23:19:31.899174",
      data,
    }),
  };
}

const netinfoV4 = ripe({ asns: ["36459"], prefix: "140.82.112.0/24" });
const rpkiValidV4 = ripe({
  resource: "36459",
  prefix: "140.82.112.0/24",
  validating_roas: [
    { origin: "36459", prefix: "140.82.112.0/20", validity: "valid", max_length: 24 },
  ],
  status: "valid",
  validator: "routinator",
});

describe("RpkiCheck", () => {
  const check = new RpkiCheck();

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve4.mockResolvedValue(["140.82.112.3"]);
    mockResolve6.mockRejectedValue(
      Object.assign(new Error("queryAaaa ENODATA"), { code: "ENODATA" }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has name 'rpki'", () => {
    expect(check.name).toBe("rpki");
  });

  it("reports a valid IPv4 route", async () => {
    stubFetch({ [NETINFO_V4]: netinfoV4, [RPKI_V4]: rpkiValidV4 });

    const { data } = await check.run(endpoint, "github.com");

    expect(data).toEqual({
      available: true,
      ip: "140.82.112.3",
      prefix: "140.82.112.0/24",
      asn: "36459",
      status: "valid",
      validatingRoas: 1,
      error: null,
      ipv6: null,
    });
  });

  it("checks the IPv6 route too when there's an AAAA record", async () => {
    mockResolve6.mockResolvedValue(["2606:50c0:8000::153"]);
    stubFetch({
      [NETINFO_V4]: netinfoV4,
      [RPKI_V4]: rpkiValidV4,
      [NETINFO_V6]: ripe({ asns: ["54113"], prefix: "2606:50c0:8000::/48" }),
      [RPKI_V6]: ripe({
        resource: "54113",
        prefix: "2606:50c0:8000::/48",
        validating_roas: [],
        status: "unknown",
        validator: "routinator",
      }),
    });

    const { data } = await check.run(endpoint, "github.com");

    expect(data.status).toBe("valid");
    expect(data.ipv6).toEqual({
      ip: "2606:50c0:8000::153",
      prefix: "2606:50c0:8000::/48",
      asn: "54113",
      status: "unknown",
      validatingRoas: 0,
      error: null,
    });
  });

  it("passes an invalid status through", async () => {
    stubFetch({
      [NETINFO_V4]: netinfoV4,
      [RPKI_V4]: ripe({
        resource: "36459",
        prefix: "140.82.112.0/24",
        validating_roas: [
          { origin: "64500", prefix: "140.82.112.0/20", validity: "invalid_asn", max_length: 24 },
        ],
        status: "invalid",
        validator: "routinator",
      }),
    });

    const { data } = await check.run(endpoint, "github.com");

    expect(data.available).toBe(true);
    expect(data.status).toBe("invalid");
    expect(data.validatingRoas).toBe(1);
  });

  it("reports an unannounced address without a status", async () => {
    mockResolve4.mockResolvedValue(["10.0.0.1"]);
    const spy = stubFetch({
      [`${BASE}/network-info/data.json?resource=10.0.0.1&sourceapp=site-inspector`]: ripe({
        asns: [],
        prefix: "",
      }),
    });

    const { data } = await check.run(endpoint, "github.com");

    expect(data).toMatchObject({
      available: true,
      ip: "10.0.0.1",
      prefix: null,
      asn: null,
      status: null,
      error: null,
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("treats a RIPEstat outage as unavailable, not as unknown", async () => {
    stubFetch({ [NETINFO_V4]: { status: 503, body: "Service Unavailable" } });

    const { data } = await check.run(endpoint, "github.com");

    expect(data.available).toBe(false);
    expect(data.ip).toBe("140.82.112.3");
    expect(data.status).toBeNull();
    expect(data.error).toBe("RIPEstat network-info returned HTTP 503");
  });

  it("treats a RIPEstat error envelope as unavailable", async () => {
    stubFetch({
      [NETINFO_V4]: { body: JSON.stringify({ status: "error", status_code: 500, data: {} }) },
    });

    const { data } = await check.run(endpoint, "github.com");

    expect(data.available).toBe(false);
    expect(data.error).toBe("RIPEstat network-info failed");
  });

  it("reports a domain with no addresses", async () => {
    mockResolve4.mockRejectedValue(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }));
    const spy = stubFetch({});

    const { data } = await check.run(endpoint, "github.com");

    expect(data.available).toBe(false);
    expect(data.ip).toBeNull();
    expect(data.error).toBe("No A or AAAA records");
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports a failed DNS lookup as an error", async () => {
    mockResolve4.mockRejectedValue(
      Object.assign(new Error("queryA ESERVFAIL github.com"), { code: "ESERVFAIL" }),
    );
    stubFetch({});

    const { data } = await check.run(endpoint, "github.com");

    expect(data.available).toBe(false);
    expect(data.error).toBe("DNS lookup failed: queryA ESERVFAIL github.com");
  });

  it("stops when the check's signal aborts", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            const signal = init.signal;
            if (signal?.aborted) reject(signal.reason);
            signal?.addEventListener("abort", () => reject(signal.reason));
          }),
      ),
    );

    const pending = check.run(endpoint, "github.com", {
      timeoutMs: 10_000,
      signal: controller.signal,
    });
    controller.abort(new Error("check timed out"));
    const { data } = await pending;

    expect(data.available).toBe(false);
    expect(data.error).toBe("check timed out");
  });
});
