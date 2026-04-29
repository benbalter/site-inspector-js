import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { load } from "cheerio";

interface MixedContentItem {
  url: string;
  type: "script" | "stylesheet" | "image" | "iframe" | "media" | "form" | "object";
  severity: "active" | "passive";
}

const selectors: Array<{
  selector: string;
  attr: string;
  type: MixedContentItem["type"];
  severity: MixedContentItem["severity"];
}> = [
  { selector: "script[src]", attr: "src", type: "script", severity: "active" },
  { selector: "link[href]", attr: "href", type: "stylesheet", severity: "active" },
  { selector: "img[src]", attr: "src", type: "image", severity: "passive" },
  { selector: "iframe[src]", attr: "src", type: "iframe", severity: "active" },
  { selector: "video[src], source[src]", attr: "src", type: "media", severity: "passive" },
  { selector: "form[action]", attr: "action", type: "form", severity: "active" },
  { selector: "object[data]", attr: "data", type: "object", severity: "active" },
];

const emptyResult = {
  isHttps: false,
  hasMixedContent: false,
  totalMixedResources: 0,
  mixedContent: [],
  activeCount: 0,
  passiveCount: 0,
};

export class MixedContentCheck implements Check {
  name = "mixed-content";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const isHttps = endpoint.url.startsWith("https://");

    if (!isHttps) {
      return { name: this.name, data: { ...emptyResult } };
    }

    const body = endpoint.body ?? "";
    const $ = load(body);
    const mixedContent: MixedContentItem[] = [];

    for (const { selector, attr, type, severity } of selectors) {
      $(selector).each((_i, el) => {
        const value = $(el).attr(attr);
        if (value && value.startsWith("http://")) {
          mixedContent.push({ url: value, type, severity });
        }
      });
    }

    const activeCount = mixedContent.filter((m) => m.severity === "active").length;
    const passiveCount = mixedContent.filter((m) => m.severity === "passive").length;

    return {
      name: this.name,
      data: {
        isHttps: true,
        hasMixedContent: mixedContent.length > 0,
        totalMixedResources: mixedContent.length,
        mixedContent,
        activeCount,
        passiveCount,
      },
    };
  }
}
