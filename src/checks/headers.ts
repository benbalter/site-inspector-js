import type { EndpointData, CheckResult } from "../types.js";
import type { Check } from "./check.js";

/** The policy token of a structured header like `same-origin; report-to="x"`. */
function policyToken(value: string | null): string {
  return value?.split(";")[0].trim().toLowerCase() ?? "";
}

export class HeadersCheck implements Check {
  name = "headers";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const h = endpoint.headers;

    const server = h["server"] ?? null;
    const poweredBy = h["x-powered-by"] ?? null;
    const contentSecurityPolicy = h["content-security-policy"] ?? null;
    const xFrameOptions = h["x-frame-options"] ?? null;
    const xContentTypeOptions = h["x-content-type-options"] ?? null;
    const xXssProtection = h["x-xss-protection"] ?? null;
    const referrerPolicy = h["referrer-policy"] ?? null;
    const permissionsPolicy = h["permissions-policy"] ?? null;
    const strictTransportSecurity = h["strict-transport-security"] ?? null;
    const crossOriginOpenerPolicy = h["cross-origin-opener-policy"] ?? null;
    const crossOriginEmbedderPolicy = h["cross-origin-embedder-policy"] ?? null;
    const crossOriginResourcePolicy = h["cross-origin-resource-policy"] ?? null;

    const clickjackingProtection = xFrameOptions !== null;
    const xssValue = xXssProtection?.trim().toLowerCase() ?? "";
    const xssProtection = xssValue === "1" || xssValue === "1; mode=block";

    // Same rules as MDN HTTP Observatory's COOP test: either same-origin value
    // stops cross-origin windows from holding a reference to this one.
    const coop = policyToken(crossOriginOpenerPolicy);
    const openerIsolation = coop === "same-origin" || coop === "same-origin-allow-popups";
    // What browsers require before they set `crossOriginIsolated`.
    const coep = policyToken(crossOriginEmbedderPolicy);
    const crossOriginIsolated =
      coop === "same-origin" && (coep === "require-corp" || coep === "credentialless");

    return {
      name: this.name,
      data: {
        server,
        poweredBy,
        contentSecurityPolicy,
        xFrameOptions,
        xContentTypeOptions,
        xXssProtection,
        referrerPolicy,
        permissionsPolicy,
        strictTransportSecurity,
        crossOriginOpenerPolicy,
        crossOriginEmbedderPolicy,
        crossOriginResourcePolicy,
        clickjackingProtection,
        xssProtection,
        openerIsolation,
        crossOriginIsolated,
      },
    };
  }
}
