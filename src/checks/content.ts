import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

async function checkPath(baseUrl: string, path: string): Promise<boolean> {
  try {
    const url = new URL(path, baseUrl).href;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    clearTimeout(timer);
    return res.status === 200;
  } catch {
    return false;
  }
}

function extractDoctype(body: string): string | null {
  const match = body.match(/<!doctype\s+([^>]+)>/i);
  return match ? match[1].trim() : null;
}

function extractTitle(body: string): string | null {
  const match = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim() : null;
}

function extractMeta(body: string, name: string): string | null {
  // name before content
  const pattern1 = new RegExp(
    `<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*?)["']`,
    "i",
  );
  const m1 = body.match(pattern1);
  if (m1) return m1[1];

  // content before name
  const pattern2 = new RegExp(
    `<meta[^>]+content=["']([^"']*?)["'][^>]+name=["']${name}["']`,
    "i",
  );
  const m2 = body.match(pattern2);
  if (m2) return m2[1];

  return null;
}

export class ContentCheck implements Check {
  name = "content";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const body = endpoint.body ?? "";
    const baseUrl = endpoint.url;

    const [robotsTxt, sitemapXml] = await Promise.all([
      checkPath(baseUrl, "/robots.txt"),
      checkPath(baseUrl, "/sitemap.xml"),
    ]);

    return {
      name: this.name,
      data: {
        doctype: extractDoctype(body),
        title: extractTitle(body),
        description: extractMeta(body, "description"),
        generator: extractMeta(body, "generator"),
        robotsTxt,
        sitemapXml,
      },
    };
  }
}
