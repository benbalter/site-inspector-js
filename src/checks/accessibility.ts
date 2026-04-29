import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { load } from "cheerio";

export class AccessibilityCheck implements Check {
  name = "accessibility";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const body = endpoint.body ?? "";
    const $ = load(body);

    const langAttr = $("html").attr("lang");
    const htmlLang = langAttr !== undefined;
    const langValue = htmlLang ? langAttr : null;

    const viewportMeta = $('meta[name="viewport"]');
    const viewportContent = viewportMeta.attr("content") ?? null;
    const viewport = viewportContent !== null;

    const hierarchy: number[] = [];
    $("h1, h2, h3, h4, h5, h6").each((_i, el) => {
      const level = parseInt(el.tagName.replace("h", ""), 10);
      hierarchy.push(level);
    });
    const h1Count = hierarchy.filter((l) => l === 1).length;
    let isSequential = true;
    for (let i = 1; i < hierarchy.length; i++) {
      if (hierarchy[i] > hierarchy[i - 1] + 1) {
        isSequential = false;
        break;
      }
    }
    const headingStructure = { hasH1: h1Count > 0, h1Count, hierarchy, isSequential };

    const imgElements = $("img");
    const total = imgElements.length;
    let withAlt = 0;
    imgElements.each((_i, el) => {
      const alt = $(el).attr("alt");
      if (alt !== undefined && alt.length > 0) {
        withAlt++;
      }
    });
    const withoutAlt = total - withAlt;
    const altCoverage = total > 0 ? Math.round((withAlt / total) * 100) : 0;
    const images = { total, withAlt, withoutAlt, altCoverage };

    return {
      name: this.name,
      data: {
        htmlLang,
        langValue,
        viewport,
        viewportContent,
        headingStructure,
        images,
      },
    };
  }
}
