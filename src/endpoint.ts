import type { EndpointData, EndpointInfo } from "./types.js";
import { USER_AGENT, errorMessage, headersToRecord, readBody } from "./utils.js";

/** Redirects beyond this many hops are treated as an error. */
export const MAX_REDIRECTS = 10;

export const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Hostname without a leading `www.`, for comparing apex and www variants. */
function siteHost(hostname: string): string {
  return hostname.replace(/^www\./, "");
}

/**
 * Represents a single endpoint (scheme + host combination).
 * Fetches the URL and exposes response data for checks.
 */
export class Endpoint {
  readonly url: string;
  private timeoutMs: number;
  private _pending: Promise<EndpointData> | null = null;
  private _info: EndpointInfo | null = null;

  constructor(url: string, timeoutMs = 10_000) {
    this.url = url;
    this.timeoutMs = timeoutMs;
  }

  /** Fetch the endpoint. Concurrent and repeated calls share one request. */
  fetch(): Promise<EndpointData> {
    this._pending ??= this.doFetch();
    return this._pending;
  }

  /**
   * Follow redirects by hand so every hop is recorded. The timeout covers the
   * whole chain, including reading the final body.
   */
  private async doFetch(): Promise<EndpointData> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    const start = Date.now();
    const redirectChain: string[] = [];
    let current = this.url;

    try {
      for (let hop = 0; ; hop++) {
        const res = await fetch(current, {
          signal,
          redirect: "manual",
          headers: { "User-Agent": USER_AGENT },
        });
        const location = res.headers.get("location");

        if (REDIRECT_STATUSES.has(res.status) && location) {
          await res.body?.cancel();
          if (hop >= MAX_REDIRECTS) {
            throw new Error(`Too many redirects (more than ${MAX_REDIRECTS})`);
          }
          current = new URL(location, current).href;
          redirectChain.push(current);
          continue;
        }

        const data: EndpointData = {
          url: this.url,
          finalUrl: current,
          statusCode: res.status,
          headers: headersToRecord(res.headers),
          setCookies: res.headers.getSetCookie(),
          body: await readBody(res),
          redirectChain,
          responseTimeMs: Date.now() - start,
        };
        const redirected = redirectChain.length > 0;
        this._info = {
          url: this.url,
          up: true,
          statusCode: res.status,
          redirect: redirected,
          redirectTarget: redirected ? current : undefined,
        };
        return data;
      }
    } catch (err) {
      const message = errorMessage(err);
      this._info = { url: this.url, up: false, redirect: false, error: message };
      return {
        url: this.url,
        finalUrl: this.url,
        statusCode: 0,
        headers: {},
        setCookies: [],
        body: "",
        redirectChain: [],
        error: message,
      };
    }
  }

  /** Get endpoint info (must call fetch() first). */
  get info(): EndpointInfo {
    if (!this._info) {
      return { url: this.url, up: false, redirect: false, error: "Not fetched yet" };
    }
    return this._info;
  }

  /** Whether this endpoint returned an HTTP response. */
  get isUp(): boolean {
    return this._info?.up ?? false;
  }

  /** Whether the endpoint's response was a redirect. */
  get isRedirect(): boolean {
    return this._info?.redirect ?? false;
  }

  /** The final URL after redirects, if any. */
  get redirectTarget(): string | undefined {
    return this._info?.redirectTarget;
  }

  /** Whether the final response was a server error (5xx). */
  get isServerError(): boolean {
    const status = this._info?.statusCode;
    return status !== undefined && status >= 500;
  }

  /**
   * Whether this endpoint redirects to a different site. Moving between the
   * apex and www variants of the same domain doesn't count.
   */
  get isExternalRedirect(): boolean {
    if (!this.redirectTarget) return false;
    try {
      const orig = new URL(this.url);
      const target = new URL(this.redirectTarget);
      return siteHost(orig.hostname) !== siteHost(target.hostname);
    } catch {
      return false;
    }
  }
}
