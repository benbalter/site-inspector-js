import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

interface SchemaInfo {
  type: string | string[];
  name?: string;
}

function extractJsonLdBlocks(body: string): { schemas: SchemaInfo[]; parseErrors: number } {
  const schemas: SchemaInfo[] = [];
  let parseErrors = 0;

  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(body)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        const info: SchemaInfo = { type: item["@type"] ?? "Unknown" };
        if (item.name) info.name = item.name;
        schemas.push(info);
      }
    } catch {
      parseErrors++;
    }
  }

  return { schemas, parseErrors };
}

function hasOpenSearch(body: string): boolean {
  return /<link[^>]+rel=["']search["'][^>]+type=["']application\/opensearchdescription\+xml["'][^>]*>/i.test(body)
    || /<link[^>]+type=["']application\/opensearchdescription\+xml["'][^>]+rel=["']search["'][^>]*>/i.test(body);
}

function hasMicrodata(body: string): boolean {
  return /\bitemscope\b/i.test(body) && /\bitemtype\b/i.test(body);
}

export class StructuredDataCheck implements Check {
  name = "structured-data";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const body = endpoint.body ?? "";
    const { schemas, parseErrors } = extractJsonLdBlocks(body);

    return {
      name: this.name,
      data: {
        hasJsonLd: schemas.length > 0,
        jsonLdCount: schemas.length,
        schemas,
        parseErrors,
        hasOpenSearch: hasOpenSearch(body),
        hasMicrodata: hasMicrodata(body),
      },
    };
  }
}
