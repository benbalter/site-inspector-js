import type { EndpointData, CheckResult } from "../types.js";

/** Per-run context passed to every check. */
export interface CheckContext {
  /** The request timeout the caller asked for, in milliseconds. */
  timeoutMs: number;
  /** Aborted when the check exceeds its time budget. */
  signal: AbortSignal;
  /** Whether checks that can take a screenshot should include it (as a data URI). */
  screenshot?: boolean;
}

/** Interface that all checks must implement. */
export interface Check {
  /** Unique name for this check (e.g. "dns", "headers"). */
  name: string;
  /**
   * Whether the check is slow and resource-hungry (launches Chrome or jsdom),
   * or connects outside `fetch()` to hosts other than the inspected domain
   * (like mail servers). Heavy checks run one at a time, after the others
   * finish, and the public web UI doesn't run them.
   */
  heavy?: boolean;
  /**
   * Run the check against the endpoint data and return results. `runChecks`
   * always passes a context; direct callers may omit it.
   */
  run(endpoint: EndpointData, domain: string, ctx?: CheckContext): Promise<CheckResult>;
}
