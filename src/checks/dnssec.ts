import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { fetchJson } from "../utils.js";

interface DohResponse {
  Status: number;
  AD?: boolean; // Authenticated Data flag
  Answer?: Array<{ type: number; data: string }>;
}

const TYPE = { A: 1, DS: 43, RRSIG: 46, DNSKEY: 48 } as const;

async function queryDoh(name: string, type: number): Promise<DohResponse> {
  const url = `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}&do=1`;
  const res = await fetchJson(url, 5000);
  if (!res) throw new Error("DNS-over-HTTPS lookup failed");
  return res as unknown as DohResponse;
}

export class DnssecCheck implements Check {
  name = "dnssec";

  async run(_endpoint: EndpointData, domain: string): Promise<CheckResult> {
    let adFlag = false;
    let hasDnskey = false;
    let hasDs = false;
    let hasRrsig = false;
    let error: string | null = null;

    try {
      const [aRes, dnskeyRes, dsRes, rrsigRes] = await Promise.all([
        queryDoh(domain, TYPE.A),
        queryDoh(domain, TYPE.DNSKEY),
        queryDoh(domain, TYPE.DS),
        queryDoh(domain, TYPE.RRSIG),
      ]);

      hasDnskey = (dnskeyRes.Answer?.length ?? 0) > 0;
      hasDs = (dsRes.Answer?.length ?? 0) > 0;
      hasRrsig = (rrsigRes.Answer?.length ?? 0) > 0;
      // The resolver validated the chain of trust for the name's own records.
      // DNSKEY/DS only exist at a zone apex, so this is what detects a signed
      // subdomain like blog.example.com.
      adFlag = aRes.AD === true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    return {
      name: this.name,
      data: {
        enabled: adFlag || hasDnskey || hasDs,
        adFlag,
        hasDnskey,
        hasDs,
        hasRrsig,
        error,
      },
    };
  }
}
