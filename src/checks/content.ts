import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { load } from "cheerio";
import { probeUrl } from "../utils.js";

export class ContentCheck implements Check {
  name = "content";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const body = endpoint.body ?? "";
    const baseUrl = endpoint.url;
    const $ = load(body);

    const doctypeMatch = body.match(/<!doctype\s+([^>]+)>/i);
    const doctype = doctypeMatch ? doctypeMatch[1].trim() : null;

    const titleEl = $("title");
    const title = titleEl.length > 0 ? titleEl.text().trim() || null : null;

    const description =
      $('meta[name="description"]').attr("content") ?? null;
    const generator =
      $('meta[name="generator"]').attr("content") ?? null;

    const [robotsTxt, sitemapXml] = await Promise.all([
      probeUrl(new URL("/robots.txt", baseUrl).href, "GET"),
      probeUrl(new URL("/sitemap.xml", baseUrl).href, "GET"),
    ]);

    return {
      name: this.name,
      data: {
        doctype,
        title,
        description,
        generator,
        robotsTxt,
        sitemapXml,
      },
    };
  }
}
