import dns from "node:dns/promises";
import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

export class EmailSecurityCheck implements Check {
  name = "email-security";

  async run(_endpoint: EndpointData, domain: string): Promise<CheckResult> {
    // BIMI: look up TXT record at default._bimi.DOMAIN
    let bimiExists = false;
    let bimiRecord: string | null = null;
    let bimiLogo: string | null = null;

    try {
      const records = await dns.resolveTxt(`default._bimi.${domain}`);
      const all = records.map((r) => r.join(""));
      bimiRecord = all.find((r) => r.startsWith("v=BIMI1")) ?? null;
      bimiExists = bimiRecord !== null;
      if (bimiRecord) {
        const logoMatch = bimiRecord.match(/l=([^;\s]+)/);
        bimiLogo = logoMatch ? logoMatch[1] : null;
      }
    } catch {
      // no BIMI record
    }

    // MTA-STS: look up TXT record at _mta-sts.DOMAIN
    let mtaStsExists = false;
    let mtaStsRecord: string | null = null;
    let mtaStsMode: string | null = null;

    try {
      const records = await dns.resolveTxt(`_mta-sts.${domain}`);
      const all = records.map((r) => r.join(""));
      mtaStsRecord = all.find((r) => r.startsWith("v=STSv1")) ?? null;
      mtaStsExists = mtaStsRecord !== null;
    } catch {
      // no MTA-STS record
    }

    // Also check MTA-STS policy file via HTTPS (/.well-known/mta-sts.txt)
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`https://${domain}/.well-known/mta-sts.txt`, {
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timer);
      if (res.status === 200) {
        const body = await res.text();
        const modeMatch = body.match(/mode:\s*(enforce|testing|none)/i);
        mtaStsMode = modeMatch ? modeMatch[1].toLowerCase() : null;
      }
    } catch {
      // policy file not available
    }

    // TLS-RPT: _smtp._tls.DOMAIN
    let tlsRptExists = false;
    let tlsRptRecord: string | null = null;

    try {
      const records = await dns.resolveTxt(`_smtp._tls.${domain}`);
      const all = records.map((r) => r.join(""));
      tlsRptRecord = all.find((r) => r.startsWith("v=TLSRPTv1")) ?? null;
      tlsRptExists = tlsRptRecord !== null;
    } catch {
      // no TLS-RPT record
    }

    return {
      name: this.name,
      data: {
        bimi: { exists: bimiExists, record: bimiRecord, logo: bimiLogo },
        mtaSts: { exists: mtaStsExists, record: mtaStsRecord, mode: mtaStsMode },
        tlsRpt: { exists: tlsRptExists, record: tlsRptRecord },
      },
    };
  }
}
