import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { load } from "cheerio";

export class CanonicalCheck implements Check {
  name = "canonical";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const body = endpoint.body ?? "";
    const url = endpoint.url;
    const $ = load(body);

    const canonical = $('link[rel="canonical"]').attr("href") ?? null;

    const robotsContent =
      $('meta[name="robots"]').attr("content")?.toLowerCase() ?? "";
    const noindex = robotsContent.includes("noindex");

    // Check HTTP Link header for canonical
    const linkHeader = endpoint.headers["link"] ?? "";
    const httpCanonicalMatch = linkHeader.match(/<([^>]+)>;\s*rel=["']?canonical["']?/i);
    const httpCanonical = httpCanonicalMatch ? httpCanonicalMatch[1] : null;

    const effectiveCanonical = canonical ?? httpCanonical ?? null;

    // Self-referential: canonical points to the current URL
    let selfReferential = false;
    if (effectiveCanonical) {
      try {
        const canonicalUrl = new URL(effectiveCanonical, url).href;
        const currentUrl = new URL(url).href;
        selfReferential = canonicalUrl === currentUrl;
      } catch {
        // invalid URL
      }
    }

    // Conflict: having both canonical and noindex is contradictory
    const conflict = effectiveCanonical !== null && noindex;

    return {
      name: this.name,
      data: {
        canonical: effectiveCanonical,
        source: canonical ? "html" : httpCanonical ? "http-header" : null,
        selfReferential,
        noindex,
        conflict,
      },
    };
  }
}
