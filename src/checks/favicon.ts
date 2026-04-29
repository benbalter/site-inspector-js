import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { load } from "cheerio";

interface FaviconLink {
  rel: string;
  type: string | null;
  sizes: string | null;
  href: string;
}

export class FaviconCheck implements Check {
  name = "favicon";

  async run(endpoint: EndpointData): Promise<CheckResult> {
    const body = endpoint.body ?? "";
    const origin = new URL(endpoint.url).origin;
    const $ = load(body);

    const icons: FaviconLink[] = [];
    $("link").each((_i, el) => {
      const rel = $(el).attr("rel")?.toLowerCase() ?? "";
      if (!rel.includes("icon")) return;
      const href = $(el).attr("href");
      if (!href) return;
      icons.push({
        rel,
        type: $(el).attr("type") ?? null,
        sizes: $(el).attr("sizes") ?? null,
        href,
      });
    });

    const hasAppleTouchIcon = icons.some((i) =>
      i.rel.includes("apple-touch-icon"),
    );
    const hasSvgIcon = icons.some(
      (i) => i.type === "image/svg+xml" || i.href.endsWith(".svg"),
    );
    const sizes = icons.map((i) => i.sizes).filter(Boolean) as string[];

    // Probe /favicon.ico
    let faviconIco = false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${origin}/favicon.ico`, {
        method: "HEAD",
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timer);
      faviconIco = res.status === 200;
    } catch {
      // not available
    }

    return {
      name: this.name,
      data: {
        faviconIco,
        icons: icons.length,
        hasAppleTouchIcon,
        hasSvgIcon,
        sizes,
        present: faviconIco || icons.length > 0,
      },
    };
  }
}
