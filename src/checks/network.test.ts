import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetCaches, getConfig } from "node-rdap";
import { stubFetch } from "../testing/fetch-stub.js";
import type { EndpointData } from "../types.js";

vi.mock("node:dns/promises");

import dns from "node:dns/promises";
import { NetworkCheck } from "./network.js";

const mockResolve4 = vi.mocked(dns.resolve4);
const mockResolve6 = vi.mocked(dns.resolve6);

const placeholderEndpoint: EndpointData = {
  url: "https://example.com",
  statusCode: 200,
  headers: {},
  body: "",
  finalUrl: "https://example.com",
  setCookies: [],
  redirectChain: [],
};

// Trimmed IANA bootstrap files: just the blocks the fixtures below need.
const IPV4_BOOTSTRAP = {
  version: "1.0",
  publication: "2019-06-07T19:00:02Z",
  services: [
    [["1.0.0.0/8"], ["https://rdap.apnic.net/"]],
    [["140.0.0.0/8"], ["https://rdap.arin.net/registry/"]],
    [["193.0.0.0/8"], ["https://rdap.db.ripe.net/"]],
  ],
};
const IPV6_BOOTSTRAP = {
  version: "1.0",
  publication: "2019-06-07T19:00:02Z",
  services: [[["2a00::/12"], ["https://rdap.db.ripe.net/"]]],
};

type Vcard = [string, Record<string, string>, string, string][];
function entity(handle: string, roles: string[], vcard: Vcard, entities?: unknown[]) {
  return {
    objectClassName: "entity",
    handle,
    roles,
    vcardArray: ["vcard", [["version", {}, "text", "4.0"], ...vcard]],
    ...(entities ? { entities } : {}),
  };
}

// Trimmed from the real RIPE NCC response for 193.0.6.139. RIPE lists its
// maintainer object as a registrant too, and puts the abuse email on a
// technical contact and a separate abuse entity.
const RIPE_RESPONSE = {
  objectClassName: "ip network",
  rdapConformance: ["rdap_level_0", "cidr0"],
  handle: "193.0.0.0 - 193.0.7.255",
  startAddress: "193.0.0.0",
  endAddress: "193.0.7.255",
  ipVersion: "v4",
  name: "RIPE-NCC",
  type: "ASSIGNED PA",
  country: "NL",
  cidr0_cidrs: [{ v4prefix: "193.0.0.0", length: 21 }],
  entities: [
    entity(
      "MDIR-RIPE",
      ["administrative"],
      [
        ["fn", {}, "text", "Managing Director"],
        ["kind", {}, "text", "group"],
      ],
    ),
    entity(
      "RIPE-NCC-MNT",
      ["registrant"],
      [
        ["fn", {}, "text", "RIPE-NCC-MNT"],
        ["kind", {}, "text", "individual"],
      ],
    ),
    entity(
      "ORG-RIEN1-RIPE",
      ["registrant"],
      [
        ["fn", {}, "text", "Reseaux IP Europeens Network Coordination Centre (RIPE NCC)"],
        ["kind", {}, "text", "org"],
      ],
    ),
    entity(
      "OPS4-RIPE",
      ["abuse"],
      [
        ["fn", {}, "text", "RIPE NCC Operations"],
        ["kind", {}, "text", "group"],
        ["email", { type: "abuse" }, "text", "abuse@ripe.net"],
      ],
    ),
  ],
};

// Trimmed from the real ARIN response for 140.82.112.3: the abuse contact is
// nested inside the registrant entity, and the name comes from vCard `org`.
const ARIN_RESPONSE = {
  objectClassName: "ip network",
  rdapConformance: ["rdap_level_0", "cidr0", "arin_originas0"],
  handle: "NET-140-82-112-0-1",
  startAddress: "140.82.112.0",
  endAddress: "140.82.127.255",
  ipVersion: "v4",
  name: "GITHU",
  type: "DIRECT ALLOCATION",
  cidr0_cidrs: [{ v4prefix: "140.82.112.0", length: 20 }],
  arin_originas0_originautnums: [],
  entities: [
    entity(
      "GITHU",
      ["registrant"],
      [
        ["fn", {}, "text", "GitHub, Inc."],
        ["kind", {}, "text", "org"],
      ],
      [
        entity(
          "GITHU-ARIN",
          ["noc", "administrative", "technical"],
          [
            ["fn", {}, "text", "GitHub Ops"],
            ["org", {}, "text", "GitHub, Inc."],
            ["kind", {}, "text", "group"],
            ["email", {}, "text", "hostmaster@github.com"],
          ],
        ),
        entity(
          "GITHU1-ARIN",
          ["abuse"],
          [
            ["fn", {}, "text", "GitHub Abuse"],
            ["kind", {}, "text", "group"],
            ["email", {}, "text", "noc@github.com"],
          ],
        ),
      ],
    ),
  ],
};

