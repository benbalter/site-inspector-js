import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { load } from "cheerio";

const EXTERNAL_URL_RE = /^(?:https?:)?\/\//i;

function isExternal(url: string): boolean {
  return EXTERNAL_URL_RE.test(url);
}

export class SriCheck implements Check {
  name = "sri";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const body = endpoint.body ?? "";
    const $ = load(body);

    const scriptsWithoutSri: string[] = [];
    let totalExternalScripts = 0;
    let scriptsWithSri = 0;

    $("script[src]").each((_i, el) => {
      const url = $(el).attr("src");
      if (!url || !isExternal(url)) return;
      totalExternalScripts++;
      if ($(el).attr("integrity")) {
        scriptsWithSri++;
      } else {
        scriptsWithoutSri.push(url);
      }
    });

    const stylesheetsWithoutSri: string[] = [];
    let totalExternalStylesheets = 0;
    let stylesheetsWithSri = 0;

    $("link[rel='stylesheet'][href]").each((_i, el) => {
      const url = $(el).attr("href");
      if (!url || !isExternal(url)) return;
      totalExternalStylesheets++;
      if ($(el).attr("integrity")) {
        stylesheetsWithSri++;
      } else {
        stylesheetsWithoutSri.push(url);
      }
    });

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
