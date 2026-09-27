import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { findTxtRecords, safeFetch } from "../utils.js";

export class EmailSecurityCheck implements Check {
  name = "email-security";

  async run(_endpoint: EndpointData, domain: string): Promise<CheckResult> {
    const [bimi, mtaSts, tlsRpt, policyRes] = await Promise.all([
      // BIMI: TXT record at default._bimi.DOMAIN
      findTxtRecords(`default._bimi.${domain}`, /^v=BIMI1/i),
      // MTA-STS: TXT record at _mta-sts.DOMAIN
      findTxtRecords(`_mta-sts.${domain}`, /^v=STSv1/i),
      // TLS-RPT: TXT record at _smtp._tls.DOMAIN
      findTxtRecords(`_smtp._tls.${domain}`, /^v=TLSRPTv1/i),
      // The MTA-STS policy lives on the mta-sts subdomain (RFC 8461 §3.2).
      safeFetch(`https://mta-sts.${domain}/.well-known/mta-sts.txt`, 5000),
    ]);

    const bimiRecord = bimi.records[0] ?? null;
    const bimiLogo = bimiRecord?.match(/l=([^;\s]+)/)?.[1] ?? null;

    let mtaStsMode: string | null = null;
    if (policyRes && policyRes.statusCode === 200) {
      const modeMatch = policyRes.body.match(/mode:\s*(enforce|testing|none)/i);
      mtaStsMode = modeMatch ? modeMatch[1].toLowerCase() : null;
    }
    const mtaStsRecord = mtaSts.records[0] ?? null;
    const tlsRptRecord = tlsRpt.records[0] ?? null;

    return {
      name: this.name,
      data: {
        bimi: {
          exists: bimiRecord !== null,
          record: bimiRecord,
          logo: bimiLogo,
          error: bimi.error,
        },
        mtaSts: {
          exists: mtaStsRecord !== null,
          record: mtaStsRecord,
          mode: mtaStsMode,
          error: mtaSts.error,
        },
        tlsRpt: { exists: tlsRptRecord !== null, record: tlsRptRecord, error: tlsRpt.error },
      },
    };
  }
}
