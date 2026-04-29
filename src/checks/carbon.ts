import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

export class CarbonCheck implements Check {
  name = "carbon";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const body = endpoint.body ?? "";

    const htmlSize = Buffer.byteLength(body, "utf8");
    const htmlSizeKb = Math.round((htmlSize / 1024) * 10) / 10;

    const externalScripts = (body.match(/<script\b[^>]*\bsrc\b/gi) ?? []).length;
    const externalStylesheets = (
      body.match(/<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref\b/gi) ?? []
    ).length;
    const images = (body.match(/<img\b/gi) ?? []).length;
    const iframes = (body.match(/<iframe\b/gi) ?? []).length;
    const totalExternalResources =
      externalScripts + externalStylesheets + images + iframes;

    const inlineScriptMatches = body.match(
      /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi,
    );
    const inlineScripts = inlineScriptMatches ? inlineScriptMatches.length : 0;

    let inlineScriptSize = 0;
    if (inlineScriptMatches) {
      const contentRegex =
        /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi;
      let m: RegExpExecArray | null;
      while ((m = contentRegex.exec(body)) !== null) {
        inlineScriptSize += m[1].length;
      }
    }

    const inlineStyleMatches = body.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
    const inlineStyles = inlineStyleMatches ? inlineStyleMatches.length : 0;

    let inlineStyleSize = 0;
    if (inlineStyleMatches) {
      const contentRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
      let m: RegExpExecArray | null;
      while ((m = contentRegex.exec(body)) !== null) {
        inlineStyleSize += m[1].length;
      }
    }

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
