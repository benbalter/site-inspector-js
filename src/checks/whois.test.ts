import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DomainRecord, LookupResult } from "rdapper";
import type { EndpointData } from "../types.js";

const { mockLookup } = vi.hoisted(() => ({
  mockLookup: vi.fn(),
}));

vi.mock("rdapper", async (importOriginal) => ({
  ...(await importOriginal<typeof import("rdapper")>()),
  lookup: mockLookup,
}));

import { WhoisCheck } from "./whois.js";

const placeholderEndpoint: EndpointData = {
  url: "https://example.com",
  statusCode: 200,
  headers: {},
  body: "",
  finalUrl: "https://example.com",
  setCookies: [],
  redirectChain: [],
};

// Trimmed from a real rdapper lookup of github.com (RDAP, Verisign).
const githubRecord: DomainRecord = {
  domain: "github.com",
  tld: "com",
  isRegistered: true,
  registrar: {
    name: "MarkMonitor Inc.",
    ianaId: "292",
    email: "abusecomplaints@markmonitor.com",
  },
  statuses: [
    { status: "clientDeleteProhibited", raw: "client delete prohibited" },
    { status: "clientTransferProhibited", raw: "client transfer prohibited" },
    { status: "clientUpdateProhibited", raw: "client update prohibited" },
  ],
  creationDate: "2007-10-09T18:20:50Z",
  updatedDate: "2026-09-07T09:22:52Z",
  expirationDate: "2028-10-09T18:20:50Z",
  transferLock: true,
  dnssec: { enabled: false },
  nameservers: [{ host: "dns1.p08.nsone.net" }, { host: "ns-1283.awsdns-32.org" }],
  contacts: [{ type: "registrant" }, { type: "tech" }],
  privacyEnabled: true,
  source: "rdap",
};

// Trimmed from a real rdapper lookup of example.io (WHOIS fallback).
const ioRecord: DomainRecord = {
  domain: "example.io",
  tld: "io",
  isRegistered: true,
  registrar: { name: "NameCheap, Inc.", email: "abuse@namecheap.com" },
  statuses: [{ status: "clientTransferProhibited" }],
  creationDate: "2011-11-22T01:38:41Z",
  expirationDate: "2026-11-22T01:38:41Z",
  transferLock: true,
  dnssec: { enabled: false },
  nameservers: [{ host: "ns1.digitalocean.com" }],
  contacts: [
    {
      type: "registrant",
      organization: "Privacy service provided by Withheld for Privacy ehf",
      privacyService: true,
    },
  ],
  privacyEnabled: true,
  whoisServer: "whois.namecheap.com",
  source: "whois",
};

function ok(record: DomainRecord): LookupResult {
  return { ok: true, record, attempts: [] };
}

