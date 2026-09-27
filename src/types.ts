/** Options for an inspection run. */
export interface InspectOptions {
  /** Request timeout in milliseconds. */
  timeout?: number;
  /** Maximum time any single check may run, in ms (default 60s, or 180s for heavy checks). */
  checkTimeout?: number;
  /** Which checks to run (default: all). */
  checks?: string[];
  /**
   * Whether to include per-endpoint details in the result. All 4 endpoints
   * are always probed, since the domain properties are derived from them.
   */
  allEndpoints?: boolean;
}

/** The full result of inspecting a domain. */
export interface InspectionResult {
  domain: string;
  canonicalUrl: string;
  /** Domain-level properties. */
  properties: DomainProperties;
  /** Check results keyed by check name. */
  checks: Record<string, CheckResult>;
  /** Per-endpoint results: included when allEndpoints is set, or when the domain is down. */
  endpoints?: EndpointInfo[];
  /** ISO timestamp of inspection. */
  inspectedAt: string;
}

/** Domain-level properties derived from probing endpoints. */
export interface DomainProperties {
  up: boolean;
  www: boolean;
  root: boolean;
  https: boolean;
  enforcesHttps: boolean;
  downgradesHttps: boolean;
  canonicallyWww: boolean;
  canonicallyHttps: boolean;
  /** The canonical endpoint responded with a 5xx status. */
  serverError: boolean;
  redirect: boolean;
  redirectTarget?: string;
}

/** Information about a single endpoint (scheme + host combination). */
export interface EndpointInfo {
  url: string;
  /** The endpoint returned an HTTP response (of any status). */
  up: boolean;
  /** Status of the final response, after following redirects. */
  statusCode?: number;
  /** The endpoint's own response was a redirect. */
  redirect: boolean;
  /** Final URL after following all redirects. */
  redirectTarget?: string;
  error?: string;
}

/** The response data available to checks. */
export interface EndpointData {
  /** The URL that was requested. */
  url: string;
  /** The URL of the final response, after following redirects. */
  finalUrl: string;
  statusCode: number;
  /** Headers of the final response, lowercase-keyed. */
  headers: Record<string, string>;
  /** Each `Set-Cookie` header of the final response, separately. */
  setCookies: string[];
  /** Body of the final response (truncated at 5 MB). */
  body: string;
  /** Every URL redirected to, in order; the last entry is `finalUrl`. */
  redirectChain: string[];
  /** Wall-clock time to fetch the endpoint, including redirects, in ms. */
  responseTimeMs?: number;
  error?: string;
}

/** Result returned by a single check. */
export interface CheckResult {
  /** Machine-readable check name (e.g. "dns", "headers"). */
  name: string;
  /** Structured data specific to the check. */
  data: Record<string, unknown>;
}
