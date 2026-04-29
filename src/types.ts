/** Options for an inspection run. */
export interface InspectOptions {
  /** Request timeout in milliseconds. */
  timeout?: number;
  /** Which checks to run (default: all). */
  checks?: string[];
  /** Whether to inspect all 4 endpoints or just the canonical one. */
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
  /** When allEndpoints is true, results for each endpoint. */
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
  redirect: boolean;
  redirectTarget?: string;
}

/** Information about a single endpoint (scheme + host combination). */
export interface EndpointInfo {
  url: string;
  up: boolean;
  statusCode?: number;
  redirect: boolean;
  redirectTarget?: string;
  error?: string;
}

/** The response data available to checks. */
export interface EndpointData {
  url: string;
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  redirectChain: string[];
  error?: string;
}

/** Result returned by a single check. */
export interface CheckResult {
  /** Machine-readable check name (e.g. "dns", "headers"). */
  name: string;
  /** Structured data specific to the check. */
  data: Record<string, unknown>;
}
