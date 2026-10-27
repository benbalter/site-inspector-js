import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { fetchJson } from "../utils.js";

/** Both APIs usually answer in under a second; don't let either hold up a report. */
const LOOKUP_TIMEOUT_MS = 8_000;

/** Tranco's response: daily ranks, newest first, or none if the domain isn't listed. */
interface TrancoRanks {
  ranks?: { date: string; rank: number }[];
}

/** A Wayback timestamp like `20110202130255` as an ISO date. */
function waybackDate(timestamp: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(timestamp);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

/**
 * How long the domain has been around and how popular it is: its first
 * Internet Archive capture and its rank in the Tranco top-sites list.
 */
export class WebPresenceCheck implements Check {
  name = "web-presence";

  async run(_endpoint: EndpointData, domain: string): Promise<CheckResult> {
    const host = encodeURIComponent(domain);
    const [archive, tranco] = await Promise.all([
      // The CDX API returns captures oldest first; one row is the first capture.
      fetchJson(
        `https://web.archive.org/cdx/search/cdx?url=${host}&limit=1&output=json&fl=timestamp`,
        LOOKUP_TIMEOUT_MS,
      ) as Promise<unknown>,
      fetchJson(
        `https://tranco-list.eu/api/ranks/domain/${host}`,
        LOOKUP_TIMEOUT_MS,
      ) as Promise<TrancoRanks | null>,
    ]);

    const archiveRows = Array.isArray(archive) ? (archive as string[][]) : null;
    // The first row is a header naming the fields.
    const firstCapture = archiveRows?.[1]?.[0];
    const latestRank = tranco?.ranks?.[0];

    return {
      name: this.name,
      data: {
        archived: archiveRows ? firstCapture !== undefined : null,
        firstArchived: firstCapture ? waybackDate(firstCapture) : null,
        archiveLookupFailed: archiveRows === null,
        ranked: tranco ? latestRank !== undefined : null,
        trancoRank: latestRank?.rank ?? null,
        trancoRankDate: latestRank?.date ?? null,
        rankLookupFailed: tranco === null,
      },
    };
  }
}
