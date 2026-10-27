import { describe, it, expect, afterEach, vi } from "vitest";
import { CertificateTransparencyCheck } from "./certificate-transparency.js";
import { stubFetch } from "../testing/fetch-stub.js";
import type { EndpointData } from "../types.js";

const endpoint: EndpointData = {
  url: "https://example.com",
  finalUrl: "https://example.com",
  statusCode: 200,
  headers: {},
  setCookies: [],
  body: "",
  redirectChain: [],
};

const CRT_URL = "https://crt.sh/?q=%25.example.com&output=json&exclude=expired&deduplicate=Y";

// Shaped like a real crt.sh response.
const entries = [
  {
    issuer_ca_id: 204407,
    issuer_name: "C=GB, O=Sectigo Limited, CN=Sectigo Public Server Authentication CA DV E36",
    common_name: "example.com",
    name_value: "*.example.com\nexample.com",
    id: 29658164188,
    not_before: "2026-10-03T00:00:00",
    not_after: "2026-12-25T21:41:50",
    serial_number: "0096710d476964244939561c9431afb105",
    result_count: 3,
  },
  {
    issuer_ca_id: 295815,
    issuer_name: "C=US, O=Google Trust Services, CN=WE1",
    common_name: "www.example.com",
    name_value: "www.example.com\nAPI.example.com\nexample.com.evil.test",
    id: 29000000000,
    not_before: "2026-09-01T00:00:00",
    not_after: "2026-11-30T00:00:00",
    serial_number: "01",
    result_count: 3,
  },
];

describe("CertificateTransparencyCheck", () => {
  const check = new CertificateTransparencyCheck();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has the name 'certificate-transparency'", () => {
    expect(check.name).toBe("certificate-transparency");
  });

  it("summarizes the domain's unexpired certificates from crt.sh", async () => {
    stubFetch({ [CRT_URL]: { body: JSON.stringify(entries) } });

    const result = await check.run(endpoint, "example.com");

    expect(result.data).toEqual({
      lookupFailed: false,
      certificateCount: 2,
      issuers: ["Google Trust Services", "Sectigo Limited"],
      wildcard: true,
      subdomainCount: 2,
      subdomains: ["api.example.com", "www.example.com"],
      latestIssued: "2026-10-03T00:00:00Z",
      nextExpiry: "2026-11-30T00:00:00Z",
    });
  });

  it("reports no certificates as an empty list, not a failure", async () => {
    stubFetch({ [CRT_URL]: { body: "[]" } });

    const result = await check.run(endpoint, "example.com");

    expect(result.data.lookupFailed).toBe(false);
    expect(result.data.certificateCount).toBe(0);
    expect(result.data.subdomains).toEqual([]);
    expect(result.data.latestIssued).toBeNull();
  });

  it("separates a crt.sh outage from having no certificates", async () => {
    stubFetch({ [CRT_URL]: { status: 502, body: "Bad Gateway" } });

    const result = await check.run(endpoint, "example.com");

    expect(result.data.lookupFailed).toBe(true);
    expect(result.data.certificateCount).toBeNull();
    expect(result.data.subdomainCount).toBeNull();
  });

  it("caps the subdomain list but counts them all", async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({
      ...entries[0],
      name_value: `host${i}.example.com`,
    }));
    stubFetch({ [CRT_URL]: { body: JSON.stringify(many) } });

    const result = await check.run(endpoint, "example.com");

    expect(result.data.subdomainCount).toBe(150);
    expect(result.data.subdomains).toHaveLength(100);
  });
});
