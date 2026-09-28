import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { EndpointData } from "../types.js";
import { stubFetch } from "../testing/fetch-stub.js";

/** CNAME answers by name: targets, or a DNS error code. */
let cnames: Record<string, string[] | string> = {};
const mockCancel = vi.fn();
const resolverOptions: unknown[] = [];

function dnsError(code: string, host: string) {
  return Object.assign(new Error(`queryCname ${code} ${host}`), { code, hostname: host });
}

vi.mock("node:dns/promises", () => {
  const MockResolver = function (this: Record<string, unknown>, options: unknown) {
    resolverOptions.push(options);
    this.resolveCname = vi.fn(async (host: string) => {
      const answer = cnames[host] ?? "ENODATA";
      if (typeof answer === "string") throw dnsError(answer, host);
      return answer;
    });
    this.cancel = mockCancel;
  };
  return { default: { Resolver: MockResolver } };
});

import { SubdomainTakeoverCheck, loadFingerprints } from "./subdomain-takeover.js";

const endpoint: EndpointData = {
  url: "https://example.com/",
  finalUrl: "https://example.com/",
  statusCode: 200,
  headers: {},
  setCookies: [],
  body: "",
  redirectChain: [],
};

interface Host {
  host: string;
  cname: string | null;
  chain: string[];
  dangling: boolean | null;
  service: string | null;
  vulnerable: boolean | null;
  evidence: string | null;
}

function hosts(data: Record<string, unknown>): Record<string, Host> {
  return Object.fromEntries((data.hosts as Host[]).map((h) => [h.host, h]));
}

describe("loadFingerprints", () => {
  it("loads only usable, vulnerable entries from the vendored file", () => {
    const fps = loadFingerprints();
    expect(fps.length).toBeGreaterThan(10);
    const services = fps.map((f) => f.service);
    expect(services).toContain("AWS/S3");
    expect(services).toContain("Microsoft Azure");
    // Not vulnerable upstream.
    expect(services).not.toContain("Cloudfront");
    // Status-code-only and cname-less entries are unusable.
    expect(services).not.toContain("LaunchRock");
    expect(services).not.toContain("Pantheon");
    for (const f of fps) {
      expect(f.cnames.length).toBeGreaterThan(0);
      for (const c of f.cnames) expect(c).not.toMatch(/^[\d.]+$/);
    }
  });
});

