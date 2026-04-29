import { createRequire } from "node:module";
import type { EndpointData, CheckResult } from "../types.js";
import type { Check } from "./check.js";

const require = createRequire(import.meta.url);
const robotsParser = require("robots-parser");

export class RobotsCheck implements Check {
  name = "robots";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const origin = new URL(endpoint.url).origin;
    const robotsUrl = `${origin}/robots.txt`;

    let response: Response;
    try {
      response = await fetch(robotsUrl);
    } catch (err) {
      return {
        name: this.name,
        data: {
          exists: false,
          sitemaps: [],
          crawlDelay: null,
          blocksGooglebot: false,
          blocksAll: false,
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }

    if (!response.ok) {
      return {
        name: this.name,
        data: {
          exists: false,
          sitemaps: [],
          crawlDelay: null,
          blocksGooglebot: false,
          blocksAll: false,
          error: null,
        },
      };
    }

    const body = await response.text();
    const robots = robotsParser(robotsUrl, body);
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
