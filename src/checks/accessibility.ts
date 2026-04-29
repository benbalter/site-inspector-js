import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

export class AccessibilityCheck implements Check {
  name = "accessibility";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const body = endpoint.body ?? "";

    const { htmlLang, langValue } = this.checkLang(body);
    const { viewport, viewportContent } = this.checkViewport(body);
    const headingStructure = this.checkHeadings(body);
    const images = this.checkImages(body);

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

  private checkLang(body: string): {
    htmlLang: boolean;
    langValue: string | null;
  } {
    const match = body.match(/<html[^>]*lang=["']([^"']*)["']/i);
    return {
      htmlLang: match !== null,
      langValue: match ? match[1] : null,
    };
  }

  private checkViewport(body: string): {
    viewport: boolean;
    viewportContent: string | null;
  } {
    // Try name before content, then content before name
    const pattern1 =
      /<meta[^>]*name=["']viewport["'][^>]*content=["']([^"']*)["']/i;
    const pattern2 =
      /<meta[^>]*content=["']([^"']*)["'][^>]*name=["']viewport["']/i;
    const match = body.match(pattern1) ?? body.match(pattern2);
    return {
      viewport: match !== null,
      viewportContent: match ? match[1] : null,
    };
  }

  private checkHeadings(body: string): {
    hasH1: boolean;
    h1Count: number;
    hierarchy: number[];
    isSequential: boolean;
  } {
    const headingRegex = /<h([1-6])[^>]*>/gi;
    const hierarchy: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = headingRegex.exec(body)) !== null) {
      hierarchy.push(parseInt(match[1], 10));
    }

    const h1Count = hierarchy.filter((l) => l === 1).length;

    let isSequential = true;
    for (let i = 1; i < hierarchy.length; i++) {
      if (hierarchy[i] > hierarchy[i - 1] + 1) {
        isSequential = false;
        break;
      }
    }

    return { hasH1: h1Count > 0, h1Count, hierarchy, isSequential };
  }

  private checkImages(body: string): {
    total: number;
    withAlt: number;
    withoutAlt: number;
    altCoverage: number;
  } {
    const imgRegex = /<img[^>]*>/gi;
    const imgs = body.match(imgRegex) ?? [];
    const total = imgs.length;

    let withAlt = 0;
    for (const img of imgs) {
      // Non-empty alt attribute
      if (/alt=["'][^"']+["']/i.test(img)) {
        withAlt++;
      }
    }

    const withoutAlt = total - withAlt;
    const altCoverage = total > 0 ? Math.round((withAlt / total) * 100) : 0;

    return { total, withAlt, withoutAlt, altCoverage };
  }
}
