import { describe, it, expect, vi, afterEach } from "vitest";
import type { EndpointData } from "../types.js";
import { DnssecCheck } from "./dnssec.js";
import { stubFetch, type FakeResponse } from "../testing/fetch-stub.js";

const dummyEndpoint: EndpointData = {
  url: "https://example.com",
  finalUrl: "https://example.com",
  statusCode: 200,
  headers: {},
  setCookies: [],
  body: "",
  redirectChain: [],
};

const TYPES = { A: 1, DS: 43, RRSIG: 46, DNSKEY: 48 } as const;

/** Stub dns.google responses per record type for `name`. */
function stubDoh(
  name: string,
  answers: Partial<Record<keyof typeof TYPES, { AD?: boolean; count?: number }>>,
  override?: FakeResponse,
) {
  const routes: Record<string, FakeResponse> = {};
  for (const [type, num] of Object.entries(TYPES)) {
    const a = answers[type as keyof typeof TYPES] ?? {};
    routes[`https://dns.google/resolve?name=${name}&type=${num}&do=1`] = override ?? {
      body: JSON.stringify({
        Status: 0,
        AD: a.AD ?? false,
        Answer: a.count
          ? Array.from({ length: a.count }, () => ({ type: num, data: "…" }))
          : undefined,
      }),
    };
  }
  return stubFetch(routes);
}

describe("DnssecCheck", () => {
  const check = new DnssecCheck();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports a signed, validated zone apex", async () => {
    stubDoh("example.com", {
      A: { AD: true, count: 1 },
      DNSKEY: { AD: true, count: 2 },
      DS: { AD: true, count: 1 },
      RRSIG: { count: 1 },
    });

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.name).toBe("dnssec");
    expect(result.data).toEqual({
      enabled: true,
      adFlag: true,
      hasDnskey: true,
      hasDs: true,
      hasRrsig: true,
      error: null,
    });
  });

  it("detects a signed subdomain, which has no DNSKEY/DS of its own", async () => {
    stubDoh("blog.example.com", { A: { AD: true, count: 1 } });

    const result = await check.run(dummyEndpoint, "blog.example.com");

    expect(result.data).toMatchObject({ enabled: true, adFlag: true, hasDnskey: false });
  });

  it("reports an unsigned domain as disabled", async () => {
    stubDoh("example.com", { A: { count: 1 } });

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.data).toMatchObject({ enabled: false, adFlag: false, error: null });
  });

  it("counts DNSKEY records without validation as enabled but not validated", async () => {
    stubDoh("example.com", { A: { count: 1 }, DNSKEY: { count: 1 } });

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.data).toMatchObject({ enabled: true, adFlag: false, hasDnskey: true });
  });

  it("reports an error when the DoH service fails", async () => {
    stubDoh("example.com", {}, { status: 502, body: "<html>Bad gateway</html>" });

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.data).toMatchObject({ enabled: false, error: "DNS-over-HTTPS lookup failed" });
  });

  it("reports an error when the DoH service is unreachable", async () => {
    stubFetch({});

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.data).toMatchObject({ enabled: false, adFlag: false });
    expect(result.data.error).toBeTruthy();
  });
});
