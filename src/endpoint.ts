import type { EndpointData, EndpointInfo } from "./types.js";
import { fetchWithTimeout } from "./utils.js";

/**
 * Represents a single endpoint (scheme + host combination).
 * Fetches the URL and exposes response data for checks.
 */
export class Endpoint {
  readonly url: string;
  private timeoutMs: number;
  private _data: EndpointData | null = null;
  private _info: EndpointInfo | null = null;

  constructor(url: string, timeoutMs = 10_000) {
    this.url = url;
    this.timeoutMs = timeoutMs;
  }

  /** Fetch the endpoint and cache results. */
  async fetch(): Promise<EndpointData> {
    if (this._data) return this._data;

    try {
      const res = await fetchWithTimeout(this.url, this.timeoutMs);
      const redirectChain: string[] = [];
      if (res.redirected && res.finalUrl !== this.url) {
        redirectChain.push(res.finalUrl);
      }

      this._data = {
        url: this.url,
        statusCode: res.statusCode,
        headers: res.headers,
        body: res.body,
        redirectChain,
      };

      this._info = {
        url: this.url,
        up: true,
        statusCode: res.statusCode,
        redirect: res.redirected,
        redirectTarget: res.redirected ? res.finalUrl : undefined,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._data = {
        url: this.url,
        statusCode: 0,
        headers: {},
        body: "",
        redirectChain: [],
        error: message,
      };
      this._info = {
        url: this.url,
        up: false,
        redirect: false,
        error: message,
      };
    }

    return this._data;
  }

  /** Get endpoint info (must call fetch() first). */
  get info(): EndpointInfo {
    if (!this._info) {
      return { url: this.url, up: false, redirect: false, error: "Not fetched yet" };
    }
    return this._info;
  }

  /** Whether this endpoint responded successfully. */
  get isUp(): boolean {
    return this._info?.up ?? false;
  }

  /** Whether the response was a redirect. */
  get isRedirect(): boolean {
    return this._info?.redirect ?? false;
  }

  /** The final URL after redirects, if any. */
  get redirectTarget(): string | undefined {
    return this._info?.redirectTarget;
  }

  /** Whether this endpoint redirects to an external domain. */
  get isExternalRedirect(): boolean {
    if (!this.redirectTarget) return false;
    try {
      const orig = new URL(this.url);
      const target = new URL(this.redirectTarget);
      return orig.hostname !== target.hostname;
    } catch {
      return false;
    }
  }
}
