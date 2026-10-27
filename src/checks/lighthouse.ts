import { co2 } from "@tgwf/co2";
import type { Check, CheckContext } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

/** Most hosts to list; `hostCount` still counts them all. */
const MAX_HOSTS = 100;

export class LighthouseCheck implements Check {
  name = "lighthouse";
  heavy = true;

  async run(endpoint: EndpointData, domain: string, ctx?: CheckContext): Promise<CheckResult> {
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
            ...emissions(metricOrNull(audits, "total-byte-weight")),
            ...networkActivity(lhr, domain, ctx?.screenshot ?? false),
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

interface NetworkReport {
  entities?: { name: string; origins?: string[]; isFirstParty?: boolean }[];
  audits: Record<string, { details?: unknown }>;
}

/**
 * What the page contacted while loading, like urlscan.io's request log:
 * every host, and the third parties Lighthouse recognizes by name.
 */
function networkActivity(
  lhr: NetworkReport,
  domain: string,
  includeScreenshot: boolean,
): Record<string, unknown> {
  const requests = (lhr.audits["network-requests"]?.details as { items?: { url?: string }[] })
    ?.items;
  const hosts = new Set<string>();
  for (const { url } of requests ?? []) {
    if (!url?.startsWith("http")) continue;
    try {
      hosts.add(new URL(url).hostname);
    } catch {
      // Skip URLs Lighthouse recorded but URL can't parse.
    }
  }
  const sortedHosts = [...hosts].sort();
  const thirdParties = (lhr.entities ?? [])
    .filter((e) => !e.isFirstParty && !e.origins?.some((o) => onDomain(o, domain)))
    .map((e) => e.name)
    .sort();

  const activity: Record<string, unknown> = {
    requestCount: requests ? requests.length : null,
    hostCount: requests ? sortedHosts.length : null,
    hosts: sortedHosts.slice(0, MAX_HOSTS),
    thirdParties,
  };
  if (includeScreenshot) {
    const shot = lhr.audits["final-screenshot"]?.details as { data?: string } | undefined;
    activity.screenshot = shot?.data ?? null;
  }
  return activity;
}

/**
 * Lighthouse judges first-party by the page it ended on, so when the domain
 * redirects elsewhere the domain itself would count as a third party.
 */
function onDomain(origin: string, domain: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

/**
 * Grams of CO2e per page view, as Website Carbon estimates it: the Sustainable
 * Web Design model on grid-average electricity, applied to the full page
 * weight. (The carbon check reports whether the host runs on green energy.)
 */
function emissions(pageWeightBytes: number | null): Record<string, unknown> {
  if (pageWeightBytes === null) {
    return { pageWeightBytes: null, co2PerViewGrams: null, carbonRating: null };
  }
  const estimate = new co2({ model: "swd", version: 4, rating: true }).perVisit(pageWeightBytes);
  const { total, rating } =
    typeof estimate === "number" ? { total: estimate, rating: null } : estimate;
  return {
    pageWeightBytes,
    co2PerViewGrams: Math.round(total * 100) / 100,
    carbonRating: rating,
  };
}
