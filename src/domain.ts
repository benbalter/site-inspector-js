import { Endpoint } from "./endpoint.js";
import type { DomainProperties, EndpointInfo } from "./types.js";
import { normalizeDomain } from "./utils.js";

/**
 * Represents a domain being inspected.
 * Probes 4 endpoints (http/https × www/non-www) and derives domain-level properties.
 */
export class Domain {
  readonly domain: string;
  private timeoutMs: number;

  private httpsRoot: Endpoint;
  private httpsWww: Endpoint;
  private httpRoot: Endpoint;
  private httpWww: Endpoint;

  private _resolved = false;

  constructor(domain: string, timeoutMs = 10_000) {
    this.domain = normalizeDomain(domain);
    this.timeoutMs = timeoutMs;

    const d = this.domain;
    this.httpsRoot = new Endpoint(`https://${d}`, this.timeoutMs);
    this.httpsWww = new Endpoint(`https://www.${d}`, this.timeoutMs);
    this.httpRoot = new Endpoint(`http://${d}`, this.timeoutMs);
    this.httpWww = new Endpoint(`http://www.${d}`, this.timeoutMs);
  }

  /** Fetch all 4 endpoints in parallel. */
  async resolve(): Promise<void> {
    if (this._resolved) return;

    await Promise.allSettled([
      this.httpsRoot.fetch(),
      this.httpsWww.fetch(),
      this.httpRoot.fetch(),
      this.httpWww.fetch(),
    ]);

    this._resolved = true;
  }

  /** The canonical (best) endpoint: prefer https over http, www if canonicallyWww. */
  get canonicalEndpoint(): Endpoint {
    const { https, canonicallyWww } = this.computeProperties();
    if (https && canonicallyWww) return this.httpsWww;
    if (https) return this.httpsRoot;
    if (canonicallyWww) return this.httpWww;
    return this.httpRoot;
  }

  /** Domain-level properties derived from endpoint probing. */
  get properties(): DomainProperties {
    return this.computeProperties();
  }

  /** Core computation, avoids circular calls between properties and canonicalEndpoint. */
  private computeProperties(): DomainProperties {
    const httpsRootUp = this.httpsRoot.isUp;
    const httpsWwwUp = this.httpsWww.isUp;
    const httpRootUp = this.httpRoot.isUp;
    const httpWwwUp = this.httpWww.isUp;

    const up = httpsRootUp || httpsWwwUp || httpRootUp || httpWwwUp;
    const www = httpsWwwUp || httpWwwUp;
    const root = httpsRootUp || httpRootUp;
    const https = httpsRootUp || httpsWwwUp;

    // HTTP endpoints redirect to HTTPS or are down
    const httpRootEnforces =
      !httpRootUp || (this.httpRoot.isRedirect && redirectsToHttps(this.httpRoot));
    const httpWwwEnforces =
      !httpWwwUp || (this.httpWww.isRedirect && redirectsToHttps(this.httpWww));
    const enforcesHttps = https && httpRootEnforces && httpWwwEnforces;

    // HTTPS canonical endpoint redirects to HTTP
    const canonical = this.canonicalEndpointFor(https, root);
    const downgradesHttps =
      https &&
      canonical !== null &&
      canonical.isRedirect &&
      redirectsToHttp(canonical);

    // Non-www redirects to www, or all non-www endpoints are down
    const canonicallyWww = www && !root
      ? true
      : www && root
        ? redirectsToWww(this.httpsRoot) || redirectsToWww(this.httpRoot)
        : false;

    // HTTP redirects to HTTPS, or all HTTP endpoints are down
    const canonicallyHttps = https && !httpRootUp && !httpWwwUp
      ? true
      : https && (httpRootUp || httpWwwUp)
        ? httpRootEnforces && httpWwwEnforces
        : false;

    // Determine canonical endpoint inline to avoid recursion
    let canonicalEp: Endpoint;
    if (https && canonicallyWww) canonicalEp = this.httpsWww;
    else if (https) canonicalEp = this.httpsRoot;
    else if (canonicallyWww) canonicalEp = this.httpWww;
    else canonicalEp = this.httpRoot;

    const redirect = canonicalEp.isExternalRedirect;
    const redirectTarget = redirect ? canonicalEp.redirectTarget : undefined;

    return {
      up,
      www,
      root,
      https,
      enforcesHttps,
      downgradesHttps,
      canonicallyWww,
      canonicallyHttps,
      redirect,
      redirectTarget,
    };
  }

  /** EndpointInfo for all 4 endpoints. */
  get endpoints(): EndpointInfo[] {
    return [
      this.httpsRoot.info,
      this.httpsWww.info,
      this.httpRoot.info,
      this.httpWww.info,
    ];
  }

  /** Helper to pick the canonical HTTPS endpoint without triggering recursion. */
  private canonicalEndpointFor(https: boolean, root: boolean): Endpoint | null {
    if (!https) return null;
    return root ? this.httpsRoot : this.httpsWww;
  }
}

function redirectsToHttps(ep: Endpoint): boolean {
  const target = ep.redirectTarget;
  if (!target) return false;
  try {
    return new URL(target).protocol === "https:";
  } catch {
    return false;
  }
}

function redirectsToHttp(ep: Endpoint): boolean {
  const target = ep.redirectTarget;
  if (!target) return false;
  try {
    return new URL(target).protocol === "http:";
  } catch {
    return false;
  }
}

function redirectsToWww(ep: Endpoint): boolean {
  const target = ep.redirectTarget;
  if (!target) return false;
  try {
    return new URL(target).hostname.startsWith("www.");
  } catch {
    return false;
  }
}
