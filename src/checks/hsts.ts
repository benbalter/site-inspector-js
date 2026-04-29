import type { EndpointData, CheckResult } from "../types.js";
import type { Check } from "./check.js";

export class HstsCheck implements Check {
  name = "hsts";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const raw = endpoint.headers["strict-transport-security"] ?? null;

    if (!raw) {
      return {
        name: this.name,
        data: {
          enabled: false,
          maxAge: null,
          includeSubDomains: false,
          preload: false,
          preloadReady: false,
          rawHeader: null,
        },
      };
    }

    const directives = raw.split(";").map((d) => d.trim().toLowerCase());

    let maxAge: number | null = null;
    let includeSubDomains = false;
    let preload = false;

    for (const directive of directives) {
      if (directive.startsWith("max-age=")) {
        const parsed = Number(directive.slice("max-age=".length));
        if (!Number.isNaN(parsed)) {
          maxAge = parsed;
        }
      } else if (directive === "includesubdomains") {
        includeSubDomains = true;
      } else if (directive === "preload") {
        preload = true;
      }
    }

    const preloadReady =
      maxAge !== null && maxAge >= 31536000 && includeSubDomains && preload;

    return {
      name: this.name,
      data: {
        enabled: true,
        maxAge,
        includeSubDomains,
        preload,
        preloadReady,
        rawHeader: raw,
      },
    };
  }
}
