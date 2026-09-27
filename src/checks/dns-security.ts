import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { findTxtRecords } from "../utils.js";

/** The SPF `all` mechanism, with an omitted qualifier read as `+` (RFC 7208 §4.6.2). */
function extractAllMechanism(record: string): string | null {
  for (const term of record.split(/\s+/)) {
    const match = /^([+\-~?]?)all$/i.exec(term);
    if (match) return `${match[1] || "+"}all`;
  }
  return null;
}

/** Parse DMARC `tag=value` pairs, matching tag names exactly (so `sp=` isn't `p=`). */
function parseDmarcTags(record: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const part of record.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    tags[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
  }
  return tags;
}

export class DnsSecurityCheck implements Check {
  name = "dns-security";

  async run(_endpoint: EndpointData, domain: string): Promise<CheckResult> {
    const [spfLookup, dmarcLookup] = await Promise.all([
      findTxtRecords(domain, /^v=spf1(\s|$)/i),
      findTxtRecords(`_dmarc.${domain}`, /^v=DMARC1\s*(;|$)/i),
    ]);

    // SPF: more than one record is a permerror (RFC 7208 §4.5).
    const spfRecord = spfLookup.records[0] ?? null;
    const multipleRecords = spfLookup.records.length > 1;
    const allMechanism = spfRecord ? extractAllMechanism(spfRecord) : null;

    // DMARC
    const dmarcRecord = dmarcLookup.records[0] ?? null;
    const tags = dmarcRecord ? parseDmarcTags(dmarcRecord) : {};
    const policy = tags.p?.toLowerCase() ?? null;
    const percentage = tags.pct !== undefined ? Number(tags.pct) : null;

    return {
      name: this.name,
      data: {
        spf: {
          exists: spfRecord !== null,
          record: spfRecord,
          allMechanism,
          multipleRecords,
          strongPolicy: allMechanism === "-all" && !multipleRecords,
          error: spfLookup.error,
        },
        dmarc: {
          exists: dmarcRecord !== null,
          record: dmarcRecord,
          policy,
          subdomainPolicy: tags.sp?.toLowerCase() ?? null,
          percentage,
          reportUri: tags.rua ?? null,
          strongPolicy: policy === "reject" || policy === "quarantine",
          error: dmarcLookup.error,
        },
      },
    };
  }
}
