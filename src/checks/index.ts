import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { DnsCheck } from "./dns.js";
import { HeadersCheck } from "./headers.js";
import { HttpsCheck } from "./https.js";
import { HstsCheck } from "./hsts.js";
import { ContentCheck } from "./content.js";
import { CookiesCheck } from "./cookies.js";
import { SnifferCheck } from "./sniffer.js";
import { AccessibilityCheck } from "./accessibility.js";
import { WellKnownCheck } from "./well-known.js";

/** All available checks, keyed by name. */
const ALL_CHECKS: Check[] = [
  new DnsCheck(),
  new HeadersCheck(),
  new HttpsCheck(),
  new HstsCheck(),
  new ContentCheck(),
  new CookiesCheck(),
  new SnifferCheck(),
  new AccessibilityCheck(),
  new WellKnownCheck(),
];

/** Get the list of all available check names. */
export function availableChecks(): string[] {
  return ALL_CHECKS.map((c) => c.name);
}

/**
 * Run selected checks against an endpoint.
 * @param endpoint - The fetched endpoint data.
 * @param domain - The domain being inspected.
 * @param filter - Optional list of check names to run (default: all).
 */
export async function runChecks(
  endpoint: EndpointData,
  domain: string,
  filter?: string[],
): Promise<Record<string, CheckResult>> {
  const checks = filter
    ? ALL_CHECKS.filter((c) => filter.includes(c.name))
    : ALL_CHECKS;

  const results = await Promise.allSettled(checks.map((c) => c.run(endpoint, domain)));

  const output: Record<string, CheckResult> = {};
  for (let i = 0; i < checks.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      output[checks[i].name] = result.value;
    } else {
      output[checks[i].name] = {
        name: checks[i].name,
        data: { error: result.reason instanceof Error ? result.reason.message : String(result.reason) },
      };
    }
  }

  return output;
}

export type { Check };
