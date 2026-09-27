import type { InspectOptions, InspectionResult } from "./types.js";
import { Domain } from "./domain.js";
import { assertKnownChecks, runChecks } from "./checks/index.js";

export type {
  InspectOptions,
  InspectionResult,
  CheckResult,
  EndpointData,
  EndpointInfo,
  DomainProperties,
} from "./types.js";
export { availableChecks, runChecks, DEFAULT_CHECK_TIMEOUT } from "./checks/index.js";
export type { Check, CheckContext, RunChecksOptions } from "./checks/index.js";
export { assess, assessField, titleCase, PROPERTY_LABELS } from "./assess.js";
export type { Severity, Finding, Assessment } from "./assess.js";
export { Domain } from "./domain.js";
export { Endpoint } from "./endpoint.js";
export { normalizeDomain, USER_AGENT, VERSION } from "./utils.js";

/**
 * Inspect a domain and return a comprehensive report.
 *
 * @param domainInput - The domain to inspect (e.g., "example.com").
 * @param options - Inspection options.
 * @returns The full inspection result.
 * @throws If `options.checks` names a check that doesn't exist.
 *
 * @example
 * ```typescript
 * import { inspect } from "site-inspector";
 *
 * const result = await inspect("example.com");
 * console.log(result.properties.https); // true
 * console.log(result.checks.headers.data.server); // "nginx"
 * ```
 */
export async function inspect(
  domainInput: string,
  options: InspectOptions = {},
): Promise<InspectionResult> {
  const { timeout = 10_000, checkTimeout, checks: checkFilter, allEndpoints = false } = options;

  // Fail fast on bad input, before any network requests.
  if (checkFilter) assertKnownChecks(checkFilter);

  const domain = new Domain(domainInput, timeout);
  await domain.resolve();

  const canonical = domain.canonicalEndpoint;
  if (!domain.properties.up) {
    return {
      domain: domain.domain,
      canonicalUrl: "",
      properties: domain.properties,
      checks: {},
      // Always include endpoints for a down domain: their errors explain why.
      endpoints: domain.endpoints,
      inspectedAt: new Date().toISOString(),
    };
  }

  const endpointData = await canonical.fetch();
  const checkResults = await runChecks(endpointData, domain.domain, checkFilter, {
    timeoutMs: timeout,
    checkTimeoutMs: checkTimeout,
  });

  return {
    domain: domain.domain,
    canonicalUrl: canonical.url,
    properties: domain.properties,
    checks: checkResults,
    endpoints: allEndpoints ? domain.endpoints : undefined,
    inspectedAt: new Date().toISOString(),
  };
}
