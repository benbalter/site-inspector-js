import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EndpointData } from "../types.js";

const { mockResolveTxt } = vi.hoisted(() => ({
  mockResolveTxt: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({
  default: { resolveTxt: mockResolveTxt },
}));

import { DnsSecurityCheck } from "./dns-security.js";

const dummyEndpoint: EndpointData = {
  url: "https://example.com",
  statusCode: 200,
  headers: {},
  body: "",
  finalUrl: "https://example.com",
  setCookies: [],
  redirectChain: [],
};

describe("DnsSecurityCheck", () => {
  const check = new DnsSecurityCheck();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns SPF and DMARC data for a domain with both records", async () => {
    mockResolveTxt.mockImplementation((domain: string) => {
      if (domain === "example.com") {
        return Promise.resolve([["v=spf1 include:_spf.google.com -all"]]);
      }
      if (domain === "_dmarc.example.com") {
        return Promise.resolve([["v=DMARC1; p=reject; pct=100; rua=mailto:dmarc@example.com"]]);
      }
      return Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
    });

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.name).toBe("dns-security");
    expect(result.data.spf).toEqual({
      exists: true,
      record: "v=spf1 include:_spf.google.com -all",
      allMechanism: "-all",
      multipleRecords: false,
      strongPolicy: true,
      error: null,
    });
    expect(result.data.dmarc).toEqual({
      exists: true,
      record: "v=DMARC1; p=reject; pct=100; rua=mailto:dmarc@example.com",
      policy: "reject",
      subdomainPolicy: null,
      percentage: 100,
      reportUri: "mailto:dmarc@example.com",
      strongPolicy: true,
      error: null,
    });
  });

  it("returns SPF only when DMARC is missing", async () => {
    mockResolveTxt.mockImplementation((domain: string) => {
      if (domain === "example.com") {
        return Promise.resolve([["v=spf1 ~all"]]);
      }
      return Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
    });

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.data.spf).toMatchObject({ exists: true, record: "v=spf1 ~all" });
    expect(result.data.dmarc).toMatchObject({
      exists: false,
      record: null,
      policy: null,
      strongPolicy: false,
    });
  });

  it("handles domain with no TXT records at all", async () => {
    mockResolveTxt.mockRejectedValue(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.data.spf).toMatchObject({ exists: false, record: null, strongPolicy: false });
    expect(result.data.dmarc).toMatchObject({ exists: false, record: null, strongPolicy: false });
  });

  it("detects -all as strong SPF policy", async () => {
    mockResolveTxt.mockImplementation((domain: string) => {
      if (domain === "example.com") {
        return Promise.resolve([["v=spf1 include:example.com -all"]]);
      }
      return Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
    });

    const result = await check.run(dummyEndpoint, "example.com");
    const spf = result.data.spf as Record<string, unknown>;

    expect(spf.allMechanism).toBe("-all");
    expect(spf.strongPolicy).toBe(true);
  });

  it("detects ~all as weak SPF policy", async () => {
    mockResolveTxt.mockImplementation((domain: string) => {
      if (domain === "example.com") {
        return Promise.resolve([["v=spf1 include:example.com ~all"]]);
      }
      return Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
    });

    const result = await check.run(dummyEndpoint, "example.com");
    const spf = result.data.spf as Record<string, unknown>;

    expect(spf.allMechanism).toBe("~all");
    expect(spf.strongPolicy).toBe(false);
  });

  it("detects p=reject as strong DMARC policy", async () => {
    mockResolveTxt.mockImplementation((domain: string) => {
      if (domain === "example.com") {
        return Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
      }
      if (domain === "_dmarc.example.com") {
        return Promise.resolve([["v=DMARC1; p=reject"]]);
      }
      return Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
    });

    const result = await check.run(dummyEndpoint, "example.com");
    const dmarc = result.data.dmarc as Record<string, unknown>;

    expect(dmarc.policy).toBe("reject");
    expect(dmarc.strongPolicy).toBe(true);
  });

  it("detects p=none as weak DMARC policy", async () => {
    mockResolveTxt.mockImplementation((domain: string) => {
      if (domain === "example.com") {
        return Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
      }
      if (domain === "_dmarc.example.com") {
        return Promise.resolve([["v=DMARC1; p=none; rua=mailto:reports@example.com"]]);
      }
      return Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
    });

    const result = await check.run(dummyEndpoint, "example.com");
    const dmarc = result.data.dmarc as Record<string, unknown>;

    expect(dmarc.policy).toBe("none");
    expect(dmarc.strongPolicy).toBe(false);
    expect(dmarc.reportUri).toBe("mailto:reports@example.com");
  });

  describe("record parsing", () => {
    /** Serve TXT records by name; anything else is NXDOMAIN. */
    function serve(records: Record<string, string[]>) {
      mockResolveTxt.mockImplementation((name: string) =>
        records[name]
          ? Promise.resolve(records[name].map((r) => [r]))
          : Promise.reject(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" })),
      );
    }
    const spf = async () =>
      (await check.run(dummyEndpoint, "example.com")).data.spf as Record<string, unknown>;
    const dmarc = async () =>
      (await check.run(dummyEndpoint, "example.com")).data.dmarc as Record<string, unknown>;

    it("reads a bare 'all' as +all (pass everything)", async () => {
      serve({ "example.com": ["v=spf1 a mx all"] });
      expect(await spf()).toMatchObject({ allMechanism: "+all", strongPolicy: false });
    });

    it("doesn't mistake an include domain ending in -all for the all mechanism", async () => {
      serve({ "example.com": ["v=spf1 include:mail-all.example.net ~all"] });
      expect(await spf()).toMatchObject({ allMechanism: "~all" });
    });

    it("ignores records that only look like SPF", async () => {
      serve({ "example.com": ["v=spf10 -all"] });
      expect(await spf()).toMatchObject({ exists: false, record: null });
    });

    it("flags multiple SPF records, which is a permerror", async () => {
      serve({ "example.com": ["v=spf1 -all", "v=spf1 include:x.example -all"] });
      expect(await spf()).toMatchObject({
        exists: true,
        multipleRecords: true,
        strongPolicy: false,
      });
    });

    it("reads p= even when sp= comes first", async () => {
      serve({ "_dmarc.example.com": ["v=DMARC1; sp=none; p=reject"] });
      expect(await dmarc()).toMatchObject({
        policy: "reject",
        subdomainPolicy: "none",
        strongPolicy: true,
      });
    });

    it("reports lookup failures instead of treating them as missing records", async () => {
      mockResolveTxt.mockRejectedValue(
        Object.assign(new Error("queryTxt ESERVFAIL example.com"), { code: "ESERVFAIL" }),
      );
      const result = await check.run(dummyEndpoint, "example.com");
      expect(result.data.spf).toMatchObject({ exists: false, error: "ESERVFAIL" });
      expect(result.data.dmarc).toMatchObject({ exists: false, error: "ESERVFAIL" });
    });

    it("treats NXDOMAIN and NODATA as simply absent", async () => {
      serve({});
      expect(await spf()).toMatchObject({ exists: false, error: null });
    });
  });
});
