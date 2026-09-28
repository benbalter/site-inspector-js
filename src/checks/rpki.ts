import dns from "node:dns/promises";
import type { Check, CheckContext } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { USER_AGENT, readBody } from "../utils.js";

/** RIPEstat Data API envelope. */
interface RipeStat<T> {
  status: string;
  data: T;
}

interface NetworkInfo {
  asns: string[];
  /** Empty when the address isn't announced. */
  prefix: string;
}

interface RpkiValidation {
  /** "valid", "invalid", "unknown", ... */
  status: string;
  validating_roas: unknown[];
}

/** RPKI facts for one address family. */
export interface RpkiRoute {
  ip: string | null;
  prefix: string | null;
  asn: string | null;
  /** RIPEstat's route origin validity, passed through ("valid", "invalid", "unknown", ...). */
  status: string | null;
  validatingRoas: number | null;
  error: string | null;
}

const RIPESTAT = "https://stat.ripe.net/data";
const MAX_RESPONSE_BYTES = 512 * 1024;
const DNS_ABSENT = new Set(["ENODATA", "ENOTFOUND"]);

const EMPTY: RpkiRoute = {
  ip: null,
  prefix: null,
  asn: null,
  status: null,
  validatingRoas: null,
  error: null,
};

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function ripeStat<T>(
  call: string,
  params: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  const query = new URLSearchParams({ ...params, sourceapp: "site-inspector" });
  const timeout = AbortSignal.timeout(timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${RIPESTAT}/${call}/data.json?${query}`, {
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
  } catch (err) {
    throw new Error(timeout.aborted ? "RIPEstat timed out" : message(err), { cause: err });
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`RIPEstat ${call} returned HTTP ${res.status}`);
  }
  const body = JSON.parse(await readBody(res, MAX_RESPONSE_BYTES)) as RipeStat<T>;
  if (body?.status !== "ok" || !body.data) throw new Error(`RIPEstat ${call} failed`);
  return body.data;
}

/** The first address of the given family, null if there is none. */
async function resolveFirst(domain: string, family: 4 | 6): Promise<string | null> {
  try {
    const addrs = family === 4 ? await dns.resolve4(domain) : await dns.resolve6(domain);
    return addrs[0] ?? null;
  } catch (err) {
    if (DNS_ABSENT.has((err as NodeJS.ErrnoException).code ?? "")) return null;
    throw err;
  }
}

async function checkFamily(
  domain: string,
  family: 4 | 6,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<RpkiRoute | null> {
  let ip: string | null;
  try {
    ip = await resolveFirst(domain, family);
  } catch (err) {
    return { ...EMPTY, error: `DNS lookup failed: ${message(err)}` };
  }
  if (!ip) return null;

  try {
    const network = await ripeStat<NetworkInfo>(
      "network-info",
      { resource: ip },
      timeoutMs,
      signal,
    );
    const asn = network.asns?.[0] ?? null;
    // Not announced in BGP: there's no route to validate.
    if (!network.prefix || !asn) return { ...EMPTY, ip, prefix: network.prefix || null };

    const rpki = await ripeStat<RpkiValidation>(
      "rpki-validation",
      { resource: asn, prefix: network.prefix },
      timeoutMs,
      signal,
    );
    return {
      ip,
      prefix: network.prefix,
      asn,
      status: rpki.status ?? null,
      validatingRoas: Array.isArray(rpki.validating_roas) ? rpki.validating_roas.length : null,
      error: null,
    };
  } catch (err) {
    return { ...EMPTY, ip, error: message(err) };
  }
}

export class RpkiCheck implements Check {
  name = "rpki";

  async run(_endpoint: EndpointData, domain: string, ctx?: CheckContext): Promise<CheckResult> {
    const timeoutMs = ctx?.timeoutMs ?? 10_000;
    const [v4, v6] = await Promise.all([
      checkFamily(domain, 4, timeoutMs, ctx?.signal),
      checkFamily(domain, 6, timeoutMs, ctx?.signal),
    ]);

    const looked = [v4, v6].filter((r): r is RpkiRoute => r !== null);
    // Available once RIPEstat answered for at least one address.
    const available = looked.some((r) => r.ip !== null && r.error === null);
    const error =
      looked.length === 0 ? "No A or AAAA records" : (v4?.error ?? (available ? null : v6?.error));

    return {
      name: this.name,
      data: {
        available,
        ...(v4 ?? EMPTY),
        error: error ?? null,
        ipv6: v6,
      },
    };
  }
}
