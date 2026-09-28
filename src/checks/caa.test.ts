import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EndpointData } from "../types.js";

const { mockResolveCaa } = vi.hoisted(() => ({ mockResolveCaa: vi.fn() }));

vi.mock("node:dns/promises", () => ({
  default: { resolveCaa: mockResolveCaa },
}));

import { CaaCheck, caaSearchPath } from "./caa.js";

const endpoint: EndpointData = {
  url: "https://example.com",
  finalUrl: "https://example.com/",
  statusCode: 200,
  headers: {},
  setCookies: [],
  body: "",
  redirectChain: [],
};

const dnsError = (code: string) => Object.assign(new Error(`queryCaa ${code}`), { code });

function records(byName: Record<string, object[] | string>) {
  mockResolveCaa.mockImplementation((name: string) => {
    const r = byName[name];
    if (r === undefined) return Promise.reject(dnsError("ENODATA"));
    if (typeof r === "string") return Promise.reject(dnsError(r));
    return Promise.resolve(r);
  });
}

describe("caaSearchPath", () => {
  it("walks labels up to the last two", () => {
    expect(caaSearchPath("a.b.example.com")).toEqual([
      "a.b.example.com",
      "b.example.com",
      "example.com",
    ]);
  });

  it("handles two-label, one-label, and trailing-dot names", () => {
    expect(caaSearchPath("example.com")).toEqual(["example.com"]);
    expect(caaSearchPath("example.com.")).toEqual(["example.com"]);
    expect(caaSearchPath("localhost")).toEqual(["localhost"]);
    expect(caaSearchPath("")).toEqual([]);
  });
});

describe("CaaCheck", () => {
  const check = new CaaCheck();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has the correct name", () => {
    expect(check.name).toBe("caa");
  });

  it("reports issue, issuewild, and iodef records", async () => {
    records({
      "example.com": [
        { critical: 0, issue: "letsencrypt.org" },
        { critical: 0, issue: "digicert.com; cansignhttpexchanges=yes" },
        { critical: 0, issuewild: "sectigo.com" },
        { critical: 0, iodef: "mailto:security@example.com" },
      ],
    });
    const result = await check.run(endpoint, "example.com");
    expect(result).toEqual({
      name: "caa",
      data: {
        present: true,
        foundAt: "example.com",
        issue: ["letsencrypt.org", "digicert.com; cansignhttpexchanges=yes"],
        issuewild: ["sectigo.com"],
        iodef: ["mailto:security@example.com"],
        issuerRestricted: true,
        wildcardRestricted: true,
        criticalUnknownTags: [],
        error: null,
      },
    });
  });

  it("climbs to the parent domain when the name has no records", async () => {
    records({ "example.com": [{ critical: 0, issue: "pki.goog" }] });
    const result = await check.run(endpoint, "www.example.com");
    expect(mockResolveCaa.mock.calls.map((c) => c[0])).toEqual(["www.example.com", "example.com"]);
    expect(result.data.present).toBe(true);
    expect(result.data.foundAt).toBe("example.com");
  });

  it("stops at the first name with records", async () => {
    records({
      "www.example.com": [{ critical: 0, issue: "letsencrypt.org" }],
      "example.com": [{ critical: 0, issue: "pki.goog" }],
    });
    const result = await check.run(endpoint, "www.example.com");
    expect(mockResolveCaa).toHaveBeenCalledTimes(1);
    expect(result.data.issue).toEqual(["letsencrypt.org"]);
  });

  it("reports absence when no name in the path has records", async () => {
    records({ "sub.example.com": "ENOTFOUND" });
    const result = await check.run(endpoint, "sub.example.com");
    expect(result.data).toEqual({
      present: false,
      foundAt: null,
      issue: [],
      issuewild: [],
      iodef: [],
      issuerRestricted: false,
      wildcardRestricted: false,
      criticalUnknownTags: [],
      error: null,
    });
  });

  it("reports a failed lookup as unknown rather than absent, without climbing", async () => {
    records({ "www.example.com": "ESERVFAIL" });
    const result = await check.run(endpoint, "www.example.com");
    expect(mockResolveCaa).toHaveBeenCalledTimes(1);
    expect(result.data.present).toBeNull();
    expect(result.data.issuerRestricted).toBeNull();
    expect(result.data.wildcardRestricted).toBeNull();
    expect(result.data.error).toBe("ESERVFAIL");
  });

  it("counts an empty issuer (no CA may issue) as restricted", async () => {
    records({ "example.com": [{ critical: 0, issue: ";" }] });
    const result = await check.run(endpoint, "example.com");
    expect(result.data.issuerRestricted).toBe(true);
    expect(result.data.wildcardRestricted).toBe(true);
    expect(result.data.issue).toEqual([";"]);
  });

  it("treats wildcards as unrestricted when only iodef is set", async () => {
    records({ "example.com": [{ critical: 0, iodef: "https://example.com/caa" }] });
    const result = await check.run(endpoint, "example.com");
    expect(result.data.present).toBe(true);
    expect(result.data.issuerRestricted).toBe(false);
    expect(result.data.wildcardRestricted).toBe(false);
  });

  it("restricts wildcards via issuewild alone", async () => {
    records({ "example.com": [{ critical: 0, issuewild: ";" }] });
    const result = await check.run(endpoint, "example.com");
    expect(result.data.issuerRestricted).toBe(false);
    expect(result.data.wildcardRestricted).toBe(true);
  });

  it("lists unknown tags flagged critical, ignoring known or non-critical ones", async () => {
    records({
      "example.com": [
        { critical: 128, issue: "letsencrypt.org" },
        { critical: 128, tbs: "unknown" },
        { critical: 0, futuretag: "x" },
      ],
    });
    const result = await check.run(endpoint, "example.com");
    expect(result.data.criticalUnknownTags).toEqual(["tbs"]);
  });
});
