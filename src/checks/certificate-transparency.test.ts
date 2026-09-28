import { describe, it, expect, vi, afterEach } from "vitest";
import { CertificateTransparencyCheck, issuerOrg } from "./certificate-transparency.js";
import type { EndpointData } from "../types.js";
import { stubFetch } from "../testing/fetch-stub.js";

const endpoint: EndpointData = {
  url: "https://balter.com",
  finalUrl: "https://balter.com",
  statusCode: 200,
  headers: {},
  setCookies: [],
  body: "",
  redirectChain: [],
};

const CRTSH = "https://crt.sh/?q=balter.com&output=json&exclude=expired&deduplicate=Y";

// Real rows from crt.sh (Sep 2026), plus a look-alike and a repeated row.
const ENTRIES = [
  {
    issuer_ca_id: 286242,
    issuer_name: "C=US, O=Google Trust Services, CN=WR1",
    common_name: "balter.com",
    name_value: "balter.com\n*.names.balter.com\nnames.balter.com",
    id: 29414833798,
    not_before: "2026-08-28T21:06:05",
    not_after: "2026-11-26T22:03:50",
    serial_number: "07850e787f71544e134893aef70dc78b",
    result_count: 4,
  },
  {
    issuer_ca_id: 431054,
    issuer_name: "C=US, O=Let's Encrypt, CN=YE2",
    common_name: "home-assistant.balter.com",
    name_value: "home-assistant.balter.com",
    id: 28793995296,
    not_before: "2026-08-12T22:40:35",
    not_after: "2026-11-10T22:40:34",
    serial_number: "06771d60dc5c6b74346eff044055844cd9e9",
    result_count: 2,
  },
  {
    issuer_ca_id: 432952,
    issuer_name: "C=US, O=Let's Encrypt, CN=YE1",
    common_name: "uptime.balter.com",
    name_value: "uptime.balter.com",
    id: 28793994945,
    not_before: "2026-08-12T22:40:34",
    not_after: "2026-11-10T22:40:33",
    serial_number: "0638df7f4d4bd2338e011fa90496696ebdf8",
    result_count: 2,
  },
  {
    issuer_ca_id: 286236,
    issuer_name: "C=US, O=Google Trust Services, CN=WE1",
    common_name: "balter.com",
    name_value: "*.balter.com\nbalter.com",
    id: 27750112912,
    not_before: "2026-07-07T04:12:06",
    not_after: "2026-10-05T05:09:41",
    serial_number: "00836c3776b635593713d2683b1e502ef9",
    result_count: 3,
  },
  {
    issuer_ca_id: 1,
    issuer_name: "C=US, O=Let's Encrypt, CN=R3",
    common_name: "notbalter.com",
    name_value: "notbalter.com\nbalter.com.evil.example",
    id: 1,
    not_before: "2026-09-01T00:00:00",
    not_after: "2026-12-01T00:00:00",
    serial_number: "01",
    result_count: 2,
  },
  {
    issuer_ca_id: 2,
    issuer_name: "C=US, O=Actalis S.p.A., CN=Actalis Client Authentication CA G3",
    common_name: "ben@mail.balter.com",
    name_value: "ben@mail.balter.com",
    id: 2,
    not_before: "2026-09-10T00:00:00",
    not_after: "2027-09-10T00:00:00",
    serial_number: "02",
    result_count: 1,
  },
];

describe("CertificateTransparencyCheck", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const check = new CertificateTransparencyCheck();

  it("has name 'certificate-transparency'", () => {
    expect(check.name).toBe("certificate-transparency");
  });

  it("summarizes logged certificates", async () => {
    stubFetch({ [CRTSH]: { body: JSON.stringify([...ENTRIES, ENTRIES[1]]) } });

    const { data } = await check.run(endpoint, "balter.com");

    expect(data).toEqual({
      available: true,
      certificateCount: 4,
      issuers: [
        { name: "Google Trust Services", count: 2 },
        { name: "Let's Encrypt", count: 2 },
      ],
      subdomains: ["home-assistant.balter.com", "names.balter.com", "uptime.balter.com"],
      subdomainCount: 3,
      wildcardCount: 2,
      mostRecentIssued: "2026-08-28T21:06:05.000Z",
      error: null,
    });
  });

  it("reports an empty log as zero certificates", async () => {
    stubFetch({ [CRTSH]: { body: "[]" } });

    const { data } = await check.run(endpoint, "balter.com");

    expect(data.available).toBe(true);
    expect(data.certificateCount).toBe(0);
    expect(data.subdomains).toEqual([]);
    expect(data.mostRecentIssued).toBeNull();
  });

  it("caps the subdomain list but reports the full count", async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({
      ...ENTRIES[1],
      id: i + 100,
      name_value: `host${String(i).padStart(3, "0")}.balter.com`,
    }));
    stubFetch({ [CRTSH]: { body: JSON.stringify(many) } });

    const { data } = await check.run(endpoint, "balter.com");

    expect(data.subdomainCount).toBe(150);
    expect(data.subdomains).toHaveLength(100);
    expect((data.subdomains as string[])[0]).toBe("host000.balter.com");
  });

  it("treats a 5xx as unavailable, not as no certificates", async () => {
    stubFetch({ [CRTSH]: { status: 502, body: "<html>Bad Gateway</html>" } });

    const { data } = await check.run(endpoint, "balter.com");

    expect(data.available).toBe(false);
    expect(data.certificateCount).toBeNull();
    expect(data.error).toBe("crt.sh returned HTTP 502");
  });

  it("treats a network failure as unavailable", async () => {
    stubFetch({});

    const { data } = await check.run(endpoint, "balter.com");

    expect(data.available).toBe(false);
    expect(data.error).toBe("fetch failed");
  });

  it("treats a non-JSON body as unavailable", async () => {
    stubFetch({ [CRTSH]: { body: "<html>crt.sh is overloaded</html>" } });

    const { data } = await check.run(endpoint, "balter.com");

    expect(data.available).toBe(false);
    expect(data.error).toBe("crt.sh returned an invalid response");
  });

  it("stops when the check's signal aborts", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            const signal = init.signal;
            if (signal?.aborted) reject(signal.reason);
            signal?.addEventListener("abort", () => reject(signal.reason));
          }),
      ),
    );

    const pending = check.run(endpoint, "balter.com", {
      timeoutMs: 1000,
      signal: controller.signal,
    });
    controller.abort(new Error("check timed out"));
    const { data } = await pending;

    expect(data.available).toBe(false);
    expect(data.error).toBe("check timed out");
  });
});

describe("issuerOrg", () => {
  it("prefers O=, falling back to CN=", () => {
    expect(issuerOrg("C=US, O=Let's Encrypt, CN=R3")).toBe("Let's Encrypt");
    expect(issuerOrg("C=US, CN=Some CA")).toBe("Some CA");
  });

  it("does not confuse OU= with O=", () => {
    expect(issuerOrg("C=US, OU=Unit, CN=Some CA")).toBe("Some CA");
  });

  it("handles quoted values containing commas", () => {
    expect(issuerOrg('C=US, O="DigiCert, Inc.", CN=DigiCert CA')).toBe("DigiCert, Inc.");
  });
});
