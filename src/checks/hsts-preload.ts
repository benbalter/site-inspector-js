import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

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
    const [statusData, preloadableData] = await Promise.all([
      this.fetchStatus(domain),
      this.fetchPreloadable(domain),
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

  private async fetchStatus(domain: string): Promise<PreloadStatus | null> {
    try {
      const response = await fetch(
        `https://hstspreload.org/api/v2/status?domain=${encodeURIComponent(domain)}`
      );
      if (!response.ok) {
        return null;
      }
      return (await response.json()) as PreloadStatus;
    } catch {
      return null;
    }
  }

  private async fetchPreloadable(
    domain: string
  ): Promise<PreloadableStatus | null> {
    try {
      const response = await fetch(
        `https://hstspreload.org/api/v2/preloadable?domain=${encodeURIComponent(domain)}`
      );
      if (!response.ok) {
        return null;
      }
      return (await response.json()) as PreloadableStatus;
    } catch {
      return null;
    }
  }
}