// Trimmed from the real RIPE response for a Google IPv6 address: the only
// registrant is a maintainer object, so the holder is the admin contact.
const RIPE_V6_RESPONSE = {
  objectClassName: "ip network",
  rdapConformance: ["rdap_level_0", "cidr0"],
  handle: "2a00:1450:4000::/37",
  startAddress: "2a00:1450:4000::",
  endAddress: "2a00:1450:47ff:ffff:ffff:ffff:ffff:ffff",
  ipVersion: "v6",
  name: "IE-GOOGLE-2a00-1450-4000-1",
  type: "AGGREGATED-BY-LIR",
  country: "ie",
  cidr0_cidrs: [{ v6prefix: "2a00:1450:4000::", length: 37 }],
  entities: [
    entity(
      "GOOG1-RIPE",
      ["administrative", "technical"],
      [
        ["fn", {}, "text", "Google Ireland Limited"],
        ["kind", {}, "text", "group"],
      ],
    ),
    entity(
      "MNT-GOOG-PROD",
      ["registrant"],
      [
        ["fn", {}, "text", "MNT-GOOG-PROD"],
        ["kind", {}, "text", "individual"],
      ],
    ),
    entity(
      "AR15518-RIPE",
      ["abuse"],
      [
        ["fn", {}, "text", "Abuse-C Role"],
        ["kind", {}, "text", "group"],
        ["email", { type: "abuse" }, "text", "ripe-contact@google.com"],
      ],
    ),
  ],
};

// Trimmed from the real RIPE response for 193.0.11.51: no registrant is an
// organization, and the admin contact names the holder only by org handle.
const RIPE_ORG_HANDLE_RESPONSE = {
  objectClassName: "ip network",
  rdapConformance: ["rdap_level_0", "cidr0"],
  handle: "193.0.10.0 - 193.0.11.255",
  name: "RIPE-NCC",
  type: "ASSIGNED PA",
  country: "NL",
  cidr0_cidrs: [{ v4prefix: "193.0.10.0", length: 23 }],
  links: [
    {
      value: "https://rdap.db.ripe.net/ip/193.0.11.51",
      rel: "self",
      href: "https://rdap.db.ripe.net/ip/193.0.11.51",
    },
  ],
  entities: [
    entity(
      "MDIR-RIPE",
      ["administrative"],
      [
        ["fn", {}, "text", "Managing Director"],
        ["kind", {}, "text", "group"],
        ["org", {}, "text", "ORG-NCC1-RIPE"],
      ],
    ),
    entity(
      "RIPE-NCC-MNT",
      ["registrant"],
      [
        ["fn", {}, "text", "RIPE-NCC-MNT"],
        ["kind", {}, "text", "individual"],
      ],
    ),
  ],
};

// The real RIPE entity that handle points to.
const RIPE_ORG_ENTITY = {
  objectClassName: "entity",
  rdapConformance: ["rdap_level_0"],
  handle: "ORG-NCC1-RIPE",
  vcardArray: [
    "vcard",
    [
      ["version", {}, "text", "4.0"],
      ["fn", {}, "text", "RIPE Network Coordination Center"],
      ["kind", {}, "text", "org"],
    ],
  ],
};

const json = (body: unknown) => ({
  headers: { "content-type": "application/rdap+json" },
  body: JSON.stringify(body),
});

const BOOTSTRAP_ROUTES = {
  "https://data.iana.org/rdap/ipv4.json": json(IPV4_BOOTSTRAP),
  "https://data.iana.org/rdap/ipv6.json": json(IPV6_BOOTSTRAP),
};

