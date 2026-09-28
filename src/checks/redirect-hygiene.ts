import type { Check, CheckContext } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { MAX_REDIRECTS, REDIRECT_STATUSES } from "../endpoint.js";
import { USER_AGENT, errorMessage } from "../utils.js";

interface Hop {
  url: string;
  status: number;
  /** Whether this HTTPS response sent Strict-Transport-Security. */
  hsts: boolean;
}

interface Chain {
  start: string;
  hops: Hop[];
  error: string | null;
}

/**
 * Walk a redirect chain by hand, recording each hop's status and whether it
 * sent HSTS. The inspected endpoint only keeps the final response's headers,
 * so this check fetches the plain-HTTP entry points itself.
 */
async function walk(start: string, signal: AbortSignal): Promise<Chain> {
  const hops: Hop[] = [];
  let current = start;
  try {
    for (;;) {
      const res = await fetch(current, {
        redirect: "manual",
        signal,
        headers: { "User-Agent": USER_AGENT },
      });
      await res.body?.cancel();
      const https = current.startsWith("https:");
      hops.push({
        url: current,
        status: res.status,
        hsts: https && res.headers.has("strict-transport-security"),
      });
      const location = res.headers.get("location");
      if (!REDIRECT_STATUSES.has(res.status) || !location) break;
      if (hops.length > MAX_REDIRECTS) {
        throw new Error(`Too many redirects (more than ${MAX_REDIRECTS})`);
      }
      current = new URL(location, current).href;
    }
    return { start, hops, error: null };
  } catch (err) {
    return { start, hops, error: errorMessage(err) };
  }
}

function hostOf(url: string): string {
  return new URL(url).hostname;
}

/**
 * How the site gets visitors from HTTP to HTTPS: whether the first redirect
 * upgrades to HTTPS on the same host (so HSTS is set before anything else, as
 * the HSTS preload list requires), and whether every HTTPS hop on the domain
 * sends HSTS.
 */
export class RedirectHygieneCheck implements Check {
  name = "redirect-hygiene";

  async run(_endpoint: EndpointData, domain: string, ctx?: CheckContext): Promise<CheckResult> {
    const timeout = AbortSignal.timeout(ctx?.timeoutMs ?? 10_000);
    const signal = ctx?.signal ? AbortSignal.any([timeout, ctx.signal]) : timeout;

    const chains = await Promise.all(
      [`http://${domain}/`, `http://www.${domain}/`].map((start) => walk(start, signal)),
    );
    const [apex] = chains;

    // Only a chain that starts with a redirect says anything about hygiene;
    // whether HTTP redirects at all is `properties.enforcesHttps`.
    const redirects = apex.hops.length > 1;
    const startHost = hostOf(apex.start);
    const firstHttps = apex.hops.findIndex((h) => h.url.startsWith("https:"));
    const beforeHttps = firstHttps === -1 ? apex.hops : apex.hops.slice(0, firstHttps);

    const onDomain = (url: string) => {
      const host = hostOf(url);
      return host === domain || host.endsWith(`.${domain}`);
    };
    const httpsHops = chains
      .flatMap((c) => c.hops)
      .filter((h) => h.url.startsWith("https:") && onDomain(h.url));
    const withoutHsts = [...new Set(httpsHops.filter((h) => !h.hsts).map((h) => h.url))];

    return {
      name: this.name,
      data: {
        // The first redirect goes straight to HTTPS on the same host.
        httpsFirst: redirects
          ? apex.hops[1].url.startsWith("https:") && hostOf(apex.hops[1].url) === startHost
          : null,
        crossHostBeforeHttps: redirects
          ? beforeHttps.some((h) => hostOf(h.url) !== startHost)
          : null,
        hstsOnAllHttpsHops: httpsHops.length ? withoutHsts.length === 0 : null,
        httpsHopsWithoutHsts: withoutHsts,
        chains,
      },
    };
  }
}