describe("WhoisCheck", () => {
  const check = new WhoisCheck();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("returns registration data from RDAP", async () => {
    mockLookup.mockResolvedValue(ok(githubRecord));
    vi.useFakeTimers({ now: new Date("2026-10-09T18:20:50Z") });

    const result = await check.run(placeholderEndpoint, "github.com");

    expect(result.name).toBe("whois");
    expect(result.data).toEqual({
      source: "rdap",
      registered: true,
      registrar: "MarkMonitor Inc.",
      creationDate: "2007-10-09T18:20:50Z",
      expirationDate: "2028-10-09T18:20:50Z",
      updatedDate: "2026-09-07T09:22:52Z",
      nameServers: ["dns1.p08.nsone.net", "ns-1283.awsdns-32.org"],
      registrantOrganization: null,
      domainAge: 6940,
      expiresIn: 731,
      statuses: ["clientDeleteProhibited", "clientTransferProhibited", "clientUpdateProhibited"],
      transferLock: true,
      dnssecSigned: false,
      privacyEnabled: true,
      registrarEmail: "abusecomplaints@markmonitor.com",
      error: null,
    });
  });

  it("reports the WHOIS fallback and hides privacy-service registrants", async () => {
    mockLookup.mockResolvedValue(ok(ioRecord));

    const result = await check.run(placeholderEndpoint, "example.io");

    expect(result.data.source).toBe("whois");
    expect(result.data.privacyEnabled).toBe(true);
    expect(result.data.registrantOrganization).toBeNull();
  });

  it("returns the registrant organization when it is not a privacy service", async () => {
    mockLookup.mockResolvedValue(
      ok({ ...githubRecord, contacts: [{ type: "registrant", organization: "GitHub, Inc." }] }),
    );

    const result = await check.run(placeholderEndpoint, "github.com");

    expect(result.data.registrantOrganization).toBe("GitHub, Inc.");
  });

  it("looks up the registrable domain, not the subdomain", async () => {
    mockLookup.mockResolvedValue(ok(githubRecord));

    await check.run(placeholderEndpoint, "www.bbc.co.uk", {
      timeoutMs: 5000,
      signal: new AbortController().signal,
    });

    expect(mockLookup).toHaveBeenCalledWith(
      "bbc.co.uk",
      expect.objectContaining({ timeoutMs: 5000, deadlineMs: 10_000 }),
    );
  });

  it("passes the check's abort signal through", async () => {
    mockLookup.mockResolvedValue(ok(githubRecord));
    const { signal } = new AbortController();

    await check.run(placeholderEndpoint, "github.com", { timeoutMs: 5000, signal });

    expect(mockLookup.mock.calls[0]?.[1]).toMatchObject({ signal });
  });

  it("leaves transferLock unknown when the registry reports no statuses", async () => {
    mockLookup.mockResolvedValue(ok({ ...githubRecord, statuses: [], transferLock: undefined }));

    const result = await check.run(placeholderEndpoint, "github.com");

    expect(result.data.transferLock).toBeNull();
  });

  it("leaves transferLock unknown when the registry doesn't use EPP statuses", async () => {
    // A real rdapper record for heise.de: DENIC reports only "connect".
    mockLookup.mockResolvedValue(
      ok({
        domain: "heise.de",
        tld: "de",
        isRegistered: true,
        statuses: [{ status: "connect" }],
        transferLock: false,
        source: "whois",
      }),
    );

    const result = await check.run(placeholderEndpoint, "heise.de");

    expect(result.data.statuses).toEqual(["connect"]);
    expect(result.data.transferLock).toBeNull();
  });

  it("reports no transfer lock when EPP statuses lack one", async () => {
    mockLookup.mockResolvedValue(
      ok({ ...githubRecord, statuses: [{ status: "ok" }], transferLock: false }),
    );

    const result = await check.run(placeholderEndpoint, "github.com");

    expect(result.data.transferLock).toBe(false);
  });

  it("reports an unregistered domain", async () => {
    // A real rdapper result for an unregistered .com.
    mockLookup.mockResolvedValue(
      ok({ domain: "unregistered-zzq81.com", tld: "com", isRegistered: false, source: "rdap" }),
    );

    const result = await check.run(placeholderEndpoint, "unregistered-zzq81.com");

    expect(result.data.registered).toBe(false);
    expect(result.data.registrar).toBeNull();
    expect(result.data.nameServers).toEqual([]);
    expect(result.data.transferLock).toBeNull();
    expect(result.data.expiresIn).toBeNull();
    expect(result.data.error).toBeNull();
  });

  it("returns the lookup's error when it fails", async () => {
    mockLookup.mockResolvedValue({
      ok: false,
      error: "RDAP request timed out",
      errorCode: "timeout",
      attempts: [],
    } satisfies LookupResult);

    const result = await check.run(placeholderEndpoint, "fail.com");

    expect(result.data.error).toBe("RDAP request timed out");
    expect(result.data.registrar).toBeNull();
    expect(result.data.nameServers).toEqual([]);
    expect(result.data.statuses).toEqual([]);
  });

  it("returns error data when the lookup throws", async () => {
    mockLookup.mockRejectedValue(new Error("boom"));

    const result = await check.run(placeholderEndpoint, "fail.com");

    expect(result.data.error).toBe("boom");
    expect(result.data.domainAge).toBeNull();
  });

  it("rejects input that isn't a registrable domain without a lookup", async () => {
    const result = await check.run(placeholderEndpoint, "co.uk");

    expect(mockLookup).not.toHaveBeenCalled();
    expect(result.data.error).toBe("Not a registrable domain: co.uk");
  });

  it("computes domainAge and expiresIn correctly", async () => {
    mockLookup.mockResolvedValue(
      ok({
        ...githubRecord,
        creationDate: "2024-06-01T00:00:00Z",
        expirationDate: "2025-06-01T00:00:00Z",
      }),
    );
    vi.useFakeTimers({ now: new Date("2025-01-01T00:00:00Z") });

    const result = await check.run(placeholderEndpoint, "github.com");

    expect(result.data.domainAge).toBe(214);
    expect(result.data.expiresIn).toBe(151);
  });

  it("reports a negative expiresIn once the domain has expired", async () => {
    mockLookup.mockResolvedValue(ok({ ...githubRecord, expirationDate: "2024-12-31T00:00:00Z" }));
    vi.useFakeTimers({ now: new Date("2025-01-02T00:00:00Z") });

    const result = await check.run(placeholderEndpoint, "github.com");

    expect(result.data.expiresIn).toBe(-2);
  });
});