describe("NetworkCheck", () => {
  const check = new NetworkCheck();

  beforeEach(() => {
    vi.clearAllMocks();
    resetCaches();
    mockResolve6.mockRejectedValue(new Error("ENODATA"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has the correct name", () => {
    expect(check.name).toBe("network");
  });

  it("reports the network holder from RIPE", async () => {
    mockResolve4.mockResolvedValue(["193.0.6.139"]);
    stubFetch({
      ...BOOTSTRAP_ROUTES,
      "https://rdap.db.ripe.net/ip/193.0.6.139": json(RIPE_RESPONSE),
    });

    const result = await check.run(placeholderEndpoint, "ripe.net");

    expect(result).toEqual({
      name: "network",
      data: {
        ip: "193.0.6.139",
        name: "RIPE-NCC",
        handle: "193.0.0.0 - 193.0.7.255",
        cidr: ["193.0.0.0/21"],
        type: "ASSIGNED PA",
        organization: "Reseaux IP Europeens Network Coordination Centre (RIPE NCC)",
        country: "NL",
        abuseEmail: "abuse@ripe.net",
        error: null,
      },
    });
  });

  it("finds an abuse contact nested in the registrant (ARIN)", async () => {
    mockResolve4.mockResolvedValue(["140.82.112.3"]);
    stubFetch({
      ...BOOTSTRAP_ROUTES,
      "https://rdap.arin.net/registry/ip/140.82.112.3": json(ARIN_RESPONSE),
    });

    const result = await check.run(placeholderEndpoint, "github.com");

    expect(result.data.organization).toBe("GitHub, Inc.");
    expect(result.data.abuseEmail).toBe("noc@github.com");
    expect(result.data.cidr).toEqual(["140.82.112.0/20"]);
    expect(result.data.country).toBeNull();
  });

  it("falls back to IPv6 and the admin contact when the registrant is a maintainer", async () => {
    mockResolve4.mockRejectedValue(new Error("ENODATA"));
    mockResolve6.mockResolvedValue(["2a00:1450:4001:80b::200e"]);
    stubFetch({
      ...BOOTSTRAP_ROUTES,
      "https://rdap.db.ripe.net/ip/2a00:1450:4001:80b::200e": json(RIPE_V6_RESPONSE),
    });

    const result = await check.run(placeholderEndpoint, "google.ie");

    expect(result.data.ip).toBe("2a00:1450:4001:80b::200e");
    expect(result.data.organization).toBe("Google Ireland Limited");
    expect(result.data.cidr).toEqual(["2a00:1450:4000::/37"]);
    expect(result.data.country).toBe("IE");
    expect(result.data.abuseEmail).toBe("ripe-contact@google.com");
  });

  it("resolves an org handle to the holder's name (RIPE)", async () => {
    mockResolve4.mockResolvedValue(["193.0.11.51"]);
    stubFetch({
      ...BOOTSTRAP_ROUTES,
      "https://rdap.db.ripe.net/ip/193.0.11.51": json(RIPE_ORG_HANDLE_RESPONSE),
      "https://rdap.db.ripe.net/entity/ORG-NCC1-RIPE": json(RIPE_ORG_ENTITY),
    });

    const result = await check.run(placeholderEndpoint, "ripe.net");

    expect(result.data.organization).toBe("RIPE Network Coordination Center");
  });

  it("leaves the holder unknown when its org handle can't be resolved", async () => {
    mockResolve4.mockResolvedValue(["193.0.11.51"]);
    stubFetch({
      ...BOOTSTRAP_ROUTES,
      "https://rdap.db.ripe.net/ip/193.0.11.51": json(RIPE_ORG_HANDLE_RESPONSE),
    });

    const result = await check.run(placeholderEndpoint, "ripe.net");

    expect(result.data.organization).toBeNull();
    expect(result.data.name).toBe("RIPE-NCC");
    expect(result.data.error).toBeNull();
  });

  it("returns empty data when the domain has no address", async () => {
    mockResolve4.mockRejectedValue(new Error("ENOTFOUND"));
    const fetchSpy = stubFetch({});

    const result = await check.run(placeholderEndpoint, "nothing.invalid");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.data.ip).toBeNull();
    expect(result.data.organization).toBeNull();
    expect(result.data.cidr).toEqual([]);
    expect(result.data.error).toBeNull();
  });

  it("reports a registry error", async () => {
    mockResolve4.mockResolvedValue(["193.0.6.139"]);
    stubFetch({
      ...BOOTSTRAP_ROUTES,
      "https://rdap.db.ripe.net/ip/193.0.6.139": { status: 503, body: "" },
    });

    const result = await check.run(placeholderEndpoint, "ripe.net");

    expect(result.data.ip).toBe("193.0.6.139");
    expect(result.data.organization).toBeNull();
    expect(result.data.error).toMatch(/status 503/);
  });

  it("reports an unreachable registry", async () => {
    mockResolve4.mockResolvedValue(["193.0.6.139"]);
    stubFetch(BOOTSTRAP_ROUTES);

    const result = await check.run(placeholderEndpoint, "ripe.net");

    expect(result.data.error).toMatch(/Could not reach/);
  });

  it("bounds each request by the caller's timeout", async () => {
    mockResolve4.mockResolvedValue(["193.0.6.139"]);
    stubFetch({
      ...BOOTSTRAP_ROUTES,
      "https://rdap.db.ripe.net/ip/193.0.6.139": json(RIPE_RESPONSE),
    });

    await check.run(placeholderEndpoint, "ripe.net", {
      timeoutMs: 4321,
      signal: new AbortController().signal,
    });

    expect(getConfig().timeoutMs).toBe(4321);
  });
});
