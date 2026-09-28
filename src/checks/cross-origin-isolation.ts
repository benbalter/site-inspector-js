import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { Token, parseItem } from "structured-headers";

const COOP_VALUES = new Set([
  "unsafe-none",
  "same-origin-allow-popups",
  "same-origin",
  "noopener-allow-popups",
]);
const COEP_VALUES = new Set(["unsafe-none", "require-corp", "credentialless"]);
const CORP_VALUES = new Set(["same-site", "same-origin", "cross-origin"]);

/**
 * Read the token of a structured-field item such as `same-origin; report-to="x"`,
 * dropping its parameters. Returns null for anything that isn't one known
 * token (a duplicated, comma-joined header is invalid, so browsers ignore it).
 */
function parseDirective(raw: string | null, allowed: Set<string>): string | null {
  if (raw === null) return null;
  try {
    const [value] = parseItem(raw);
    if (!(value instanceof Token)) return null;
    const token = value.toString();
    return allowed.has(token) ? token : null;
  } catch {
    return null;
  }
}

export class CrossOriginIsolationCheck implements Check {
  name = "cross-origin-isolation";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const h = endpoint.headers;
    const coopRaw = h["cross-origin-opener-policy"] ?? null;
    const coepRaw = h["cross-origin-embedder-policy"] ?? null;
    const corpRaw = h["cross-origin-resource-policy"] ?? null;
    const coopReportOnlyRaw = h["cross-origin-opener-policy-report-only"] ?? null;
    const coepReportOnlyRaw = h["cross-origin-embedder-policy-report-only"] ?? null;

    const coop = parseDirective(coopRaw, COOP_VALUES);
    const coep = parseDirective(coepRaw, COEP_VALUES);
    const corp = parseDirective(corpRaw, CORP_VALUES);

    return {
      name: this.name,
      data: {
        coopPresent: coopRaw !== null,
        coop,
        coopRaw,
        coepPresent: coepRaw !== null,
        coep,
        coepRaw,
        corpPresent: corpRaw !== null,
        corp,
        corpRaw,
        coopReportOnlyPresent: coopReportOnlyRaw !== null,
        coopReportOnly: parseDirective(coopReportOnlyRaw, COOP_VALUES),
        coepReportOnlyPresent: coepReportOnlyRaw !== null,
        coepReportOnly: parseDirective(coepReportOnlyRaw, COEP_VALUES),
        // Browsers ignore COOP and COEP outside secure contexts.
        isolated:
          new URL(endpoint.finalUrl || endpoint.url).protocol === "https:" &&
          coop === "same-origin" &&
          (coep === "require-corp" || coep === "credentialless"),
      },
    };
  }
}
