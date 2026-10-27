import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { parseHtml, probeStatus } from "../utils.js";

/** Most same-site links to check. */
const MAX_INTERNAL = 20;
/** Most external links to check, and at most this many per external host. */
const MAX_EXTERNAL = 10;
const MAX_PER_EXTERNAL_HOST = 2;
/** Requests in flight at once. */
const CONCURRENCY = 6;
const PROBE_TIMEOUT_MS = 5_000;

/**
 * Statuses that mean the page is gone. Anything else, like the 403 or 999
 * many sites send to bots, says more about us than about the link.
 */
const GONE = new Set([404, 410]);

/** Run `fn` over `items`, at most `limit` at a time, keeping order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Pick the links to check: same-site ones first (a broken internal link is
 * the site's own bug), then a few external ones, spread across hosts so one
 * inspection never sends a burst of requests at a single third party.
 */
function selectLinks(hrefs: string[], base: string): { found: number; selected: string[] } {
  const origin = new URL(base).origin;
  const unique = new Set<string>();
  for (const href of hrefs) {
    try {
      const url = new URL(href, base);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      url.hash = "";
      // A link to the page itself, like href="#top".
      if (url.href === new URL(base).href) continue;
      unique.add(url.href);
    } catch {
      // Not a URL.
    }
  }

  const internal: string[] = [];
  const external: string[] = [];
  const perHost = new Map<string, number>();
  for (const href of unique) {
    const url = new URL(href);
    if (url.origin === origin) {
      if (internal.length < MAX_INTERNAL) internal.push(href);
    } else {
      const count = perHost.get(url.host) ?? 0;
      if (external.length < MAX_EXTERNAL && count < MAX_PER_EXTERNAL_HOST) {
        external.push(href);
        perHost.set(url.host, count + 1);
      }
    }
  }
  return { found: unique.size, selected: [...internal, ...external] };
}

/**
 * Whether missing pages return a real 404 (a "soft 404" answers 200, which
 * search engines and monitoring tools can't tell from a real page), and
 * whether the homepage links to pages that are gone.
 */
export class LinksCheck implements Check {
  name = "links";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const base = endpoint.finalUrl;
    const $ = parseHtml(endpoint);
    const hrefs = $("a[href]")
      .map((_i, el) => $(el).attr("href") ?? "")
      .get();
    const { found, selected } = selectLinks(hrefs, base);

    const random = Math.random().toString(36).slice(2);
    const missingPage = new URL(`/site-inspector-404-check-${random}`, base).href;

    const [notFoundStatus, statuses] = await Promise.all([
      probeStatus(missingPage, "GET", PROBE_TIMEOUT_MS),
      mapLimit(selected, CONCURRENCY, async (url) => {
        const status = await probeStatus(url, "HEAD", PROBE_TIMEOUT_MS);
        // Some servers mishandle HEAD; only a GET can confirm a page is gone.
        return status !== null && GONE.has(status)
          ? probeStatus(url, "GET", PROBE_TIMEOUT_MS)
          : status;
      }),
    ]);

    const brokenLinks = selected
      .map((url, i) => ({ url, status: statuses[i] }))
      .filter(
        (link): link is { url: string; status: number } =>
          link.status !== null && GONE.has(link.status),
      );

    return {
      name: this.name,
      data: {
        notFoundStatus,
        soft404: notFoundStatus === null ? null : notFoundStatus === 200,
        linksFound: found,
        linksChecked: selected.length,
        brokenLinks,
        hasBrokenLinks: brokenLinks.length > 0,
      },
    };
  }
}
