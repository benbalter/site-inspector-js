import dns from "node:dns/promises";
import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { findTxtRecords, safeFetch } from "../utils.js";

/**
 * DKIM selectors used by common mail providers. DNS can't list a domain's
 * selectors, so this can find DKIM but never prove it's absent.
 */
const DKIM_SELECTORS = [
  "google", // Google Workspace
  "selector1", // Microsoft 365
  "selector2",
  "default",
  "dkim",
  "mail",
  "k1", // Mailchimp
  "k2",
  "s1", // SendGrid
  "s2",
  "fm1", // Fastmail
  "fm2",
  "fm3",
  "protonmail", // Proton Mail
  "protonmail2",
  "protonmail3",
  "zmail", // Zoho
  "sig1", // iCloud
  "mandrill", // Mailchimp Transactional
  "smtp",
  "mxvault",
  "everlytickey1",
  "cm", // Campaign Monitor
];

/** Most MX hosts to look up TLSA records for, lowest preference first. */
const MAX_MX_HOSTS = 3;

/** DNS error codes that mean "no such record" rather than a failed lookup. */
const ABSENT = new Set(["ENODATA", "ENOTFOUND"]);
const errorCode = (err: unknown) => (err as NodeJS.ErrnoException).code ?? "UNKNOWN";

async function findDkim(domain: string) {
  const lookups = await Promise.all(
    DKIM_SELECTORS.map((selector) =>
      findTxtRecords(`${selector}._domainkey.${domain}`, /^v=DKIM1|(?:^|;)\s*p=/i),
    ),
  );
  const selectors = DKIM_SELECTORS.filter((_s, i) => lookups[i].records.length > 0);
  const failed = lookups.find((l) => l.error !== null);
  return {
    exists: selectors.length > 0,
    selectors,
    checked: DKIM_SELECTORS.length,
    // Only worth reporting when nothing was found: one failed lookup among
    // many doesn't undermine a selector that was found.
    error: selectors.length === 0 ? (failed?.error ?? null) : null,
  };
}

/** TLSA records (DANE, RFC 7672) for the domain's mail servers. */
async function findDane(domain: string) {
  let mxHosts: string[];
  try {
    const mx = await dns.resolveMx(domain);
    mxHosts = mx
      .filter((r) => r.exchange !== "") // A null MX (RFC 7505) accepts no mail.
      .sort((a, b) => a.priority - b.priority)
      .map((r) => r.exchange.toLowerCase())
      .slice(0, MAX_MX_HOSTS);
  } catch (err) {
    const code = errorCode(err);
    return { exists: false, mxHosts: [], hostsWithTlsa: [], error: ABSENT.has(code) ? null : code };
  }

  const lookups = await Promise.all(
    mxHosts.map(async (host) => {
      try {
        return { found: (await dns.resolveTlsa(`_25._tcp.${host}`)).length > 0, error: null };
      } catch (err) {
        const code = errorCode(err);
        return { found: false, error: ABSENT.has(code) ? null : code };
      }
    }),
  );
  const hostsWithTlsa = mxHosts.filter((_h, i) => lookups[i].found);
  return {
    exists: hostsWithTlsa.length > 0,
    mxHosts,
    hostsWithTlsa,
    error: hostsWithTlsa.length === 0 ? (lookups.find((l) => l.error)?.error ?? null) : null,
  };
}

export class EmailSecurityCheck implements Check {
  name = "email-security";

  async run(_endpoint: EndpointData, domain: string): Promise<CheckResult> {
    const [bimi, mtaSts, tlsRpt, policyRes, dkim, dane] = await Promise.all([
      // BIMI: TXT record at default._bimi.DOMAIN
      findTxtRecords(`default._bimi.${domain}`, /^v=BIMI1/i),
      // MTA-STS: TXT record at _mta-sts.DOMAIN
      findTxtRecords(`_mta-sts.${domain}`, /^v=STSv1/i),
      // TLS-RPT: TXT record at _smtp._tls.DOMAIN
      findTxtRecords(`_smtp._tls.${domain}`, /^v=TLSRPTv1/i),
      // The MTA-STS policy lives on the mta-sts subdomain (RFC 8461 §3.2).
      safeFetch(`https://mta-sts.${domain}/.well-known/mta-sts.txt`, 5000),
      findDkim(domain),
      findDane(domain),
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
        dkim,
        dane,
      },
    };
  }
}
