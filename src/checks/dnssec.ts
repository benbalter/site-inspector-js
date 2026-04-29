import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

interface DohResponse {
  Status: number;
  AD?: boolean; // Authenticated Data flag
  Answer?: Array<{ type: number; data: string }>;
}

async function queryDoh(name: string, type: number): Promise<DohResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const url = `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}&do=1`;
  const res = await fetch(url, {
    signal: controller.signal,
    headers: {
      "User-Agent": "site-inspector/0.1 (https://github.com/benbalter/site-inspector-js)",
    },
  });
  clearTimeout(timer);
  return res.json() as Promise<DohResponse>;
}

export class DnssecCheck implements Check {
  name = "dnssec";

  async run(_endpoint: EndpointData, domain: string): Promise<CheckResult> {
    let enabled = false;
    let adFlag = false;
    let hasDnskey = false;
    let hasDs = false;
    let hasRrsig = false;

    try {
      // Type 48 = DNSKEY, Type 43 = DS, Type 46 = RRSIG
      const [dnskeyRes, dsRes, rrsigRes] = await Promise.all([
        queryDoh(domain, 48),
        queryDoh(domain, 43),
        queryDoh(domain, 46),
      ]);

      hasDnskey = (dnskeyRes.Answer?.length ?? 0) > 0;
      hasDs = (dsRes.Answer?.length ?? 0) > 0;
      hasRrsig = (rrsigRes.Answer?.length ?? 0) > 0;
      adFlag = dnskeyRes.AD === true || dsRes.AD === true;
      enabled = hasDnskey || hasDs;
    } catch {
      // DNS-over-HTTPS failed
    }

    return {
      name: this.name,
      data: {
        enabled,
        adFlag,
        hasDnskey,
        hasDs,
        hasRrsig,
      },
    };
  }
}
