import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

interface MixedContentItem {
  url: string;
  type: "script" | "stylesheet" | "image" | "iframe" | "media" | "form" | "object";
  severity: "active" | "passive";
}

const patterns: Array<{
  regex: RegExp;
  type: MixedContentItem["type"];
  severity: MixedContentItem["severity"];
}> = [
  { regex: /<script[^>]+src=["'](http:\/\/[^"']+)["']/gi, type: "script", severity: "active" },
  { regex: /<link[^>]+href=["'](http:\/\/[^"']+)["']/gi, type: "stylesheet", severity: "active" },
  { regex: /<img[^>]+src=["'](http:\/\/[^"']+)["']/gi, type: "image", severity: "passive" },
  { regex: /<iframe[^>]+src=["'](http:\/\/[^"']+)["']/gi, type: "iframe", severity: "active" },
  { regex: /<(?:video|source)[^>]+src=["'](http:\/\/[^"']+)["']/gi, type: "media", severity: "passive" },
  { regex: /<form[^>]+action=["'](http:\/\/[^"']+)["']/gi, type: "form", severity: "active" },
  { regex: /<object[^>]+data=["'](http:\/\/[^"']+)["']/gi, type: "object", severity: "active" },
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
    const mixedContent: MixedContentItem[] = [];

    for (const { regex, type, severity } of patterns) {
      // Reset lastIndex since regexes have the global flag
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(body)) !== null) {
        mixedContent.push({ url: match[1], type, severity });
      }
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
