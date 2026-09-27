import type { InspectOptions, InspectionResult } from "./types.js";
import { Domain } from "./domain.js";
import { assertKnownChecks, availableChecks, runChecks } from "./checks/index.js";

export type {
  InspectOptions,
  InspectionResult,
  CheckResult,
  EndpointData,
  EndpointInfo,
  DomainProperties,
  InspectionProgress,
} from "./types.js";
export { availableChecks, runChecks, DEFAULT_CHECK_TIMEOUT } from "./checks/index.js";
export type { Check, CheckContext, RunChecksOptions } from "./checks/index.js";
export {
  assess,
  assessField,
  severityOf,
  DUPLICATE_OF,
  CHECK_CATEGORIES,
  CHECK_LABELS,
  checkLabel,
  titleCase,
  fieldLabel,
  formatFieldValue,
  FIELD_UNITS,
  PROPERTY_LABELS,
} from "./assess.js";
export type { Severity, Finding, Insight, Assessment, CheckCategory, Unit } from "./assess.js";
export { Domain } from "./domain.js";
export { Endpoint } from "./endpoint.js";
export { normalizeDomain, USER_AGENT, VERSION } from "./utils.js";
export { isPublicAddress, resolvePublic } from "./network.js";

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
  const {
    timeout = 10_000,
    checkTimeout,
    checks: checkFilter,
    allEndpoints = false,
    onProgress,
  } = options;

  // Fail fast on bad input, before any network requests.
  if (checkFilter) assertKnownChecks(checkFilter);

  const domain = new Domain(domainInput, timeout);
  await domain.resolve();

  const canonical = domain.canonicalEndpoint;
  const up = domain.properties.up;
  try {
    onProgress?.({
      type: "resolved",
      domain: domain.domain,
      canonicalUrl: up ? canonical.url : "",
      properties: domain.properties,
      checks: up ? (checkFilter ?? availableChecks()) : [],
    });
  } catch {
    // A broken progress listener must not break the inspection.
  }

  if (!up) {
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
    onProgress,
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
