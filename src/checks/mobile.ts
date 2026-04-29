import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { load } from "cheerio";

export class MobileCheck implements Check {
  name = "mobile";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const body = endpoint.body ?? "";
    const $ = load(body);

    const viewport = $('meta[name="viewport"]').attr("content") ?? null;
    const hasViewport = viewport !== null;

    const themeColor = $('meta[name="theme-color"]').attr("content") ?? null;

    const appleTouchIcon = $('link[rel="apple-touch-icon"]').length > 0;

    const manifestLink = $('link[rel="manifest"]').length > 0;

    const mobileWebAppCapable =
      $('meta[name="apple-mobile-web-app-capable"]').attr("content")?.toLowerCase() === "yes";

    const statusBarStyle =
      $('meta[name="apple-mobile-web-app-status-bar-style"]').attr("content") ?? null;

    // Score
    let score = 0;
    if (hasViewport) score += 3;
    if (themeColor) score += 1;
    if (appleTouchIcon) score += 2;
    if (manifestLink) score += 2;
    if (mobileWebAppCapable) score += 1;
    const grade =
      score >= 7 ? "A" : score >= 5 ? "B" : score >= 3 ? "C" : score >= 1 ? "D" : "F";

    return {
      name: this.name,
      data: {
        viewport,
        hasViewport,
        themeColor,
        appleTouchIcon,
        manifestLink,
        mobileWebAppCapable,
        statusBarStyle,
        score,
        grade,
      },
    };
  }
}
