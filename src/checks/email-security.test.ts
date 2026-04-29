import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EndpointData } from "../types.js";

const { mockResolveTxt } = vi.hoisted(() => ({
  mockResolveTxt: vi.fn(),
}));

const mockSafeFetch = vi.fn();

vi.mock("node:dns/promises", () => ({
  default: { resolveTxt: mockResolveTxt },
}));

vi.mock("../utils.js", () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}));

import { EmailSecurityCheck } from "./email-security.js";

const dummyEndpoint: EndpointData = {
  url: "https://example.com",
  statusCode: 200,
  headers: {},
  body: "",
  redirectChain: [],
};

describe("EmailSecurityCheck", () => {
  const check = new EmailSecurityCheck();

  beforeEach(() => {
    vi.clearAllMocks();
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

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.name).toBe("email-security");
    expect(result.data.bimi).toEqual({
      exists: true,
      record: "v=BIMI1; l=https://example.com/logo.svg",
      logo: "https://example.com/logo.svg",
    });
    expect(result.data.mtaSts).toEqual({
      exists: true,
      record: "v=STSv1; id=20230101T000000Z",
      mode: "enforce",
    });
    expect(result.data.tlsRpt).toEqual({
      exists: true,
      record: "v=TLSRPTv1; rua=mailto:tlsrpt@example.com",
    });
  });

  it("detects BIMI with logo URL", async () => {
    mockResolveTxt.mockImplementation((domain: string) => {
      if (domain === "default._bimi.example.com") {
        return Promise.resolve([["v=BIMI1; l=https://example.com/bimi-logo.svg; a=https://example.com/vmc"]]);
      }
      return Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
    });

    mockSafeFetch.mockResolvedValue(null);

    const result = await check.run(dummyEndpoint, "example.com");
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

    const result = await check.run(dummyEndpoint, "example.com");
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

    const result = await check.run(dummyEndpoint, "example.com");
    const mtaSts = result.data.mtaSts as Record<string, unknown>;

    expect(mtaSts.exists).toBe(true);
    expect(mtaSts.mode).toBe("enforce");
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

    const result = await check.run(dummyEndpoint, "example.com");
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

    const result = await check.run(dummyEndpoint, "example.com");
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

    const result = await check.run(dummyEndpoint, "example.com");
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

    const result = await check.run(dummyEndpoint, "example.com");
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

    const result = await check.run(dummyEndpoint, "example.com");
    const tlsRpt = result.data.tlsRpt as Record<string, unknown>;

    expect(tlsRpt.exists).toBe(true);
    expect(tlsRpt.record).toBe("v=TLSRPTv1; rua=mailto:tlsrpt@example.com");
  });

  it("returns no records when all DNS lookups fail", async () => {
    mockResolveTxt.mockRejectedValue(
      Object.assign(new Error("ENODATA"), { code: "ENODATA" }),
    );

    mockSafeFetch.mockResolvedValue(null);

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.data.bimi).toEqual({ exists: false, record: null, logo: null });
    expect(result.data.mtaSts).toEqual({ exists: false, record: null, mode: null });
    expect(result.data.tlsRpt).toEqual({ exists: false, record: null });
  });

  it("handles fetch timeout for MTA-STS policy file", async () => {
    mockResolveTxt.mockImplementation((domain: string) => {
      if (domain === "_mta-sts.example.com") {
        return Promise.resolve([["v=STSv1; id=20230101T000000Z"]]);
      }
      return Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
    });

    mockSafeFetch.mockResolvedValue(null);

    const result = await check.run(dummyEndpoint, "example.com");
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

    const result = await check.run(dummyEndpoint, "example.com");
    const mtaSts = result.data.mtaSts as Record<string, unknown>;

    expect(mtaSts.mode).toBe("enforce");
  });

  it("handles multiple TXT records and extracts the v=TLSRPTv1 record", async () => {
    mockResolveTxt.mockImplementation((domain: string) => {
      if (domain === "_smtp._tls.example.com") {
        return Promise.resolve([
          ["v=TLSRPTv1; rua=mailto:tlsrpt@example.com"],
          ["other=data"],
        ]);
      }
      return Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
    });

    mockSafeFetch.mockResolvedValue(null);

    const result = await check.run(dummyEndpoint, "example.com");
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

    const result = await check.run(dummyEndpoint, "example.com");

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
});
