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

  private _resolving: Promise<void> | null = null;
  private _resolved = false;
  private _properties: { props: DomainProperties; canonical: Endpoint } | null = null;

  constructor(domain: string, timeoutMs = 10_000) {
    this.domain = normalizeDomain(domain);
    this.timeoutMs = timeoutMs;

    const d = this.domain;
    this.httpsRoot = new Endpoint(`https://${d}`, this.timeoutMs);
    this.httpsWww = new Endpoint(`https://www.${d}`, this.timeoutMs);
    this.httpRoot = new Endpoint(`http://${d}`, this.timeoutMs);
    this.httpWww = new Endpoint(`http://www.${d}`, this.timeoutMs);
  }

  /** Fetch all 4 endpoints in parallel. Concurrent calls share one run. */
  resolve(): Promise<void> {
    this._resolving ??= Promise.allSettled([
      this.httpsRoot.fetch(),
      this.httpsWww.fetch(),
      this.httpRoot.fetch(),
      this.httpWww.fetch(),
    ]).then(() => {
      this._resolved = true;
    });
    return this._resolving;
  }

  /** The canonical (best) endpoint: prefer https over http, www if canonicallyWww. */
  get canonicalEndpoint(): Endpoint {
    return this.compute().canonical;
  }

  /** Domain-level properties derived from endpoint probing. */
  get properties(): DomainProperties {
    return this.compute().props;
  }

  /** Compute properties once the endpoints have resolved, then memoize them. */
  private compute(): { props: DomainProperties; canonical: Endpoint } {
    if (this._properties) return this._properties;
    const result = this.computeProperties();
    // Before resolve() finishes the endpoints are still empty, so don't cache.
    if (this._resolved) this._properties = result;
    return result;
  }

  private computeProperties(): { props: DomainProperties; canonical: Endpoint } {
    const httpsRootUp = this.httpsRoot.isUp;
    const httpsWwwUp = this.httpsWww.isUp;
    const httpRootUp = this.httpRoot.isUp;
    const httpWwwUp = this.httpWww.isUp;

    const up = httpsRootUp || httpsWwwUp || httpRootUp || httpWwwUp;
    const www = httpsWwwUp || httpWwwUp;
    const root = httpsRootUp || httpRootUp;
    const https = httpsRootUp || httpsWwwUp;

    // HTTP endpoints redirect to HTTPS or are down
    const httpRootEnforces = !httpRootUp || redirectsToProtocol(this.httpRoot, "https:");
    const httpWwwEnforces = !httpWwwUp || redirectsToProtocol(this.httpWww, "https:");
    const enforcesHttps = https && httpRootEnforces && httpWwwEnforces;

    // Non-www redirects to www, or all non-www endpoints are down
    const canonicallyWww =
      www && !root
        ? true
        : www && root
          ? this.redirectsToWww(this.httpsRoot) || this.redirectsToWww(this.httpRoot)
          : false;

    // HTTP redirects to HTTPS, or all HTTP endpoints are down
    const canonicallyHttps =
      https && !httpRootUp && !httpWwwUp
        ? true
        : https && (httpRootUp || httpWwwUp)
          ? httpRootEnforces && httpWwwEnforces
          : false;

    let canonical: Endpoint;
    if (https && canonicallyWww) canonical = this.httpsWww;
    else if (https) canonical = this.httpsRoot;
    else if (canonicallyWww) canonical = this.httpWww;
    else canonical = this.httpRoot;

    // The canonical HTTPS endpoint redirects back to HTTP
    const downgradesHttps = https && redirectsToProtocol(canonical, "http:");

    const redirect = canonical.isExternalRedirect;
    const redirectTarget = redirect ? canonical.redirectTarget : undefined;

    return {
      canonical,
      props: {
        up,
        www,
        root,
        https,
        enforcesHttps,
        downgradesHttps,
        canonicallyWww,
        canonicallyHttps,
        serverError: up && canonical.isServerError,
        redirect,
        redirectTarget,
      },
    };
  }

  /** Whether `ep` redirects to exactly the www variant of this domain. */
  private redirectsToWww(ep: Endpoint): boolean {
    const target = ep.redirectTarget;
    if (!ep.isRedirect || !target) return false;
    try {
      return new URL(target).hostname === `www.${this.domain}`;
    } catch {
      return false;
    }
  }

  /** EndpointInfo for all 4 endpoints. */
  get endpoints(): EndpointInfo[] {
    return [this.httpsRoot.info, this.httpsWww.info, this.httpRoot.info, this.httpWww.info];
  }
}

/** Whether `ep` redirects, ending up on the given protocol ("https:" or "http:"). */
function redirectsToProtocol(ep: Endpoint, protocol: string): boolean {
  const target = ep.redirectTarget;
  if (!ep.isRedirect || !target) return false;
  try {
    return new URL(target).protocol === protocol;
  } catch {
    return false;
  }
}
