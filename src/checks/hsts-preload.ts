import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { fetchJson } from "../utils.js";

interface PreloadStatus {
  status: string;
  includeSubDomains?: boolean;
  headers?: boolean;
  max_age?: string;
  max_age_grepped?: string;
}

interface PreloadableStatus {
  status: string;
  issues?: Array<{
    code: string;
    summary: string;
    message: string;
  }>;
}

export class HstsPreloadCheck implements Check {
  name = "hsts-preload";

  async run(_endpoint: EndpointData, domain: string): Promise<CheckResult> {
    const statusUrl = `https://hstspreload.org/api/v2/status?domain=${encodeURIComponent(domain)}`;
    const preloadableUrl = `https://hstspreload.org/api/v2/preloadable?domain=${encodeURIComponent(domain)}`;

    const [statusData, preloadableData] = await Promise.all([
      fetchJson(statusUrl) as Promise<PreloadStatus | null>,
      fetchJson(preloadableUrl) as Promise<PreloadableStatus | null>,
    ]);

    return {
      name: this.name,
      data: {
        preloaded: statusData?.status === "preloaded" ? true : false,
        status: statusData?.status ?? "unknown",
        eligible: preloadableData?.status === "preloadable" ? true : false,
        issues: preloadableData?.issues ?? [],
      },
    };
  }
}