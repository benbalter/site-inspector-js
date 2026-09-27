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

    // If several headers were comma-joined, only the first counts (RFC 6797 §8.1).
    const first = raw.split(",")[0];
    const directives = first.split(";").map((d) => d.trim().toLowerCase());

    let maxAge: number | null = null;
    let includeSubDomains = false;
    let preload = false;

    for (const directive of directives) {
      const maxAgeMatch = /^max-age\s*=\s*"?(\d+)"?$/.exec(directive);
      if (maxAgeMatch) {
        maxAge = Number(maxAgeMatch[1]);
      } else if (directive === "includesubdomains") {
        includeSubDomains = true;
      } else if (directive === "preload") {
        preload = true;
      }
    }

    const preloadReady = maxAge !== null && maxAge >= 31536000 && includeSubDomains && preload;

    return {
      name: this.name,
      data: {
        // Without a positive max-age, browsers don't apply HSTS.
        enabled: maxAge !== null && maxAge > 0,
        maxAge,
        includeSubDomains,
        preload,
        preloadReady,
        rawHeader: raw,
      },
    };
  }
}
