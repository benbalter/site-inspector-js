import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { load } from "cheerio";

export class I18nCheck implements Check {
  name = "i18n";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const body = endpoint.body ?? "";
    const headers = endpoint.headers;
    const $ = load(body);

    const htmlLang = $("html").attr("lang") ?? null;

    const charsetMeta = $("meta[charset]").attr("charset") ?? null;
    const httpEquivCharset =
      $('meta[http-equiv="Content-Type"]')
        .attr("content")
        ?.match(/charset=([^\s;]+)/i)?.[1] ?? null;
    const httpCharset =
      headers["content-type"]?.match(/charset=([^\s;]+)/i)?.[1] ?? null;
    const charset = charsetMeta ?? httpEquivCharset ?? httpCharset ?? null;

    const contentLanguage = headers["content-language"] ?? null;

    const hreflangs: Array<{ lang: string; href: string }> = [];
    $("link[hreflang]").each((_i, el) => {
      const lang = $(el).attr("hreflang");
      const href = $(el).attr("href");
      if (lang && href) {
        hreflangs.push({ lang, href });
      }
    });

    const hasXDefault = hreflangs.some((h) => h.lang === "x-default");
    const languageCount = new Set(
      hreflangs.map((h) => h.lang).filter((l) => l !== "x-default"),
    ).size;

    const dir = $("html").attr("dir")?.toLowerCase() ?? null;

    return {
      name: this.name,
      data: {
        htmlLang,
        charset,
        contentLanguage,
        dir,
        hreflangs,
        languageCount,
        hasXDefault,
        multilingual: languageCount > 1 || hreflangs.length > 0,
      },
    };
  }
}
