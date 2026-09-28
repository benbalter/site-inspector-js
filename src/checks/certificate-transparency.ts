import type { Check, CheckContext } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { MAX_BODY_BYTES, USER_AGENT, readBody } from "../utils.js";

/** One row of crt.sh's `output=json` response. */
interface CrtShEntry {
  id: number;
  issuer_name: string;
  common_name?: string;
  /** SAN names, newline-separated. */
  name_value: string;
  /** UTC, but without a timezone suffix (e.g. "2026-08-28T21:06:05"). */
  not_before: string;
  not_after: string;
}

/** crt.sh is slow; give it most of the 60s light-check budget. */
const CRTSH_TIMEOUT_MS = 45_000;
const MAX_SUBDOMAINS = 100;
const MAX_ISSUERS = 10;

type Fetched = { ok: true; body: string } | { ok: false; error: string };

async function fetchText(url: string, timeoutMs: number, signal?: AbortSignal): Promise<Fetched> {
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    const res = await fetch(url, {
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) {
      await res.body?.cancel();
      return { ok: false, error: `crt.sh returned HTTP ${res.status}` };
    }
    return { ok: true, body: await readBody(res, MAX_BODY_BYTES) };
  } catch (err) {
    if (timeout.aborted) return { ok: false, error: "crt.sh timed out" };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** The organization (or, failing that, common name) from an issuer DN. */
export function issuerOrg(dn: string): string {
  const attr = (key: string): string | null => {
    const match = new RegExp(`(?:^|,\\s*)${key}=("(?:[^"]|"")*"|[^,]*)`).exec(dn);
    if (!match) return null;
    const value = match[1].trim();
    return value.startsWith('"') ? value.slice(1, -1).replace(/""/g, '"') : value;
  };
  return attr("O") || attr("CN") || dn;
}

function unavailable(error: string): Record<string, unknown> {
  return {
    available: false,
    certificateCount: null,
    issuers: null,
    subdomains: null,
    subdomainCount: null,
    wildcardCount: null,
    mostRecentIssued: null,
    error,
  };
}

export class CertificateTransparencyCheck implements Check {
  name = "certificate-transparency";

  async run(_endpoint: EndpointData, domain: string, ctx?: CheckContext): Promise<CheckResult> {
    const apex = domain.toLowerCase();
    const url = `https://crt.sh/?q=${encodeURIComponent(apex)}&output=json&exclude=expired&deduplicate=Y`;
    const res = await fetchText(url, CRTSH_TIMEOUT_MS, ctx?.signal);
    if (!res.ok) return { name: this.name, data: unavailable(res.error) };

    let entries: CrtShEntry[];
    try {
      const parsed: unknown = JSON.parse(res.body);
      if (!Array.isArray(parsed)) throw new Error("not an array");
      entries = parsed as CrtShEntry[];
    } catch {
      // A body cut off at the size cap won't parse; say so rather than report
      // a misleadingly small count.
      const truncated = Buffer.byteLength(res.body, "utf8") >= MAX_BODY_BYTES - 4;
      return {
        name: this.name,
        data: unavailable(
          truncated ? "Too many certificates to list" : "crt.sh returned an invalid response",
        ),
      };
    }

    const seen = new Set<number>();
    const issuerCounts = new Map<string, number>();
    const subdomains = new Set<string>();
    let certificateCount = 0;
    let wildcardCount = 0;
    let mostRecent: number | null = null;

    for (const entry of entries) {
      if (typeof entry?.name_value !== "string" || seen.has(entry.id)) continue;

      // crt.sh's identity search also matches look-alikes and S/MIME email
      // addresses; keep only hostnames that are the domain or under it.
      const names = entry.name_value
        .split("\n")
        .map((n) => n.trim().toLowerCase())
        .filter((n) => /^[*a-z0-9._-]+$/.test(n))
        .filter((n) => n === apex || n.endsWith(`.${apex}`));
      if (names.length === 0) continue;

      seen.add(entry.id);
      certificateCount++;
      if (names.some((n) => n.startsWith("*."))) wildcardCount++;
      for (const name of names) {
        const host = name.replace(/^\*\./, "");
        if (host !== apex) subdomains.add(host);
      }

      const issuer = issuerOrg(entry.issuer_name ?? "");
      issuerCounts.set(issuer, (issuerCounts.get(issuer) ?? 0) + 1);

      const issued = Date.parse(`${entry.not_before}Z`);
      if (!Number.isNaN(issued) && (mostRecent === null || issued > mostRecent)) {
        mostRecent = issued;
      }
    }

    const issuers = [...issuerCounts]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, MAX_ISSUERS);

    return {
      name: this.name,
      data: {
        available: true,
        certificateCount,
        issuers,
        subdomains: [...subdomains].sort().slice(0, MAX_SUBDOMAINS),
        subdomainCount: subdomains.size,
        wildcardCount,
        mostRecentIssued: mostRecent === null ? null : new Date(mostRecent).toISOString(),
        error: null,
      },
    };
  }
}
