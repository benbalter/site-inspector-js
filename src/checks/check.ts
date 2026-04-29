import type { EndpointData, CheckResult } from "../types.js";

/** Interface that all checks must implement. */
export interface Check {
  /** Unique name for this check (e.g. "dns", "headers"). */
  name: string;
  /** Run the check against the endpoint data and return results. */
  run(endpoint: EndpointData, domain: string): Promise<CheckResult>;
}
