import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { parse: parseCacheControl } = require("cache-control-parser");

export class CacheHeadersCheck implements Check {
  name = "cache-headers";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const cacheControl = endpoint.headers["cache-control"] ?? null;
    const etag = endpoint.headers["etag"] ?? null;
    const lastModified = endpoint.headers["last-modified"] ?? null;
    const vary = endpoint.headers["vary"] ?? null;
    const age = endpoint.headers["age"]
      ? Number(endpoint.headers["age"])
      : null;
    const expires = endpoint.headers["expires"] ?? null;
    const pragma = endpoint.headers["pragma"] ?? null;

    let maxAge: number | null = null;
    let sMaxAge: number | null = null;
    let noCache = false;
    let noStore = false;
    let isPublic = false;
    let isPrivate = false;
    let mustRevalidate = false;
    let immutable = false;

    if (cacheControl) {
      const directives = parseCacheControl(cacheControl);
      maxAge = directives["max-age"] ?? null;
      sMaxAge = directives["s-maxage"] ?? null;
      noCache = directives["no-cache"] === true;
      noStore = directives["no-store"] === true;
      isPublic = directives["public"] === true;
      isPrivate = directives["private"] === true;
      mustRevalidate = directives["must-revalidate"] === true;
      immutable = directives["immutable"] === true;
    }

    // Scoring: higher is better
    let score = 0;
    if (cacheControl) score += 2;
    if (etag) score += 2;
    if (lastModified) score += 1;
    if (vary) score += 1;
    if (maxAge !== null && maxAge > 0) score += 2;
    if (immutable) score += 1;
    if (noStore) score -= 1; // not necessarily bad, but no caching
    const grade =
      score >= 7 ? "A" : score >= 5 ? "B" : score >= 3 ? "C" : score >= 1 ? "D" : "F";

    return {
      name: this.name,
      data: {
        cacheControl,
        etag: etag !== null,
        lastModified: lastModified !== null,
        vary: vary ? vary.split(",").map((v) => v.trim()) : [],
        age,
        expires,
        pragma,
        maxAge,
        sMaxAge,
        noCache,
        noStore,
        isPublic,
        isPrivate,
        mustRevalidate,
        immutable,
        score,
        grade,
      },
    };
  }
}
