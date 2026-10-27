import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import dns from "node:dns/promises";
import { RpkiCheck } from "./rpki.js";
import { stubFetch } from "../testing/fetch-stub.js";
import type { EndpointData } from "../types.js";

vi.mock("node:dns/promises");

const endpoint: EndpointData = {
  url: "https://example.com",
  finalUrl: "https://example.com",
  statusCode: 200,
  headers: {},
  setCookies: [],
  body: "",
  redirectChain: [],
};

const NETWORK_INFO =
  "https://stat.ripe.net/data/network-info/data.json?resource=140.82.112.3&sourceapp=site-inspector";
const VALIDATION =
  "https://stat.ripe.net/data/rpki-validation/data.json?resource=36459&prefix=140.82.112.0%2F24&sourceapp=site-inspector";

// Shaped like real RIPEstat responses.
const networkInfo = { status: "ok", data: { asns: ["36459"], prefix: "140.82.112.0/24" } };
const validation = (status: string, roas: unknown[] = []) => ({
  status: "ok",
  data: {
    resource: "36459",
    prefix: "140.82.112.0/24",
    validating_roas: roas,
    status,
    validator: "routinator",
  },
});

describe("RpkiCheck", () => {
  const check = new RpkiCheck();

  beforeEach(() => {
    vi.mocked(dns.resolve4).mockResolvedValue(["140.82.112.3"]);
    vi.mocked(dns.resolve6).mockRejectedValue(new Error("ENODATA"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("has the name 'rpki'", () => {
    expect(check.name).toBe("rpki");
  });

  it("reports a route covered by a matching ROA as valid", async () => {
    stubFetch({
      [NETWORK_INFO]: { body: JSON.stringify(networkInfo) },
      [VALIDATION]: {
        body: JSON.stringify(
          validation("valid", [
            { origin: "36459", prefix: "140.82.112.0/20", validity: "valid", max_length: 24 },
          ]),
        ),
      },
    });

    const result = await check.run(endpoint, "example.com");

    expect(result.data).toEqual({
      ip: "140.82.112.3",
      asn: 36459,
      prefix: "140.82.112.0/24",
      status: "valid",
      valid: true,
      invalid: false,
      lookupFailed: false,
    });
  });

  it("reports a route with no ROA as neither valid nor invalid", async () => {
    stubFetch({
      [NETWORK_INFO]: { body: JSON.stringify(networkInfo) },
      [VALIDATION]: { body: JSON.stringify(validation("unknown")) },
    });

    const result = await check.run(endpoint, "example.com");

    expect(result.data).toMatchObject({ status: "unknown", valid: false, invalid: false });
  });

  it("flags a route that contradicts its ROA", async () => {
    stubFetch({
      [NETWORK_INFO]: { body: JSON.stringify(networkInfo) },
      [VALIDATION]: { body: JSON.stringify(validation("invalid_asn")) },
    });

    const result = await check.run(endpoint, "example.com");

    expect(result.data).toMatchObject({ status: "invalid_asn", valid: false, invalid: true });
  });

  it("reports a failed lookup when RIPEstat can't be reached", async () => {
    stubFetch({});

    const result = await check.run(endpoint, "example.com");

    expect(result.data).toMatchObject({
      ip: "140.82.112.3",
      status: null,
      valid: null,
      invalid: null,
      lookupFailed: true,
    });
  });

  it("reports nothing to check when the domain has no address", async () => {
    vi.mocked(dns.resolve4).mockRejectedValue(new Error("ENOTFOUND"));
    stubFetch({});

    const result = await check.run(endpoint, "example.com");

    expect(result.data).toMatchObject({ ip: null, status: null, lookupFailed: false });
  });
});
