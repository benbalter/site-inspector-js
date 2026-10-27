import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { fetchJson, parseHtml } from "../utils.js";

/** The parts of a Green Web Foundation greencheck response we use. */
interface Greencheck {
  green?: boolean;
  hosted_by?: string | null;
}

export class CarbonCheck implements Check {
  name = "carbon";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    // Ask about the host that actually served the page, not the one we asked for.
    const host = new URL(endpoint.finalUrl).hostname;
    const greencheck = fetchJson(
      `https://api.thegreenwebfoundation.org/api/v3/greencheck/${encodeURIComponent(host)}`,
    ) as Promise<Greencheck | null>;

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

    const green = await greencheck;

    return {
      name: this.name,
      data: {
        greenHosting: typeof green?.green === "boolean" ? green.green : null,
        hostedBy: green?.hosted_by ?? null,
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
