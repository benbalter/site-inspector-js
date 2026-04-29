import dns from "node:dns/promises";
import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

function extractAllMechanism(record: string): string | null {
  const match = record.match(/([+\-~?])all/);
  return match ? `${match[1]}all` : null;
}

function extractDmarcTag(record: string, tag: string): string | null {
  const match = record.match(new RegExp(`${tag}=([^;\\s]+)`));
  return match ? match[1].trim() : null;
}

export class DnsSecurityCheck implements Check {
  name = "dns-security";

  async run(_endpoint: EndpointData, domain: string): Promise<CheckResult> {
    // SPF lookup
    let spfRecord: string | null = null;
    let spfExists = false;
    let allMechanism: string | null = null;

    try {
      const txtRecords = await dns.resolveTxt(domain);
      const allTxt = txtRecords.map((r) => r.join(""));
      spfRecord = allTxt.find((r) => r.startsWith("v=spf1")) ?? null;
      spfExists = spfRecord !== null;
      if (spfRecord) {
        allMechanism = extractAllMechanism(spfRecord);
      }
    } catch {
      // ENODATA / ENOTFOUND — no TXT records
    }

    // DMARC lookup
    let dmarcRecord: string | null = null;
    let dmarcExists = false;
    let policy: string | null = null;
    let percentage: number | null = null;
    let reportUri: string | null = null;

    try {
      const dmarcRecords = await dns.resolveTxt(`_dmarc.${domain}`);
      const allDmarc = dmarcRecords.map((r) => r.join(""));
      dmarcRecord = allDmarc.find((r) => r.startsWith("v=DMARC1")) ?? null;
      dmarcExists = dmarcRecord !== null;
      if (dmarcRecord) {
        policy = extractDmarcTag(dmarcRecord, "p") ?? null;
        const pctStr = extractDmarcTag(dmarcRecord, "pct");
        percentage = pctStr !== null ? Number(pctStr) : null;
        reportUri = extractDmarcTag(dmarcRecord, "rua") ?? null;
      }
    } catch {
      // ENODATA / ENOTFOUND — no DMARC record
    }

    return {
      name: this.name,
      data: {
        spf: {
          exists: spfExists,
          record: spfRecord,
          allMechanism,
          strongPolicy: allMechanism === "-all",
        },
        dmarc: {
          exists: dmarcExists,
          record: dmarcRecord,
          policy,
          percentage,
          reportUri,
          strongPolicy: policy === "reject" || policy === "quarantine",
        },
      },
    };
  }
}
