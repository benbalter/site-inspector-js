import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

export class LighthouseCheck implements Check {
  name = "lighthouse";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    try {
      // Dynamic imports so the check doesn't fail at module load time
      // if lighthouse/chrome-launcher aren't installed
      const { default: lighthouse } = await import("lighthouse");
      const { launch } = await import("chrome-launcher");

      const chrome = await launch({
        chromeFlags: ["--headless", "--no-sandbox", "--disable-gpu"],
      });

      try {
        const result = await lighthouse(endpoint.url, {
          port: chrome.port,
          output: "json",
          onlyCategories: [
            "performance",
            "accessibility",
            "best-practices",
            "seo",
          ],
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
              firstContentfulPaint: metricOrNull(
                audits,
                "first-contentful-paint",
              ),
              largestContentfulPaint: metricOrNull(
                audits,
                "largest-contentful-paint",
              ),
              cumulativeLayoutShift: metricOrNull(
                audits,
                "cumulative-layout-shift",
              ),
              totalBlockingTime: metricOrNull(
                audits,
                "total-blocking-time",
              ),
              speedIndex: metricOrNull(audits, "speed-index"),
              timeToInteractive: metricOrNull(audits, "interactive"),
            },
          },
        };
      } finally {
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
          reason: isUnavailable
            ? "Chrome or Lighthouse not available"
            : message,
        },
      };
    }
  }
}

function scoreOrNull(
  category: { score: number | null } | undefined,
): number | null {
  if (!category || category.score === null || category.score === undefined)
    return null;
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
