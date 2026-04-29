import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

export class CorsCheck implements Check {
  name = "cors";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const headers = endpoint.headers;
    const allowOrigin = headers["access-control-allow-origin"] ?? null;
    const allowCredentials =
      headers["access-control-allow-credentials"]?.toLowerCase() === "true";
    const allowMethods =
      headers["access-control-allow-methods"]
        ?.split(",")
        .map((m) => m.trim())
        .filter(Boolean) ?? [];
    const allowHeaders =
      headers["access-control-allow-headers"]
        ?.split(",")
        .map((h) => h.trim())
        .filter(Boolean) ?? [];
    const exposeHeaders =
      headers["access-control-expose-headers"]
        ?.split(",")
        .map((h) => h.trim())
        .filter(Boolean) ?? [];
    const maxAge = headers["access-control-max-age"]
      ? Number(headers["access-control-max-age"])
      : null;

    const wildcard = allowOrigin === "*";
    const enabled = allowOrigin !== null;
    // Misconfigured: wildcard origin with credentials is a security issue
    const misconfigured = wildcard && allowCredentials;

    return {
      name: this.name,
      data: {
        enabled,
        allowOrigin,
        allowCredentials,
        allowMethods,
        allowHeaders,
        exposeHeaders,
        maxAge,
        wildcard,
        misconfigured,
      },
    };
  }
}
