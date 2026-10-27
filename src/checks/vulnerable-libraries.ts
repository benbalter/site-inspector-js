import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Component, Repository } from "retire/lib/types.js";
import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { parseHtml, safeFetch } from "../utils.js";

const require = createRequire(import.meta.url);
const retire = require("retire/lib/retire.js") as typeof import("retire/lib/retire.js");

const dataFile = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../data/retire/jsrepository.json",
);

/** Most external scripts to look at, and to download when their URL says nothing. */
const MAX_SCRIPTS = 20;
const MAX_DOWNLOADS = 10;
const CONCURRENCY = 5;
const DOWNLOAD_TIMEOUT_MS = 5_000;

const SEVERITY_ORDER = ["low", "medium", "high", "critical"];

const hasher = { sha1: (data: string) => createHash("sha1").update(data).digest("hex") };

// Parse the 600 KB repository on first use rather than at import.
let repository: Promise<Repository> | undefined;
function loadRepository(): Promise<Repository> {
  repository ??= readFile(dataFile, "utf8").then(
    (text) => JSON.parse(retire.replaceVersion(text)) as Repository,
  );
  return repository;
}

/** Run `fn` over `items`, at most `limit` at a time. */
async function forEachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Identify libraries from a script's URL or file name, the way retire.js does. */
function scanUrl(url: string, repo: Repository): Component[] {
  const fileName = new URL(url).pathname.split("/").pop() ?? "";
  return [...retire.scanUri(url, repo), ...retire.scanFileName(fileName, repo, false)];
}

/**
 * JavaScript libraries with known vulnerabilities, using retire.js's
 * repository (vendored in data/retire; see scripts/update-fingerprints.sh).
 * Libraries are identified from script URLs first; scripts whose URL gives no
 * version are downloaded (a capped number) and identified from their contents.
 */
export class VulnerableLibrariesCheck implements Check {
  name = "vulnerable-libraries";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const repo = await loadRepository();
    const $ = parseHtml(endpoint);

    const scripts = new Set<string>();
    $("script[src]").each((_i, el) => {
      try {
        const url = new URL($(el).attr("src") ?? "", endpoint.finalUrl);
        if (url.protocol === "http:" || url.protocol === "https:") scripts.add(url.href);
      } catch {
        // Not a URL.
      }
    });
    const scanned = [...scripts].slice(0, MAX_SCRIPTS);

    const found: { component: Component; source: string }[] = [];
    const unidentified: string[] = [];
    for (const url of scanned) {
      const components = scanUrl(url, repo);
      if (components.length > 0) {
        found.push(...components.map((component) => ({ component, source: url })));
      } else {
        unidentified.push(url);
      }
    }

    await forEachLimit(unidentified.slice(0, MAX_DOWNLOADS), CONCURRENCY, async (url) => {
      const response = await safeFetch(url, DOWNLOAD_TIMEOUT_MS);
      if (!response?.ok) return;
      const components = retire.scanFileContent(response.body, repo, hasher);
      found.push(...components.map((component) => ({ component, source: url })));
    });

    $("script:not([src])").each((_i, el) => {
      const components = retire.scanFileContent($(el).text(), repo, hasher);
      found.push(...components.map((component) => ({ component, source: "inline" })));
    });

    // One entry per library and version, whichever script found it first.
    const libraries = new Map<string, Record<string, unknown>>();
    for (const { component, source } of found) {
      const key = `${component.component}@${component.version}`;
      if (libraries.has(key)) continue;
      const vulnerabilities = component.vulnerabilities ?? [];
      const severities = vulnerabilities.map((v) => SEVERITY_ORDER.indexOf(v.severity));
      const highest = severities.length > 0 ? SEVERITY_ORDER[Math.max(...severities)] : null;
      libraries.set(key, {
        component: component.component,
        version: component.version,
        vulnerabilities: vulnerabilities.length,
        highestSeverity: highest ?? null,
        cves: [...new Set(vulnerabilities.flatMap((v) => v.identifiers.CVE ?? []))],
        source,
      });
    }

    const list = [...libraries.values()];
    const vulnerableCount = list.filter((l) => (l.vulnerabilities as number) > 0).length;
    return {
      name: this.name,
      data: {
        scriptsScanned: scanned.length,
        libraries: list,
        vulnerableCount,
        hasVulnerableLibraries: vulnerableCount > 0,
      },
    };
  }
}
