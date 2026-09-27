import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import type { CheerioAPI } from "cheerio";
import { parseHtml } from "../utils.js";

interface SchemaInfo {
  type: string | string[];
  name?: string;
}

function extractJsonLdBlocks($: CheerioAPI): { schemas: SchemaInfo[]; parseErrors: number } {
  const schemas: SchemaInfo[] = [];
  let parseErrors = 0;

  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      const parsed = JSON.parse($(el).text());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        const info: SchemaInfo = { type: item["@type"] ?? "Unknown" };
        if (item.name) info.name = item.name;
        schemas.push(info);
      }
    } catch {
      parseErrors++;
    }
  });

  return { schemas, parseErrors };
}

export class StructuredDataCheck implements Check {
  name = "structured-data";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const $ = parseHtml(endpoint);
    const { schemas, parseErrors } = extractJsonLdBlocks($);

    const hasOpenSearch =
      $('link[rel="search"][type="application/opensearchdescription+xml"]').length > 0;

    const hasMicrodata = $("[itemscope][itemtype]").length > 0;

    return {
      name: this.name,
      data: {
        hasJsonLd: schemas.length > 0,
        jsonLdCount: schemas.length,
        schemas,
        parseErrors,
        hasOpenSearch,
        hasMicrodata,
      },
    };
  }
}
