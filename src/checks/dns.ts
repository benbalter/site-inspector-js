import dns from "node:dns/promises";
import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

const CDN_PATTERNS: Record<string, RegExp> = {
  cloudflare: /cloudflare/i,
  cloudfront: /cloudfront/i,
  akamai: /akamai|edgekey|edgesuite/i,
  fastly: /fastly/i,
  incapsula: /incapsula/i,
  azure: /azureedge|azure/i,
  google: /googleusercontent|googleapis/i,
};

function detectCdn(cname: string): string | null {
  for (const [name, pattern] of Object.entries(CDN_PATTERNS)) {
    if (pattern.test(cname)) {
      return name;
    }
  }
  return null;
}

export class DnsCheck implements Check {
  name = "dns";

  async run(_endpoint: EndpointData, domain: string): Promise<CheckResult> {
    const resolver = new dns.Resolver();

    let aRecords: string[] = [];
    let aaaaRecords: string[] = [];
    let mxRecords: { exchange: string; priority: number }[] = [];
    let caaRecords: object[] = [];

    // Resolve records in parallel
    const [aResult, aaaaResult, mxResult, caaResult] = await Promise.allSettled(
      [
        resolver.resolve4(domain),
        resolver.resolve6(domain),
        resolver.resolveMx(domain),
        resolver.resolveCaa(domain),
      ],
    );

    if (aResult.status === "fulfilled") aRecords = aResult.value;
    if (aaaaResult.status === "fulfilled") aaaaRecords = aaaaResult.value;
    if (mxResult.status === "fulfilled") mxRecords = mxResult.value;
    if (caaResult.status === "fulfilled") caaRecords = caaResult.value;

    const ipv6 = aaaaRecords.length > 0;
    const ip = aRecords[0] ?? null;

    // Reverse DNS lookup on first IP
    let hostname: string | null = null;
    if (ip) {
      try {
        const hostnames = await resolver.reverse(ip);
        hostname = hostnames[0] ?? null;
      } catch {
        // reverse lookup not always available
      }
    }

    // CDN detection via CNAME
    let cdn: string | null = null;
    try {
      const cnames = await resolver.resolveCname(domain);
      for (const cname of cnames) {
        cdn = detectCdn(cname);
        if (cdn) break;
      }
    } catch {
      // no CNAME record
    }

    return {
      name: this.name,
      data: {
        a: aRecords,
        aaaa: aaaaRecords,
        mx: mxRecords,
        caa: caaRecords,
        ipv6,
        ip,
        hostname,
        cdn,
      },
    };
  }
}
