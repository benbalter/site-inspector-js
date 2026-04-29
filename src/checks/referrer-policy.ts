import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

const STRICTNESS: Record<string, "strict" | "moderate" | "loose"> = {
  "no-referrer": "strict",
  "same-origin": "strict",
  "strict-origin": "strict",
  "strict-origin-when-cross-origin": "moderate",
  "origin": "moderate",
  "origin-when-cross-origin": "moderate",
  "no-referrer-when-downgrade": "loose",
  "unsafe-url": "loose",
};

export class ReferrerPolicyCheck implements Check {
  name = "referrer-policy";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const raw = endpoint.headers["referrer-policy"] ?? null;
    // Referrer-Policy can contain comma-separated fallback values; use the last valid one
    let policy: string | null = null;
    let strictness: "strict" | "moderate" | "loose" | "none" = "none";

    if (raw) {
      const policies = raw
        .split(",")
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean);
      // Browser uses last recognized value
      for (const p of policies) {
        if (p in STRICTNESS) {
          policy = p;
          strictness = STRICTNESS[p];
        }
      }
      if (!policy && policies.length > 0) {
        policy = policies[policies.length - 1];
      }
    }

    const recommended = "strict-origin-when-cross-origin";

    return {
      name: this.name,
      data: {
        present: raw !== null,
        policy,
        strictness,
        recommended,
        rawHeader: raw,
      },
    };
  }
}
