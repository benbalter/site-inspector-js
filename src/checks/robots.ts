import { createRequire } from "node:module";
import type { EndpointData, CheckResult } from "../types.js";
import type { Check } from "./check.js";
import { safeFetch } from "../utils.js";

const require = createRequire(import.meta.url);
const robotsParser = require("robots-parser");

const NOT_FOUND: CheckResult["data"] = {
  exists: false,
  sitemaps: [],
  crawlDelay: null,
  blocksGooglebot: false,
  blocksAll: false,
  error: null,
};

export class RobotsCheck implements Check {
  name = "robots";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const origin = new URL(endpoint.url).origin;
    const robotsUrl = `${origin}/robots.txt`;

    const response = await safeFetch(robotsUrl, 10_000);

    if (!response || !response.ok) {
      return {
        name: this.name,
        data: { ...NOT_FOUND, error: response ? null : "Fetch failed" },
      };
    }

    const robots = robotsParser(robotsUrl, response.body);
    const rootUrl = `${origin}/`;

    return {
      name: this.name,
      data: {
        exists: true,
        sitemaps: robots.getSitemaps() as string[],
        crawlDelay: (robots.getCrawlDelay("*") as number | undefined) ?? null,
        blocksGooglebot: !robots.isAllowed(rootUrl, "Googlebot"),
        blocksAll: !robots.isAllowed(rootUrl, "*"),
        error: null,
      },
    };
  }
}
