import type { EndpointData, CheckResult } from "../types.js";
import type { Check } from "./check.js";

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

    const clickjackingProtection = xFrameOptions !== null;
    const xssValue = xXssProtection?.trim().toLowerCase() ?? "";
    const xssProtection = xssValue === "1" || xssValue === "1; mode=block";

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
        clickjackingProtection,
        xssProtection,
      },
    };
  }
}
