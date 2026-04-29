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
        return Promise.resolve([
          ["v=DMARC1; p=reject; pct=100; rua=mailto:dmarc@example.com"],
        ]);
      }
      return Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
    });

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.name).toBe("dns-security");
    expect(result.data.spf).toEqual({
      exists: true,
      record: "v=spf1 include:_spf.google.com -all",
      allMechanism: "-all",
      strongPolicy: true,
    });
    expect(result.data.dmarc).toEqual({
      exists: true,
      record: "v=DMARC1; p=reject; pct=100; rua=mailto:dmarc@example.com",
      policy: "reject",
      percentage: 100,
      reportUri: "mailto:dmarc@example.com",
      strongPolicy: true,
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
    mockResolveTxt.mockRejectedValue(
      Object.assign(new Error("ENODATA"), { code: "ENODATA" }),
    );

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
});
