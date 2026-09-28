import { createRequire } from "node:module";
import dns from "node:dns/promises";
import type { Check, CheckContext } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { safeFetch } from "../utils.js";

const require = createRequire(import.meta.url);

/** An entry in EdOverflow/can-i-take-over-xyz's fingerprints.json. */
interface RawFingerprint {
  service: string;
  cname: string[];
  fingerprint: string;
  nxdomain: boolean;
  vulnerable: boolean;
}

interface Fingerprint {
  service: string;
  cnames: string[];
  /** Null when the NXDOMAIN of the target is the evidence. */
  pattern: RegExp | string | null;
}

/** Most fingerprints are literal text; a few are regular expressions. */
function toPattern(text: string): RegExp | string {
  // The upstream file escapes "|" as an HTML entity (it's also a Markdown table).
  const decoded = text.replace(/&#124;/g, "|");
  if (/\.\*|\\\.|\|/.test(decoded)) {
    try {
      return new RegExp(decoded);
    } catch {
      // Fall through to a literal match.
    }
  }
  return decoded;
}

let fingerprints: Fingerprint[] | null = null;

/**
 * Load the vendored fingerprints on first use, keeping only services known
 * to be vulnerable whose evidence we can check: a hostname CNAME plus either
 * NXDOMAIN or body text. Status-code-only fingerprints prove nothing alone.
 */
export function loadFingerprints(): Fingerprint[] {
  if (fingerprints) return fingerprints;
  const raw = require("../../data/takeover-fingerprints.json") as RawFingerprint[];
  fingerprints = raw.flatMap((entry): Fingerprint[] => {
    if (!entry.vulnerable) return [];
    const cnames = entry.cname
      .map((c) => c.toLowerCase().replace(/\.$/, ""))
      .filter((c) => c && !/^[\d.]+$/.test(c));
    if (cnames.length === 0) return [];
    if (entry.nxdomain) return [{ service: entry.service, cnames, pattern: null }];
    const text = entry.fingerprint.trim();
    if (!text || text.startsWith("HTTP_STATUS=")) return [];
    return [{ service: entry.service, cnames, pattern: toPattern(text) }];
  });
  return fingerprints;
}

function matchesSuffix(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

type Chain =
  /** The queried host doesn't exist. */
  | { kind: "missing" }
  /** DNS couldn't answer (timeout, SERVFAIL, cancelled). */
  | { kind: "error" }
  /** `dangling`: the last CNAME target is NXDOMAIN. */
  | { kind: "ok"; chain: string[]; dangling: boolean };

const MAX_HOPS = 10;

async function cnameChain(resolver: dns.Resolver, host: string): Promise<Chain> {
  const chain: string[] = [];
  let current = host;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let targets: string[];
    try {
      targets = await resolver.resolveCname(current);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENODATA") return { kind: "ok", chain, dangling: false };
      if (code === "ENOTFOUND") {
        return current === host ? { kind: "missing" } : { kind: "ok", chain, dangling: true };
      }
      return { kind: "error" };
    }
    const next = targets[0]?.toLowerCase().replace(/\.$/, "");
    if (!next || next === host || chain.includes(next)) break;
    chain.push(next);
    current = next;
  }
  return { kind: "ok", chain, dangling: false };
}

/** Takeover facts for one hostname. Never includes the fetched body. */
export interface HostTakeover {
  host: string;
  /** The host's CNAME target, if any. */
  cname: string | null;
  /** Every CNAME target in order. */
  chain: string[];
  /** Whether the chain ends at a name that doesn't exist; null if DNS failed. */
  dangling: boolean | null;
  /** Takeover-prone service the chain points at. */
  service: string | null;
  /** Null when the evidence couldn't be checked. */
  vulnerable: boolean | null;
  evidence: "nxdomain" | "fingerprint" | null;
}

async function bodyMatches(host: string, pattern: RegExp | string, timeoutMs: number) {
  for (const scheme of ["https", "http"]) {
    // Fetch the host itself: the error page depends on the Host header.
    const res = await safeFetch(`${scheme}://${host}/`, timeoutMs);
    if (!res) continue;
    return typeof pattern === "string" ? res.body.includes(pattern) : pattern.test(res.body);
  }
  return null;
}

async function inspectHost(
  resolver: dns.Resolver,
  host: string,
  timeoutMs: number,
): Promise<HostTakeover> {
  const result: HostTakeover = {
    host,
    cname: null,
    chain: [],
    dangling: false,
    service: null,
    vulnerable: false,
    evidence: null,
  };
  const chain = await cnameChain(resolver, host);
  if (chain.kind === "missing") return result;
  if (chain.kind === "error") return { ...result, dangling: null, vulnerable: null };

  result.chain = chain.chain;
  result.cname = chain.chain[0] ?? null;
  result.dangling = chain.dangling;

  const fp = loadFingerprints().find((f) =>
    chain.chain.some((target) => f.cnames.some((c) => matchesSuffix(target, c))),
  );
  if (!fp) return result;
  result.service = fp.service;

  if (fp.pattern === null) {
    result.vulnerable = chain.dangling;
    if (chain.dangling) result.evidence = "nxdomain";
    return result;
  }
  const matched = await bodyMatches(host, fp.pattern, timeoutMs);
  result.vulnerable = matched;
  if (matched) result.evidence = "fingerprint";
  return result;
}

export class SubdomainTakeoverCheck implements Check {
  name = "subdomain-takeover";

  async run(_endpoint: EndpointData, domain: string, ctx?: CheckContext): Promise<CheckResult> {
    const timeoutMs = ctx?.timeoutMs ?? 5000;
    const resolver = new dns.Resolver({ timeout: timeoutMs, tries: 2 });
    const cancel = () => resolver.cancel();
    ctx?.signal.addEventListener("abort", cancel, { once: true });

    try {
      const hosts = await Promise.all(
        [domain, `www.${domain}`].map((h) => inspectHost(resolver, h, timeoutMs)),
      );
      const vulnerableHosts = hosts.filter((h) => h.vulnerable === true).map((h) => h.host);
      const vulnerable =
        vulnerableHosts.length > 0 ? true : hosts.some((h) => h.vulnerable === null) ? null : false;

      return {
        name: this.name,
        data: { hosts, vulnerable, vulnerableHosts },
      };
    } finally {
      ctx?.signal.removeEventListener("abort", cancel);
    }
  }
}
