import type { InspectOptions, InspectionResult } from "./types.js";
import { Domain } from "./domain.js";
import { runChecks } from "./checks/index.js";

export type { InspectOptions, InspectionResult, CheckResult, EndpointData, EndpointInfo, DomainProperties } from "./types.js";
export { availableChecks } from "./checks/index.js";
export { Domain } from "./domain.js";
export { Endpoint } from "./endpoint.js";

/**
 * Inspect a domain and return a comprehensive report.
 *
 * @param domainInput - The domain to inspect (e.g., "example.com").
 * @param options - Inspection options.
 * @returns The full inspection result.
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
  const { timeout = 10_000, checks: checkFilter, allEndpoints = false } = options;

  const domain = new Domain(domainInput, timeout);
  await domain.resolve();

  const canonical = domain.canonicalEndpoint;
  if (!domain.properties.up) {
    return {
      domain: domain.domain,
      canonicalUrl: "",
      properties: domain.properties,
      checks: {},
      endpoints: allEndpoints ? domain.endpoints : undefined,
      inspectedAt: new Date().toISOString(),
    };
  }

  const endpointData = await canonical.fetch();
  const checkResults = await runChecks(endpointData, domain.domain, checkFilter);

  return {
    domain: domain.domain,
    canonicalUrl: canonical.url,
    properties: domain.properties,
    checks: checkResults,
    endpoints: allEndpoints ? domain.endpoints : undefined,
    inspectedAt: new Date().toISOString(),
  };
}
