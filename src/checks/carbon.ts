import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { load } from "cheerio";

export class CarbonCheck implements Check {
  name = "carbon";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const body = endpoint.body ?? "";
    const $ = load(body);

    const htmlSize = Buffer.byteLength(body, "utf8");
    const htmlSizeKb = Math.round((htmlSize / 1024) * 10) / 10;

    const externalScripts = $("script[src]").length;
    const externalStylesheets = $("link[rel='stylesheet'][href]").length;
    const images = $("img").length;
    const iframes = $("iframe").length;
    const totalExternalResources =
      externalScripts + externalStylesheets + images + iframes;

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
      },
    };
  }
}
