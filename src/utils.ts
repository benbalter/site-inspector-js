import { createRequire } from "node:module";
import dns from "node:dns/promises";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

/** Package version, read from package.json. */
export const VERSION: string = version;

/** User-Agent sent with every HTTP request the inspector makes. */
export const USER_AGENT = `site-inspector/${VERSION} (https://github.com/benbalter/site-inspector-js)`;

/** Response bodies larger than this are truncated. */
export const MAX_BODY_BYTES = 5 * 1024 * 1024;

/**
 * Normalize a domain string: strip protocol, path, port, and a leading `www.`
 * (the inspector probes both the apex and www variants itself).
 */
export function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/\/.*$/, "");
  d = d.replace(/:\d+$/, "");
  d = d.replace(/\.$/, "");
  // Only strip www. when something domain-like remains (not "www.com").
  if (/^www\.[^.]+\.[^.]+/.test(d)) d = d.slice(4);
  return d;
}

/** Read a response body as UTF-8 text, stopping after `maxBytes`. */
export async function readBody(response: Response, maxBytes = MAX_BODY_BYTES): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBytes - received;
    if (value.byteLength >= remaining) {
      text += decoder.decode(value.subarray(0, remaining));
      await reader.cancel();
      break;
    }
    received += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** Flatten response headers into a lowercase-keyed object. */
export function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/** Simplified response data returned by {@link fetchWithTimeout}. */
export interface FetchResult {
  ok: boolean;
  statusCode: number;
  headers: Record<string, string>;
  /** Each `Set-Cookie` header separately (they can't be safely comma-joined). */
  setCookies: string[];
  body: string;
  redirected: boolean;
  finalUrl: string;
}

/**
 * Fetch a URL with timeout support, returning simplified response data. The
 * timeout covers reading the body, not just the response headers.
 */
export async function fetchWithTimeout(url: string, timeoutMs: number): Promise<FetchResult> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
    headers: { "User-Agent": USER_AGENT },
  });

  return {
    ok: response.ok,
    statusCode: response.status,
    headers: headersToRecord(response.headers),
    setCookies: response.headers.getSetCookie(),
    body: await readBody(response),
    redirected: response.redirected,
    finalUrl: response.url,
  };
}

/**
 * Try to fetch a URL, returning null on any error (timeout, DNS failure, etc.).
 */
export async function safeFetch(url: string, timeoutMs: number): Promise<FetchResult | null> {
  try {
    return await fetchWithTimeout(url, timeoutMs);
  } catch {
    return null;
  }
}

/** Fetch JSON from a URL with timeout, returning null on failure. */
export async function fetchJson(
  url: string,
  timeoutMs = 5000,
  headers: Record<string, string> = {},
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT, ...headers },
    });
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Probe a URL with a HEAD (or other method) request, returning true if status
 * is 200. HEAD requests that the server rejects (405/501) are retried as GET.
 */
export async function probeUrl(
  url: string,
  method: string = "HEAD",
  timeoutMs = 5000,
): Promise<boolean> {
  const attempt = async (m: string): Promise<number> => {
    const res = await fetch(url, {
      method: m,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT },
    });
    // Only the status matters; release the connection.
    await res.body?.cancel();
    return res.status;
  };

  try {
    let status = await attempt(method);
    if (method === "HEAD" && (status === 405 || status === 501)) {
      status = await attempt("GET");
    }
    return status === 200;
  } catch {
    return false;
  }
}

/**
 * Whether the server answers 200 for any path, as single-page apps often do.
 * On such sites, a 200 from a probe like /graphql or /sw.js proves nothing.
 */
export async function isCatchAll(origin: string, timeoutMs = 5000): Promise<boolean> {
  const random = Math.random().toString(36).slice(2);
  return probeUrl(`${origin}/site-inspector-404-check-${random}`, "HEAD", timeoutMs);
}

/** DNS error codes that mean "no such record" rather than a failed lookup. */
const DNS_ABSENT = new Set(["ENODATA", "ENOTFOUND"]);

/** Result of {@link findTxtRecords}. */
export interface TxtLookup {
  /** Matching records, with multi-string records joined. */
  records: string[];
  /** Error code if the lookup itself failed (e.g. ESERVFAIL); null if it worked. */
  error: string | null;
}

/**
 * Look up TXT records at `name` and keep those matching `pattern`. A missing
 * name or record isn't an error; a failed lookup (timeout, SERVFAIL) is, so
 * callers can tell "no SPF record" from "couldn't check".
 */
export async function findTxtRecords(name: string, pattern: RegExp): Promise<TxtLookup> {
  try {
    const txt = await dns.resolveTxt(name);
    return { records: txt.map((r) => r.join("")).filter((r) => pattern.test(r)), error: null };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code && DNS_ABSENT.has(code)) return { records: [], error: null };
    return { records: [], error: code ?? (err instanceof Error ? err.message : String(err)) };
  }
}
