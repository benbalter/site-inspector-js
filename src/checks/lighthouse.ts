import type { Check, CheckContext } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

export class LighthouseCheck implements Check {
  name = "lighthouse";
  heavy = true;

  async run(endpoint: EndpointData, _domain: string, ctx?: CheckContext): Promise<CheckResult> {
    try {
      // Dynamic imports so the check doesn't fail at module load time
      // if lighthouse/chrome-launcher aren't installed
      const { default: lighthouse } = await import("lighthouse");
      const { launch } = await import("chrome-launcher");

      const chrome = await launch({
        chromeFlags: ["--headless", "--no-sandbox", "--disable-gpu"],
      });
      // If the run exceeds its time budget, kill Chrome so it doesn't outlive
      // the check (and keep the process from exiting).
      const killChrome = () => void chrome.kill();
      ctx?.signal.addEventListener("abort", killChrome, { once: true });
      if (ctx?.signal.aborted) killChrome();

      try {
        const result = await lighthouse(endpoint.url, {
          port: chrome.port,
          output: "json",
          // Resolution strings in audit details are localized; SECURED_RESOLUTIONS is English.
          locale: "en-US",
          onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
        });

        if (!result || !result.lhr) {
          return {
            name: this.name,
            data: {
              available: false,
              reason: "Lighthouse returned no results",
            },
          };
        }

        const { lhr } = result;
        const categories = lhr.categories;
        const audits = lhr.audits;

        return {
          name: this.name,
          data: {
            available: true,
            scores: {
              performance: scoreOrNull(categories.performance),
              accessibility: scoreOrNull(categories.accessibility),
              bestPractices: scoreOrNull(categories["best-practices"]),
              seo: scoreOrNull(categories.seo),
            },
            metrics: {
              firstContentfulPaint: metricOrNull(audits, "first-contentful-paint"),
              largestContentfulPaint: metricOrNull(audits, "largest-contentful-paint"),
              cumulativeLayoutShift: metricOrNull(audits, "cumulative-layout-shift"),
              totalBlockingTime: metricOrNull(audits, "total-blocking-time"),
              speedIndex: metricOrNull(audits, "speed-index"),
              timeToInteractive: metricOrNull(audits, "interactive"),
            },
            ...insecureRequests(audits),
            thirdParties: thirdParties(audits),
          },
        };
      } finally {
        ctx?.signal.removeEventListener("abort", killChrome);
        await chrome.kill();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // Distinguish between "Chrome not found" and other errors
      const isUnavailable =
        message.includes("No Chrome") ||
        message.includes("Cannot find module") ||
        message.includes("ENOENT");
      return {
        name: this.name,
        data: {
          available: false,
          reason: isUnavailable ? "Chrome or Lighthouse not available" : message,
        },
      };
    }
  }
}

function scoreOrNull(category: { score: number | null } | undefined): number | null {
  if (!category || category.score === null || category.score === undefined) return null;
  return Math.round(category.score * 100);
}

function metricOrNull(
  audits: Record<string, { numericValue?: number }>,
  key: string,
): number | null {
  const audit = audits?.[key];
  if (!audit || audit.numericValue === undefined) return null;
  return Math.round(audit.numericValue);
}

const MAX_INSECURE_REQUESTS = 20;
const MAX_THIRD_PARTIES = 10;

interface TableAudit {
  details?: { items?: Array<Record<string, unknown>> };
}

function tableItems(audits: Record<string, unknown>, key: string) {
  const items = (audits?.[key] as TableAudit | undefined)?.details?.items;
  return Array.isArray(items) ? items : null;
}

/**
 * `is-on-https` resolutions (Lighthouse's English strings) for requests the
 * browser stopped or upgraded, so nothing actually went out over HTTP.
 */
const SECURED_RESOLUTIONS = new Set(["Blocked", "Automatically upgraded to HTTPS"]);

/** Requests the page actually made over plain HTTP, from the `is-on-https` audit. */
function insecureRequests(audits: Record<string, unknown>): {
  insecureRequests: string[] | null;
  insecureRequestCount: number | null;
} {
  const items = tableItems(audits, "is-on-https");
  if (!items) return { insecureRequests: null, insecureRequestCount: null };
  const urls = items
    .filter((item) => !SECURED_RESOLUTIONS.has(String(item.resolution)))
    .map((item) => item.url)
    .filter((url): url is string => typeof url === "string");
  return {
    insecureRequests: urls.slice(0, MAX_INSECURE_REQUESTS),
    insecureRequestCount: urls.length,
  };
}

/** A third-party entity the page loaded, from Lighthouse's third-party audit. */
export interface ThirdParty {
  entity: string;
  /** Bytes transferred. */
  transferSize: number;
  /** Main-thread time in ms. */
  mainThreadTime: number;
}

/**
 * Third parties by main-thread cost. Lighthouse 13 replaced the
 * `third-party-summary` audit with `third-parties-insight`, which drops
 * blocking time; both report main-thread time.
 */
function thirdParties(audits: Record<string, unknown>): ThirdParty[] | null {
  const items =
    tableItems(audits, "third-parties-insight") ?? tableItems(audits, "third-party-summary");
  if (!items) return null;

  const num = (value: unknown) => (typeof value === "number" ? Math.round(value) : 0);
  return items
    .map((item) => {
      const entity = item.entity;
      const name =
        typeof entity === "string"
          ? entity
          : typeof (entity as { text?: unknown })?.text === "string"
            ? (entity as { text: string }).text
            : null;
      return {
        entity: name,
        transferSize: num(item.transferSize),
        mainThreadTime: num(item.mainThreadTime),
      };
    })
    .filter((item): item is ThirdParty => item.entity !== null)
    .sort((a, b) => b.mainThreadTime - a.mainThreadTime || b.transferSize - a.transferSize)
    .slice(0, MAX_THIRD_PARTIES);
}
