import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { fetchJson, isCatchAll, parseHtml, probeUrl } from "../utils.js";

export class PwaCheck implements Check {
  name = "pwa";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const body = endpoint.body ?? "";
    const origin = new URL(endpoint.url).origin;
    const $ = parseHtml(endpoint);

    // Detect service worker registration in HTML/JS
    const swRegistration = /navigator\.serviceWorker\.register|serviceWorker\.register/i.test(body);

    const manifestHref = $('link[rel="manifest"]').attr("href") ?? null;

    // Probe for service worker
    const swUrl = `${origin}/sw.js`;
    const swAltUrl = `${origin}/service-worker.js`;
    const [swExists, swAltExists, catchAll] = await Promise.all([
      probeUrl(swUrl),
      probeUrl(swAltUrl),
      isCatchAll(origin),
    ]);
    // A catch-all server returns 200 for any path, so the probes prove nothing.
    const hasServiceWorker = swRegistration || (!catchAll && (swExists || swAltExists));

    // Fetch and parse manifest
    let manifest: Record<string, unknown> | null = null;
    let hasManifest = false;
    let manifestName: string | null = null;
    let manifestDisplay: string | null = null;
    let manifestStartUrl: string | null = null;
    let manifestIcons = 0;

    if (manifestHref) {
      const manifestUrl = new URL(manifestHref, endpoint.finalUrl ?? endpoint.url).href;
      manifest = await fetchJson(manifestUrl);
    }
    if (!manifest) {
      // Try common paths
      manifest =
        (await fetchJson(`${origin}/manifest.json`)) ||
        (await fetchJson(`${origin}/manifest.webmanifest`));
    }

    if (manifest) {
      hasManifest = true;
      manifestName = (manifest.name as string) ?? (manifest.short_name as string) ?? null;
      manifestDisplay = (manifest.display as string) ?? null;
      manifestStartUrl = (manifest.start_url as string) ?? null;
      manifestIcons = Array.isArray(manifest.icons) ? manifest.icons.length : 0;
    }

    // Installability: needs manifest with name, start_url, icons, and an app-like display mode
    const installable =
      hasManifest &&
      hasServiceWorker &&
      manifestName !== null &&
      manifestStartUrl !== null &&
      manifestIcons > 0 &&
      (manifestDisplay === "standalone" ||
        manifestDisplay === "fullscreen" ||
        manifestDisplay === "minimal-ui");

    return {
      name: this.name,
      data: {
        hasServiceWorker,
        swRegistrationInHtml: swRegistration,
        hasManifest,
        manifestName,
        manifestDisplay,
        manifestStartUrl,
        manifestIcons,
        installable,
      },
    };
  }
}
