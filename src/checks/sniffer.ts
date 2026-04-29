import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

const require = createRequire(import.meta.url);
const Wappalyzer = require("wappalyzer-core/wappalyzer.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(__dirname, "../../data");

// Load categories and technologies once at module level
const categories = JSON.parse(
  readFileSync(resolve(dataDir, "categories.json"), "utf-8"),
);
Wappalyzer.setCategories(categories);

const techDir = resolve(dataDir, "technologies");
const allTechs: Record<string, unknown> = {};
for (const file of readdirSync(techDir).filter((f: string) =>
  f.endsWith(".json"),
)) {
  Object.assign(allTechs, JSON.parse(readFileSync(resolve(techDir, file), "utf-8")));
}
Wappalyzer.setTechnologies(allTechs);

/** Parse `set-cookie` header into `{ name: [value] }` format. */
function parseCookies(headers: Record<string, string>): Record<string, string[]> {
  const raw = headers["set-cookie"];
  if (!raw) return {};
  const cookies: Record<string, string[]> = {};
  for (const part of raw.split(/,(?=[^ ])/)) {
    const [pair] = part.split(";");
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    cookies[name] = [value];
  }
  return cookies;
}

/** Extract `<meta name="X" content="Y">` tags from HTML. */
function parseMeta(html: string): Record<string, string[]> {
  const meta: Record<string, string[]> = {};
  const re = /<meta\s+[^>]*?name=["']([^"']+)["'][^>]*?content=["']([^"']*?)["'][^>]*?\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    meta[m[1].toLowerCase()] = [m[2]];
  }
  // Also match content before name
  const re2 = /<meta\s+[^>]*?content=["']([^"']*?)["'][^>]*?name=["']([^"']+)["'][^>]*?\/?>/gi;
  while ((m = re2.exec(html)) !== null) {
    meta[m[2].toLowerCase()] = [m[1]];
  }
  return meta;
}

/** Extract all `<script src="...">` URLs from HTML. */
function parseScriptSrc(html: string): string[] {
  const srcs: string[] = [];
  const re = /<script\s+[^>]*?src=["']([^"']+)["'][^>]*?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    srcs.push(m[1]);
  }
  return srcs;
}

interface WappalyzerDetection {
  technology: {
    name: string;
    slug: string;
    categories: Array<{ id: number; slug: string; name: string }>;
    website: string;
  };
  pattern: { confidence: number };
  version: string;
}

interface ResolvedDetection {
  name: string;
  confidence: number;
  version: string;
  categories: Array<{ id: number; slug: string; name: string }>;
  website: string;
}

export interface SnifferTechnology {
  name: string;
  categories: string[];
  version: string;
  confidence: number;
  website: string | null;
}

export class SnifferCheck implements Check {
  name = "sniffer";

  async run(endpoint: EndpointData): Promise<CheckResult> {
    const { body, headers, url } = endpoint;

    // Convert headers to array-valued format
    const headerArrays: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(headers)) {
      headerArrays[k.toLowerCase()] = [v];
    }

    const detections: WappalyzerDetection[] = Wappalyzer.analyze({
      url,
      headers: headerArrays,
      html: body,
      scripts: parseScriptSrc(body),
      cookies: parseCookies(headers),
      meta: parseMeta(body),
      scriptSrc: parseScriptSrc(body),
    });

    // Use resolve() to handle implies/excludes
    const resolved: ResolvedDetection[] = Wappalyzer.resolve(detections);

    // Group by technology name, taking highest confidence
    const byName = new Map<string, SnifferTechnology>();
    for (const d of resolved) {
      const existing = byName.get(d.name);
      if (!existing || d.confidence > existing.confidence) {
        byName.set(d.name, {
          name: d.name,
          categories: d.categories.map((c) => c.name),
          version: d.version ?? "",
          confidence: d.confidence ?? 0,
          website: d.website || null,
        });
      }
    }

    return {
      name: this.name,
      data: {
        technologies: Array.from(byName.values()),
      },
    };
  }
}
