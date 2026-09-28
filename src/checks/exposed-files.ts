import type { Check, CheckContext } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { isCatchAll, parseHtml, safeFetch, type FetchResult } from "../utils.js";

const HTML_LIKE = /<\s*(!doctype|html|head|body)\b/i;

function isHtml(res: FetchResult): boolean {
  return /html/i.test(res.headers["content-type"] ?? "") || HTML_LIKE.test(res.body.slice(0, 2048));
}

/**
 * A path and the content signature that proves the file is really there.
 * Signatures matter more than status codes: soft-404 pages answer 200.
 */
interface Probe {
  /** Field name in the result (paths contain dots, which assess.ts can't address). */
  key: string;
  path: string;
  matches(res: FetchResult, catchAll: boolean): boolean;
}

const PROBES: Probe[] = [
  {
    key: "gitHead",
    path: "/.git/HEAD",
    matches: (res) => /^ref: refs\//.test(res.body) || /^[0-9a-f]{40}\s*$/.test(res.body),
  },
  {
    key: "env",
    path: "/.env",
    matches: (res) => !isHtml(res) && /^[A-Z][A-Z0-9_]*=/m.test(res.body),
  },
  {
    key: "dsStore",
    path: "/.DS_Store",
    // Magic bytes 00 00 00 01 "Bud1"; all ASCII, so they survive UTF-8 decoding.
    matches: (res) => res.body.startsWith("\0\0\0\u0001Bud1"),
  },
  {
    key: "serverStatus",
    path: "/server-status",
    matches: (res) => res.body.includes("Apache Server Status"),
  },
  {
    key: "svnEntries",
    path: "/.svn/entries",
    matches: (res, catchAll) => {
      // Pre-1.4 XML format, or the text format: a version line, blank, "dir".
      if (/<wc-entries\b/.test(res.body) || /^\d+\s*\n\s*\n\s*dir\s*\n/.test(res.body)) {
        return true;
      }
      // SVN 1.7+ leaves only the format number. That's too weak to trust
      // from a server that answers every path.
      return !catchAll && /^\d{1,2}\s*$/.test(res.body);
    },
  },
  {
    key: "wpConfigBackup",
    path: "/wp-config.php.bak",
    matches: (res) => /define\s*\(\s*['"]DB_(NAME|PASSWORD|USER)['"]/.test(res.body),
  },
];

/** Paths probed, keyed by their result field. */
export const EXPOSED_FILES: Record<string, string> = Object.fromEntries(
  PROBES.map((p) => [p.key, p.path]),
);

export class ExposedFilesCheck implements Check {
  name = "exposed-files";

  async run(endpoint: EndpointData, _domain: string, ctx?: CheckContext): Promise<CheckResult> {
    const timeoutMs = ctx?.timeoutMs ?? 5000;
    const origin = new URL(endpoint.finalUrl || endpoint.url).origin;

    const title = parseHtml(endpoint)("title").first().text().trim();
    const directoryListing = /^Index of \//i.test(title);

    const [catchAll, ...responses] = await Promise.all([
      isCatchAll(origin, timeoutMs),
      ...PROBES.map((p) => safeFetch(`${origin}${p.path}`, timeoutMs)),
    ]);

    // Only the verdict leaves this function, never the fetched contents.
    const files: Record<string, boolean | null> = {};
    const exposed: string[] = [];
    PROBES.forEach((probe, i) => {
      const res = responses[i];
      const found =
        ctx?.signal.aborted || !res ? null : res.statusCode === 200 && probe.matches(res, catchAll);
      files[probe.key] = found;
      if (found) exposed.push(probe.path);
    });

    return {
      name: this.name,
      data: {
        files,
        exposed,
        exposedCount: exposed.length,
        directoryListing,
        catchAll,
      },
    };
  }
}
