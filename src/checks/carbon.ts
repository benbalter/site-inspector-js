import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { parseHtml } from "../utils.js";

/** Sustainable Web Design model, version 4, via the Green Web Foundation's CO2.js. */
const CO2_MODEL = "swd-v4";

interface Co2Estimate {
  co2GramsPerView: number | null;
  co2GramsPerViewGreenHosting: number | null;
  co2Error: string | null;
}

/** Three significant figures: HTML-only estimates are fractions of a gram. */
function round(value: number): number {
  return Number(value.toPrecision(3));
}

/**
 * CO2 estimate for transferring `bytes` once, on grey (grid-average) and on
 * green hosting. This check can't see the green-hosting check's verdict, so
 * it reports both.
 */
async function estimateCo2(bytes: number): Promise<Co2Estimate> {
  try {
    const { co2 } = await import("@tgwf/co2");
    const model = new co2({ model: "swd", version: 4 });
    const grams = (green: boolean): number | null => {
      const result = model.perByte(bytes, green);
      return typeof result === "number" ? round(result) : null;
    };
    return {
      co2GramsPerView: grams(false),
      co2GramsPerViewGreenHosting: grams(true),
      co2Error: null,
    };
  } catch (err) {
    return {
      co2GramsPerView: null,
      co2GramsPerViewGreenHosting: null,
      co2Error: err instanceof Error ? err.message : String(err),
    };
  }
}

export class CarbonCheck implements Check {
  name = "carbon";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const body = endpoint.body ?? "";
    const $ = parseHtml(endpoint);

    const htmlSize = Buffer.byteLength(body, "utf8");
    const htmlSizeKb = Math.round((htmlSize / 1024) * 10) / 10;

    const externalScripts = $("script[src]").length;
    const externalStylesheets = $("link[rel='stylesheet'][href]").length;
    const images = $("img").length;
    const iframes = $("iframe").length;
    const totalExternalResources = externalScripts + externalStylesheets + images + iframes;

    const inlineScriptEls = $("script").not("[src]");
    const inlineScripts = inlineScriptEls.length;
    let inlineScriptSize = 0;
    inlineScriptEls.each((_i, el) => {
      inlineScriptSize += $(el).text().length;
    });

    const inlineStyleEls = $("style");
    const inlineStyles = inlineStyleEls.length;
    let inlineStyleSize = 0;
    inlineStyleEls.each((_i, el) => {
      inlineStyleSize += $(el).text().length;
    });

    return {
      name: this.name,
      data: {
        htmlSize,
        htmlSizeKb,
        externalScripts,
        externalStylesheets,
        images,
        iframes,
        totalExternalResources,
        inlineScripts,
        inlineStyles,
        inlineScriptSize,
        inlineStyleSize,
        // Covers the HTML document only, not images, scripts, or other subresources.
        co2Scope: "html",
        co2Model: CO2_MODEL,
        ...(await estimateCo2(htmlSize)),
      },
    };
  }
}
