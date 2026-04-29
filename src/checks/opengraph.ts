import ogs from "open-graph-scraper";
import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

export class OpenGraphCheck implements Check {
  name = "opengraph";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const data = {
      ogTitle: null as string | null,
      ogDescription: null as string | null,
      ogImage: null as string | null,
      ogUrl: null as string | null,
      ogType: null as string | null,
      ogSiteName: null as string | null,
      twitterCard: null as string | null,
      twitterSite: null as string | null,
      twitterTitle: null as string | null,
      twitterDescription: null as string | null,
      twitterImage: null as string | null,
      socialReady: false,
    };

    try {
      const { result, error } = await ogs({ html: endpoint.body });

      if (error) return { name: this.name, data };

      data.ogTitle = result.ogTitle ?? null;
      data.ogDescription = result.ogDescription ?? null;
      data.ogUrl = result.ogUrl ?? null;
      data.ogType = result.ogType ?? null;
      data.ogSiteName = result.ogSiteName ?? null;
      data.twitterCard = result.twitterCard ?? null;
      data.twitterSite = result.twitterSite ?? null;
      data.twitterTitle = result.twitterTitle ?? null;
      data.twitterDescription = result.twitterDescription ?? null;

      // ogImage and twitterImage are arrays of objects
      if (Array.isArray(result.ogImage) && result.ogImage.length > 0) {
        data.ogImage = result.ogImage[0].url ?? null;
      }
      if (Array.isArray(result.twitterImage) && result.twitterImage.length > 0) {
        data.twitterImage = result.twitterImage[0].url ?? null;
      }

      data.socialReady = !!(data.ogTitle && data.ogDescription && data.ogImage);
    } catch {
      // Gracefully handle library errors
    }

    return { name: this.name, data };
  }
}
