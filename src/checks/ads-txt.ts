import type { Check, CheckContext } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { isCatchAll, safeFetch, type FetchResult } from "../utils.js";

const HTML_LIKE = /<\s*(!doctype|html|head|body)\b/i;

/** Summary of an ads.txt or app-ads.txt file (IAB Tech Lab ads.txt 1.1). */
export interface AdsTxtSummary {
  /** Whether the file is served; null if the request failed. */
  present: boolean | null;
  recordCount: number;
  directCount: number;
  resellerCount: number;
  invalidLines: number;
  ownerDomain: string | null;
  managerDomains: string[];
  contacts: string[];
  subdomains: string[];
}

function emptySummary(present: boolean | null): AdsTxtSummary {
  return {
    present,
    recordCount: 0,
    directCount: 0,
    resellerCount: 0,
    invalidLines: 0,
    ownerDomain: null,
    managerDomains: [],
    contacts: [],
    subdomains: [],
  };
}

/** Parse an ads.txt body per the IAB ads.txt 1.1 specification. */
export function parseAdsTxt(body: string): Omit<AdsTxtSummary, "present"> {
  const out = emptySummary(null);
  for (const rawLine of body.split(/\r?\n/)) {
    // Comments run from "#" to end of line; ";" starts extension fields.
    const line = rawLine.split("#")[0].split(";")[0].trim();
    if (!line) continue;

    const variable = /^([a-z]+)\s*=\s*(.*)$/i.exec(line);
    if (variable && !line.slice(0, line.indexOf("=")).includes(",")) {
      const value = variable[2].trim();
      switch (variable[1].toLowerCase()) {
        case "ownerdomain":
          out.ownerDomain = value.toLowerCase();
          break;
        case "managerdomain":
          out.managerDomains.push(value.toLowerCase());
          break;
        case "contact":
          out.contacts.push(value);
          break;
        case "subdomain":
          out.subdomains.push(value.toLowerCase());
          break;
        // inventorypartnerdomain and unknown variables are valid but unused.
      }
      continue;
    }

    const fields = line.split(",").map((f) => f.trim());
    const relationship = fields[2]?.toUpperCase();
    if (
      fields.length < 3 ||
      fields.length > 4 ||
      !fields[0] ||
      !fields[1] ||
      (relationship !== "DIRECT" && relationship !== "RESELLER")
    ) {
      out.invalidLines++;
      continue;
    }
    out.recordCount++;
    if (relationship === "DIRECT") out.directCount++;
    else out.resellerCount++;
  }
  const { present: _present, ...rest } = out;
  return rest;
}

function summarize(res: FetchResult | null, catchAll: boolean): AdsTxtSummary {
  if (!res) return emptySummary(null);
  const html =
    /html/i.test(res.headers["content-type"] ?? "") || HTML_LIKE.test(res.body.slice(0, 2048));
  if (res.statusCode !== 200 || html) return emptySummary(false);

  const parsed = parseAdsTxt(res.body);
  const declaresSomething =
    parsed.recordCount > 0 || parsed.ownerDomain !== null || parsed.managerDomains.length > 0;
  // A server that answers every path with 200 proves nothing unless the body
  // actually parses as ads.txt.
  if (catchAll && !declaresSomething) return emptySummary(false);
  return { present: true, ...parsed };
}

export class AdsTxtCheck implements Check {
  name = "ads-txt";

  async run(endpoint: EndpointData, _domain: string, ctx?: CheckContext): Promise<CheckResult> {
    const timeoutMs = ctx?.timeoutMs ?? 5000;
    const origin = new URL(endpoint.finalUrl || endpoint.url).origin;

    const [adsRes, appAdsRes, catchAll] = await Promise.all([
      safeFetch(`${origin}/ads.txt`, timeoutMs),
      safeFetch(`${origin}/app-ads.txt`, timeoutMs),
      isCatchAll(origin, timeoutMs),
    ]);

    return {
      name: this.name,
      data: {
        adsTxt: summarize(adsRes, catchAll),
        appAdsTxt: summarize(appAdsRes, catchAll),
      },
    };
  }
}
