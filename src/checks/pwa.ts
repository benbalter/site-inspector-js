import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { load } from "cheerio";

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    if (res.status !== 200) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function probeUrl(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    return res.status === 200;
  } catch {
    return false;
  }
}

export class PwaCheck implements Check {
  name = "pwa";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const body = endpoint.body ?? "";
    const origin = new URL(endpoint.url).origin;
    const $ = load(body);

    // Detect service worker registration in HTML/JS
    const swRegistration =
      /navigator\.serviceWorker\.register|serviceWorker\.register/i.test(body);

    const manifestHref = $('link[rel="manifest"]').attr("href") ?? null;

    // Probe for service worker
    const swUrl = `${origin}/sw.js`;
    const swAltUrl = `${origin}/service-worker.js`;
    const [swExists, swAltExists] = await Promise.all([
      probeUrl(swUrl),
      probeUrl(swAltUrl),
    ]);
    const hasServiceWorker = swRegistration || swExists || swAltExists;

    // Fetch and parse manifest
    let manifest: Record<string, unknown> | null = null;
    let hasManifest = false;
    let manifestName: string | null = null;
    let manifestDisplay: string | null = null;
    let manifestStartUrl: string | null = null;
    let manifestIcons = 0;

    if (manifestHref) {
      const manifestUrl = new URL(manifestHref, endpoint.url).href;
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
      manifestName =
        ((manifest.name as string) ?? (manifest.short_name as string)) ?? null;
      manifestDisplay = (manifest.display as string) ?? null;
      manifestStartUrl = (manifest.start_url as string) ?? null;
      manifestIcons = Array.isArray(manifest.icons) ? manifest.icons.length : 0;
    }

    // Installability: needs manifest with name, start_url, icons, and display=standalone/fullscreen
    const installable =
      hasManifest &&
      hasServiceWorker &&
      manifestName !== null &&
      manifestStartUrl !== null &&
      manifestIcons > 0 &&
      (manifestDisplay === "standalone" || manifestDisplay === "fullscreen");

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
