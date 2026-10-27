import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EndpointData } from "../types.js";

const { mockResolveTxt, mockResolveMx, mockResolveTlsa } = vi.hoisted(() => ({
  mockResolveTxt: vi.fn(),
  mockResolveMx: vi.fn(),
  mockResolveTlsa: vi.fn(),
}));

const mockSafeFetch = vi.fn();

vi.mock("node:dns/promises", () => ({
  default: { resolveTxt: mockResolveTxt, resolveMx: mockResolveMx, resolveTlsa: mockResolveTlsa },
}));

vi.mock("../utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils.js")>()),
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}));

import { EmailSecurityCheck } from "./email-security.js";

const placeholderEndpoint: EndpointData = {
  url: "https://example.com",
  statusCode: 200,
  headers: {},
  body: "",
  finalUrl: "https://example.com",
  setCookies: [],
  redirectChain: [],
};

describe("EmailSecurityCheck", () => {
  const check = new EmailSecurityCheck();

  const absent = () => Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveMx.mockImplementation(absent);
    mockResolveTlsa.mockImplementation(absent);
  });

  it("has the correct name", () => {
    expect(check.name).toBe("email-security");
  });

  it("returns all records when BIMI, MTA-STS, and TLS-RPT are present", async () => {
    mockResolveTxt.mockImplementation((domain: string) => {
      if (domain === "default._bimi.example.com") {
        return Promise.resolve([["v=BIMI1; l=https://example.com/logo.svg"]]);
      }
      if (domain === "_mta-sts.example.com") {
        return Promise.resolve([["v=STSv1; id=20230101T000000Z"]]);
      }
      if (domain === "_smtp._tls.example.com") {
        return Promise.resolve([["v=TLSRPTv1; rua=mailto:tlsrpt@example.com"]]);
      }
      return Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
    });

    mockSafeFetch.mockResolvedValue({
      statusCode: 200,
      body: "version: STSv1\nmode: enforce\nmx: mail.example.com\n",
    });

    const result = await check.run(placeholderEndpoint, "example.com");

    expect(result.name).toBe("email-security");
    expect(result.data.bimi).toEqual({
      exists: true,
      record: "v=BIMI1; l=https://example.com/logo.svg",
      logo: "https://example.com/logo.svg",
      error: null,
    });
    expect(result.data.mtaSts).toEqual({
      exists: true,
      record: "v=STSv1; id=20230101T000000Z",
      mode: "enforce",
      error: null,
    });
    expect(result.data.tlsRpt).toEqual({
      exists: true,
      record: "v=TLSRPTv1; rua=mailto:tlsrpt@example.com",
      error: null,
    });
  });

  it("detects BIMI with logo URL", async () => {
    mockResolveTxt.mockImplementation((domain: string) => {
      if (domain === "default._bimi.example.com") {
        return Promise.resolve([
          ["v=BIMI1; l=https://example.com/bimi-logo.svg; a=https://example.com/vmc"],
        ]);
      }
      return Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
    });

    mockSafeFetch.mockResolvedValue(null);

    const result = await check.run(placeholderEndpoint, "example.com");
    const bimi = result.data.bimi as Record<string, unknown>;

    expect(bimi.exists).toBe(true);
    expect(bimi.logo).toBe("https://example.com/bimi-logo.svg");
  });

  it("handles BIMI without logo URL", async () => {
    mockResolveTxt.mockImplementation((domain: string) => {
      if (domain === "default._bimi.example.com") {
        return Promise.resolve([["v=BIMI1; a=https://example.com/vmc"]]);
      }
      return Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
    });

    mockSafeFetch.mockResolvedValue(null);

    const result = await check.run(placeholderEndpoint, "example.com");
    const bimi = result.data.bimi as Record<string, unknown>;

    expect(bimi.exists).toBe(true);
    expect(bimi.logo).toBe(null);
  });

  it("detects MTA-STS with enforce mode", async () => {
    mockResolveTxt.mockImplementation((domain: string) => {
      if (domain === "_mta-sts.example.com") {
        return Promise.resolve([["v=STSv1; id=20230101T000000Z"]]);
      }
      return Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
    });

    mockSafeFetch.mockResolvedValue({
      statusCode: 200,
      body: "version: STSv1\nmode: enforce\nmx: mail.example.com\n",
    });

    const result = await check.run(placeholderEndpoint, "example.com");
    const mtaSts = result.data.mtaSts as Record<string, unknown>;

    expect(mtaSts.exists).toBe(true);
    expect(mtaSts.mode).toBe("enforce");
  });

  it("fetches the MTA-STS policy from the mta-sts subdomain (RFC 8461)", async () => {
    mockResolveTxt.mockRejectedValue(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
    mockSafeFetch.mockResolvedValue(null);

    await check.run(placeholderEndpoint, "example.com");

    expect(mockSafeFetch).toHaveBeenCalledWith(
      "https://mta-sts.example.com/.well-known/mta-sts.txt",
      expect.any(Number),
    );
  });

  it("reports DNS failures rather than treating them as missing records", async () => {
    mockResolveTxt.mockRejectedValue(Object.assign(new Error("timeout"), { code: "ETIMEOUT" }));
    mockSafeFetch.mockResolvedValue(null);

    const result = await check.run(placeholderEndpoint, "example.com");

    expect(result.data.bimi).toMatchObject({ exists: false, error: "ETIMEOUT" });
    expect(result.data.mtaSts).toMatchObject({ exists: false, error: "ETIMEOUT" });
    expect(result.data.tlsRpt).toMatchObject({ exists: false, error: "ETIMEOUT" });
  });

  it("detects MTA-STS with testing mode", async () => {
    mockResolveTxt.mockImplementation((domain: string) => {
      if (domain === "_mta-sts.example.com") {
        return Promise.resolve([["v=STSv1; id=20230101T000000Z"]]);
      }
      return Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
    });

    mockSafeFetch.mockResolvedValue({
      statusCode: 200,
      body: "version: STSv1\nmode: testing\nmx: mail.example.com\n",
    });

    const result = await check.run(placeholderEndpoint, "example.com");
    const mtaSts = result.data.mtaSts as Record<string, unknown>;

    expect(mtaSts.mode).toBe("testing");
  });

  it("returns null mode when MTA-STS policy file is not available", async () => {
    mockResolveTxt.mockImplementation((domain: string) => {
      if (domain === "_mta-sts.example.com") {
        return Promise.resolve([["v=STSv1; id=20230101T000000Z"]]);
      }
      return Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
    });

    mockSafeFetch.mockResolvedValue(null);

    const result = await check.run(placeholderEndpoint, "example.com");
    const mtaSts = result.data.mtaSts as Record<string, unknown>;

    expect(mtaSts.exists).toBe(true);
    expect(mtaSts.mode).toBe(null);
  });

  it("returns null mode when MTA-STS policy file returns non-200 status", async () => {
    mockResolveTxt.mockImplementation((domain: string) => {
      if (domain === "_mta-sts.example.com") {
        return Promise.resolve([["v=STSv1; id=20230101T000000Z"]]);
      }
      return Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
    });

    mockSafeFetch.mockResolvedValue({
      statusCode: 404,
      body: "",
    });

    const result = await check.run(placeholderEndpoint, "example.com");
    const mtaSts = result.data.mtaSts as Record<string, unknown>;

    expect(mtaSts.mode).toBe(null);
  });

  it("returns null mode when policy file has no mode value", async () => {
    mockResolveTxt.mockImplementation((domain: string) => {
      if (domain === "_mta-sts.example.com") {
        return Promise.resolve([["v=STSv1; id=20230101T000000Z"]]);
      }
      return Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
    });

    mockSafeFetch.mockResolvedValue({
      statusCode: 200,
      body: "version: STSv1\nmx: mail.example.com\n",
    });

    const result = await check.run(placeholderEndpoint, "example.com");
    const mtaSts = result.data.mtaSts as Record<string, unknown>;

    expect(mtaSts.mode).toBe(null);
  });

  it("detects TLS-RPT record", async () => {
    mockResolveTxt.mockImplementation((domain: string) => {
      if (domain === "_smtp._tls.example.com") {
        return Promise.resolve([["v=TLSRPTv1; rua=mailto:tlsrpt@example.com"]]);
      }
      return Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
    });

    mockSafeFetch.mockResolvedValue(null);

    const result = await check.run(placeholderEndpoint, "example.com");
    const tlsRpt = result.data.tlsRpt as Record<string, unknown>;

    expect(tlsRpt.exists).toBe(true);
    expect(tlsRpt.record).toBe("v=TLSRPTv1; rua=mailto:tlsrpt@example.com");
  });

  it("returns no records when all DNS lookups fail", async () => {
    mockResolveTxt.mockRejectedValue(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));

    mockSafeFetch.mockResolvedValue(null);

    const result = await check.run(placeholderEndpoint, "example.com");

    expect(result.data.bimi).toEqual({ exists: false, record: null, logo: null, error: null });
    expect(result.data.mtaSts).toEqual({ exists: false, record: null, mode: null, error: null });
    expect(result.data.tlsRpt).toEqual({ exists: false, record: null, error: null });
  });

  it("handles fetch timeout for MTA-STS policy file", async () => {
    mockResolveTxt.mockImplementation((domain: string) => {
      if (domain === "_mta-sts.example.com") {
        return Promise.resolve([["v=STSv1; id=20230101T000000Z"]]);
      }
      return Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
    });

    mockSafeFetch.mockResolvedValue(null);

    const result = await check.run(placeholderEndpoint, "example.com");
    const mtaSts = result.data.mtaSts as Record<string, unknown>;

    expect(mtaSts.exists).toBe(true);
    expect(mtaSts.mode).toBe(null);
  });

  it("extracts mode from policy file with whitespace variations", async () => {
    mockResolveTxt.mockImplementation((domain: string) => {
      if (domain === "_mta-sts.example.com") {
        return Promise.resolve([["v=STSv1; id=20230101T000000Z"]]);
      }
      return Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
    });

    mockSafeFetch.mockResolvedValue({
      statusCode: 200,
      body: "version: STSv1\nmode:   enforce  \nmx: mail.example.com\n",
    });

    const result = await check.run(placeholderEndpoint, "example.com");
    const mtaSts = result.data.mtaSts as Record<string, unknown>;

    expect(mtaSts.mode).toBe("enforce");
  });

  it("handles multiple TXT records and extracts the v=TLSRPTv1 record", async () => {
    mockResolveTxt.mockImplementation((domain: string) => {
      if (domain === "_smtp._tls.example.com") {
        return Promise.resolve([["v=TLSRPTv1; rua=mailto:tlsrpt@example.com"], ["other=data"]]);
      }
      return Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
    });

    mockSafeFetch.mockResolvedValue(null);

    const result = await check.run(placeholderEndpoint, "example.com");
    const tlsRpt = result.data.tlsRpt as Record<string, unknown>;

    expect(tlsRpt.exists).toBe(true);
    expect(tlsRpt.record).toBe("v=TLSRPTv1; rua=mailto:tlsrpt@example.com");
  });

  it("returns proper structure even when some records are missing", async () => {
    mockResolveTxt.mockImplementation((domain: string) => {
      if (domain === "default._bimi.example.com") {
        return Promise.resolve([["v=BIMI1; l=https://example.com/logo.svg"]]);
      }
      return Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
    });

    mockSafeFetch.mockResolvedValue(null);

    const result = await check.run(placeholderEndpoint, "example.com");

    expect(result.data).toHaveProperty("bimi");
    expect(result.data).toHaveProperty("mtaSts");
    expect(result.data).toHaveProperty("tlsRpt");
    expect(result.data.bimi).toHaveProperty("exists");
    expect(result.data.bimi).toHaveProperty("record");
    expect(result.data.bimi).toHaveProperty("logo");
    expect(result.data.mtaSts).toHaveProperty("exists");
    expect(result.data.mtaSts).toHaveProperty("record");
    expect(result.data.mtaSts).toHaveProperty("mode");
    expect(result.data.tlsRpt).toHaveProperty("exists");
    expect(result.data.tlsRpt).toHaveProperty("record");
  });

  describe("DKIM", () => {
    it("finds DKIM keys at common selectors", async () => {
      mockSafeFetch.mockResolvedValue(null);
      mockResolveTxt.mockImplementation((name: string) => {
        if (name === "google._domainkey.example.com") {
          return Promise.resolve([["v=DKIM1; k=rsa; p=MIIBIjANBgkqh", "kiG9w0BAQEFAAOCAQ8AMIIB"]]);
        }
        // Microsoft 365's selectors are CNAMEs; resolveTxt follows them.
        if (name === "selector1._domainkey.example.com") {
          return Promise.resolve([["v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3"]]);
        }
        return absent();
      });

      const result = await check.run(placeholderEndpoint, "example.com");

      expect(result.data.dkim).toMatchObject({
        exists: true,
        selectors: ["google", "selector1"],
        error: null,
      });
      expect((result.data.dkim as { checked: number }).checked).toBeGreaterThan(10);
    });

    it("reports no DKIM found as unknown rather than absent, since selectors can't be listed", async () => {
      mockSafeFetch.mockResolvedValue(null);
      mockResolveTxt.mockImplementation(absent);

      const result = await check.run(placeholderEndpoint, "example.com");

      expect(result.data.dkim).toMatchObject({ exists: false, selectors: [] });
    });

    it("ignores TXT records at a selector that aren't DKIM keys", async () => {
      mockSafeFetch.mockResolvedValue(null);
      mockResolveTxt.mockImplementation((name: string) =>
        name === "default._domainkey.example.com"
          ? Promise.resolve([["some-verification-token"]])
          : absent(),
      );

      const result = await check.run(placeholderEndpoint, "example.com");

      expect(result.data.dkim).toMatchObject({ exists: false, selectors: [] });
    });
  });

  describe("DANE", () => {
    it("reports TLSA records for the domain's mail servers", async () => {
      mockSafeFetch.mockResolvedValue(null);
      mockResolveTxt.mockImplementation(absent);
      mockResolveMx.mockResolvedValue([
        { exchange: "mx2.example.com", priority: 20 },
        { exchange: "mx1.example.com", priority: 10 },
      ]);
      mockResolveTlsa.mockImplementation((name: string) =>
        name === "_25._tcp.mx1.example.com"
          ? Promise.resolve([{ certUsage: 3, selector: 1, match: 1, data: new ArrayBuffer(32) }])
          : absent(),
      );

      const result = await check.run(placeholderEndpoint, "example.com");

      expect(result.data.dane).toEqual({
        exists: true,
        mxHosts: ["mx1.example.com", "mx2.example.com"],
        hostsWithTlsa: ["mx1.example.com"],
        error: null,
      });
    });

    it("reports no DANE for a domain without mail servers", async () => {
      mockSafeFetch.mockResolvedValue(null);
      mockResolveTxt.mockImplementation(absent);

      const result = await check.run(placeholderEndpoint, "example.com");

      expect(result.data.dane).toEqual({
        exists: false,
        mxHosts: [],
        hostsWithTlsa: [],
        error: null,
      });
    });

    it("reports a failed MX lookup as an error, not as no DANE", async () => {
      mockSafeFetch.mockResolvedValue(null);
      mockResolveTxt.mockImplementation(absent);
      mockResolveMx.mockRejectedValue(Object.assign(new Error("SERVFAIL"), { code: "ESERVFAIL" }));

      const result = await check.run(placeholderEndpoint, "example.com");

      expect(result.data.dane).toMatchObject({ exists: false, error: "ESERVFAIL" });
    });
  });
});
