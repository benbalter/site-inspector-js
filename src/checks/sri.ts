import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

const EXTERNAL_URL_RE = /^(?:https?:)?\/\//i;

const SCRIPT_RE = /<script[^>]+src=["']([^"']+)["'][^>]*>/gi;
const LINK_STYLESHEET_RE =
  /<link[^>]+(?:rel=["']stylesheet["'][^>]+href=["']([^"']+)["']|href=["']([^"']+)["'][^>]+rel=["']stylesheet["'])[^>]*>/gi;

function isExternal(url: string): boolean {
  return EXTERNAL_URL_RE.test(url);
}

function hasIntegrity(tag: string): boolean {
  return /integrity=/i.test(tag);
}

export class SriCheck implements Check {
  name = "sri";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const body = endpoint.body ?? "";

    const scriptsWithoutSri: string[] = [];
    let totalExternalScripts = 0;
    let scriptsWithSri = 0;

    for (const match of body.matchAll(SCRIPT_RE)) {
      const url = match[1];
      if (!isExternal(url)) continue;
      totalExternalScripts++;
      if (hasIntegrity(match[0])) {
        scriptsWithSri++;
      } else {
        scriptsWithoutSri.push(url);
      }
    }

    const stylesheetsWithoutSri: string[] = [];
    let totalExternalStylesheets = 0;
    let stylesheetsWithSri = 0;

    for (const match of body.matchAll(LINK_STYLESHEET_RE)) {
      const url = match[1] ?? match[2];
      if (!isExternal(url)) continue;
      totalExternalStylesheets++;
      if (hasIntegrity(match[0])) {
        stylesheetsWithSri++;
      } else {
        stylesheetsWithoutSri.push(url);
      }
    }

    const totalExternal = totalExternalScripts + totalExternalStylesheets;
    const totalWithSri = scriptsWithSri + stylesheetsWithSri;
    const coverage =
      totalExternal === 0
        ? 100
        : Math.round((totalWithSri / totalExternal) * 100);

    return {
      name: this.name,
      data: {
        totalExternalScripts,
        scriptsWithSri,
        scriptsWithoutSri,
        totalExternalStylesheets,
        stylesheetsWithSri,
        stylesheetsWithoutSri,
        totalExternal,
        totalWithSri,
        coverage,
      },
    };
  }
}
