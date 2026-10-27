import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { fetchJson } from "../utils.js";

/** Most subdomains to list; `subdomainCount` still counts them all. */
const MAX_SUBDOMAINS = 100;

/**
 * crt.sh is slow for busy domains, so it gets more time than most lookups,
 * but not so much that one slow query holds up every inspection: the biggest
 * domains time out either way.
 */
const CRT_TIMEOUT_MS = 15_000;

/** One row of crt.sh's JSON output. */
interface CrtEntry {
  issuer_name: string;
  name_value: string;
  not_before: string;
  not_after: string;
}

/** The organization (or, failing that, common name) from an issuer DN. */
function issuerName(dn: string): string {
  const field = (key: string) => new RegExp(`(?:^|,\\s*)${key}=([^,]+)`).exec(dn)?.[1].trim();
  return field("O") ?? field("CN") ?? dn;
}

/** crt.sh timestamps are UTC without a zone designator. */
function utc(timestamp: string): string {
  return timestamp.endsWith("Z") ? timestamp : `${timestamp}Z`;
}

/**
 * Certificates issued for the domain and its subdomains, from the public
 * Certificate Transparency logs (via crt.sh). Only unexpired certificates are
 * counted. The names on them double as a passive subdomain list.
 */
export class CertificateTransparencyCheck implements Check {
  name = "certificate-transparency";

  async run(_endpoint: EndpointData, domain: string): Promise<CheckResult> {
    const url = `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json&exclude=expired&deduplicate=Y`;
    const response = (await fetchJson(url, CRT_TIMEOUT_MS)) as unknown;

    if (!Array.isArray(response)) {
      return {
        name: this.name,
        data: {
          lookupFailed: true,
          certificateCount: null,
          issuers: [],
          wildcard: null,
          subdomainCount: null,
          subdomains: [],
          latestIssued: null,
          nextExpiry: null,
        },
      };
    }

    const entries = response as CrtEntry[];
    const names = entries.flatMap((e) => e.name_value.toLowerCase().split("\n"));
    const subdomains = new Set(
      names
        .map((n) => n.trim().replace(/^\*\./, ""))
        .filter((n) => n !== domain && n.endsWith(`.${domain}`)),
    );
    const issued = entries.map((e) => utc(e.not_before)).sort();
    const expiries = entries.map((e) => utc(e.not_after)).sort();

    return {
      name: this.name,
      data: {
        lookupFailed: false,
        certificateCount: entries.length,
        issuers: [...new Set(entries.map((e) => issuerName(e.issuer_name)))].sort(),
        wildcard: names.some((n) => n.startsWith("*.")),
        subdomainCount: subdomains.size,
        subdomains: [...subdomains].sort().slice(0, MAX_SUBDOMAINS),
        latestIssued: issued.at(-1) ?? null,
        nextExpiry: expiries[0] ?? null,
      },
    };
  }
}
