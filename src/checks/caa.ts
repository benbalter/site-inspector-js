import dns from "node:dns/promises";
import type { CaaRecord } from "node:dns";
import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

const DNS_ABSENT = new Set(["ENODATA", "ENOTFOUND"]);

// Tags defined by RFC 8659 and RFC 8657/9495 extensions; anything else
// flagged critical means a CA that doesn't understand it must refuse to issue.
const KNOWN_TAGS = new Set([
  "issue",
  "issuewild",
  "iodef",
  "issuemail",
  "issuevmc",
  "contactemail",
  "contactphone",
]);

const CRITICAL_FLAG = 128;

/**
 * The names to query, from `domain` up to (but not past) the last two
 * labels. RFC 8659 climbs to the root; stopping at two labels approximates
 * the registrable domain without a public-suffix list, so for names under a
 * multi-label suffix (e.g. `example.co.uk`) we may also query `co.uk`.
 */
export function caaSearchPath(domain: string): string[] {
  const labels = domain.replace(/\.$/, "").split(".").filter(Boolean);
  const names: string[] = [];
  for (let i = 0; i <= labels.length - 2; i++) names.push(labels.slice(i).join("."));
  if (names.length === 0 && labels.length > 0) names.push(labels.join("."));
  return names;
}

/**
 * Checks DNS Certification Authority Authorization records (RFC 8659), which
 * restrict which CAs may issue certificates for the domain. The relevant
 * record set is the first one found walking from the domain up its parents.
 */
export class CaaCheck implements Check {
  name = "caa";

  async run(_endpoint: EndpointData, domain: string): Promise<CheckResult> {
    let records: CaaRecord[] = [];
    let foundAt: string | null = null;
    let error: string | null = null;

    for (const name of caaSearchPath(domain)) {
      try {
        const found = await dns.resolveCaa(name);
        if (found.length > 0) {
          records = found;
          foundAt = name;
          break;
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code && DNS_ABSENT.has(code)) continue;
        // A failed lookup can't be skipped: the parent's records (or their
        // absence) wouldn't be the ones that apply.
        error = code ?? (err instanceof Error ? err.message : String(err));
        break;
      }
    }

    const values = (tag: string) =>
      records.flatMap((r) => {
        const v = (r as unknown as Record<string, unknown>)[tag];
        return typeof v === "string" ? [v] : [];
      });

    const issue = values("issue");
    const issuewild = values("issuewild");
    const iodef = values("iodef");

    const criticalUnknownTags = records
      .filter((r) => (r.critical & CRITICAL_FLAG) !== 0)
      .flatMap((r) => Object.keys(r).filter((k) => k !== "critical" && !KNOWN_TAGS.has(k)));

    const present = error ? null : records.length > 0;

    return {
      name: this.name,
      data: {
        present,
        foundAt,
        issue,
        issuewild,
        iodef,
        issuerRestricted: present === null ? null : issue.length > 0,
        wildcardRestricted: present === null ? null : issuewild.length > 0 || issue.length > 0,
        criticalUnknownTags,
        error,
      },
    };
  }
}