describe("SubdomainTakeoverCheck", () => {
  const check = new SubdomainTakeoverCheck();

  beforeEach(() => {
    cnames = {};
    mockCancel.mockClear();
    resolverOptions.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has the correct name", () => {
    expect(check.name).toBe("subdomain-takeover");
  });

  it("reports no CNAMEs as not vulnerable", async () => {
    const fetchSpy = stubFetch({});
    const result = await check.run(endpoint, "example.com");
    expect(result).toEqual({
      name: "subdomain-takeover",
      data: {
        hosts: [
          {
            host: "example.com",
            cname: null,
            chain: [],
            dangling: false,
            service: null,
            vulnerable: false,
            evidence: null,
          },
          {
            host: "www.example.com",
            cname: null,
            chain: [],
            dangling: false,
            service: null,
            vulnerable: false,
            evidence: null,
          },
        ],
        vulnerable: false,
        vulnerableHosts: [],
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("flags a dangling CNAME to an NXDOMAIN service", async () => {
    stubFetch({});
    cnames["www.example.com"] = ["old-app.azurewebsites.net"];
    cnames["old-app.azurewebsites.net"] = "ENOTFOUND";
    const result = await check.run(endpoint, "example.com");
    expect(hosts(result.data)["www.example.com"]).toEqual({
      host: "www.example.com",
      cname: "old-app.azurewebsites.net",
      chain: ["old-app.azurewebsites.net"],
      dangling: true,
      service: "Microsoft Azure",
      vulnerable: true,
      evidence: "nxdomain",
    });
    expect(result.data.vulnerable).toBe(true);
    expect(result.data.vulnerableHosts).toEqual(["www.example.com"]);
  });

  it("doesn't flag an NXDOMAIN service whose target resolves", async () => {
    stubFetch({});
    cnames["www.example.com"] = ["live-app.azurewebsites.net."];
    const result = await check.run(endpoint, "example.com");
    const www = hosts(result.data)["www.example.com"];
    expect(www.cname).toBe("live-app.azurewebsites.net");
    expect(www.service).toBe("Microsoft Azure");
    expect(www.vulnerable).toBe(false);
    expect(www.evidence).toBeNull();
  });

  it("flags a body fingerprint without leaking the body", async () => {
    cnames["www.example.com"] = ["www.example.com.s3.amazonaws.com"];
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>NoSuchBucket</Code><Message>The specified bucket does not exist</Message><BucketName>www.example.com</BucketName><RequestId>SECRET-REQUEST-ID</RequestId></Error>';
    const spy = stubFetch({ "https://www.example.com/": { status: 404, body } });
    const result = await check.run(endpoint, "example.com");
    const www = hosts(result.data)["www.example.com"];
    expect(www).toMatchObject({ service: "AWS/S3", vulnerable: true, evidence: "fingerprint" });
    expect(JSON.stringify(result)).not.toContain("SECRET-REQUEST-ID");
    // The host is fetched, not the CNAME target.
    expect(spy.mock.calls.map(([u]) => String(u))).toEqual(["https://www.example.com/"]);
  });

  it("falls back to http and matches regex fingerprints", async () => {
    cnames["example.com"] = ["abandoned.ngrok.io"];
    stubFetch({ "http://example.com/": { body: "Tunnel abandoned.ngrok.io not found" } });
    const result = await check.run(endpoint, "example.com");
    expect(hosts(result.data)["example.com"]).toMatchObject({
      service: "Ngrok",
      vulnerable: true,
      evidence: "fingerprint",
    });
  });

  it("doesn't flag a claimed resource", async () => {
    cnames["www.example.com"] = ["example.bitbucket.io"];
    stubFetch({ "https://www.example.com/": { body: "<html>Welcome</html>" } });
    const result = await check.run(endpoint, "example.com");
    expect(hosts(result.data)["www.example.com"]).toMatchObject({
      service: "Bitbucket",
      vulnerable: false,
      evidence: null,
    });
    expect(result.data.vulnerable).toBe(false);
  });

  it("reports null when the fingerprint page can't be fetched", async () => {
    cnames["www.example.com"] = ["example.bitbucket.io"];
    stubFetch({});
    const result = await check.run(endpoint, "example.com");
    expect(hosts(result.data)["www.example.com"].vulnerable).toBeNull();
    expect(result.data.vulnerable).toBeNull();
  });

  it("reports null when DNS fails", async () => {
    stubFetch({});
    cnames["example.com"] = "ESERVFAIL";
    const result = await check.run(endpoint, "example.com");
    expect(hosts(result.data)["example.com"]).toMatchObject({
      dangling: null,
      vulnerable: null,
    });
    expect(result.data.vulnerable).toBeNull();
  });

  it("treats a host that doesn't exist as not vulnerable", async () => {
    stubFetch({});
    cnames["www.example.com"] = "ENOTFOUND";
    const result = await check.run(endpoint, "example.com");
    expect(hosts(result.data)["www.example.com"]).toMatchObject({
      cname: null,
      dangling: false,
      vulnerable: false,
    });
  });

  it("follows a multi-hop chain and matches an intermediate hop", async () => {
    stubFetch({});
    cnames["www.example.com"] = ["alias.example.net"];
    cnames["alias.example.net"] = ["gone.trydiscourse.com"];
    cnames["gone.trydiscourse.com"] = "ENOTFOUND";
    const result = await check.run(endpoint, "example.com");
    expect(hosts(result.data)["www.example.com"]).toMatchObject({
      cname: "alias.example.net",
      chain: ["alias.example.net", "gone.trydiscourse.com"],
      dangling: true,
      service: "Discourse",
      vulnerable: true,
    });
  });

  it("reports a dangling CNAME to an unknown service without calling it vulnerable", async () => {
    stubFetch({});
    cnames["www.example.com"] = ["gone.example-cdn.net"];
    cnames["gone.example-cdn.net"] = "ENOTFOUND";
    const result = await check.run(endpoint, "example.com");
    expect(hosts(result.data)["www.example.com"]).toMatchObject({
      dangling: true,
      service: null,
      vulnerable: false,
    });
  });

  it("stops on a CNAME loop", async () => {
    stubFetch({});
    cnames["www.example.com"] = ["a.example.net"];
    cnames["a.example.net"] = ["b.example.net"];
    cnames["b.example.net"] = ["a.example.net"];
    const result = await check.run(endpoint, "example.com");
    expect(hosts(result.data)["www.example.com"].chain).toEqual(["a.example.net", "b.example.net"]);
  });

  it("does not match a service name that merely appears inside a label", async () => {
    stubFetch({});
    cnames["www.example.com"] = ["notghost.io"];
    const result = await check.run(endpoint, "example.com");
    expect(hosts(result.data)["www.example.com"].service).toBeNull();
  });

  it("uses the context timeout and cancels DNS on abort", async () => {
    stubFetch({});
    const controller = new AbortController();
    await check.run(endpoint, "example.com", { timeoutMs: 2500, signal: controller.signal });
    expect(resolverOptions).toEqual([{ timeout: 2500, tries: 2 }]);

    expect(mockCancel).not.toHaveBeenCalled();

    // Abort while the lookups are in flight.
    const run = check.run(endpoint, "example.com", { timeoutMs: 1000, signal: controller.signal });
    controller.abort();
    await run;
    expect(mockCancel).toHaveBeenCalledOnce();
  });
});
