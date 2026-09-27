import type { APIRoute } from "astro";
import { inspect, availableChecks } from "site-inspector";
import { HEAVY_CHECKS } from "../../lib/checkGroups";
import {
  installFetchGuard,
  isValidHostname,
  publicMode,
  resolvesToPublicAddresses,
} from "../../lib/network";

export const prerender = false;

installFetchGuard();

const DEFAULT_TIMEOUT = 15_000;
const MIN_TIMEOUT = 1_000;
const MAX_TIMEOUT = 30_000;

// Heavy checks launch headless Chrome or jsdom; run at most one such job at a time.
let heavyJobRunning = false;

interface InspectBody {
  domain?: unknown;
  checks?: unknown;
  timeout?: unknown;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Reduce user input like "https://Example.com/path" to a bare lowercase hostname. */
function toHostname(input: string): string {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `http://${input}`;
  try {
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export const POST: APIRoute = async ({ request }) => {
  let body: InspectBody;
  try {
    body = (await request.json()) as InspectBody;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const raw = typeof body.domain === "string" ? body.domain.trim() : "";
  if (!raw) {
    return json({ error: "A domain is required." }, 400);
  }
  const domain = toHostname(raw);
  if (!isValidHostname(domain)) {
    return json({ error: "Enter a public domain name, like example.com." }, 400);
  }
  if (!(await resolvesToPublicAddresses(domain))) {
    return json({ error: "That domain resolves to a private or reserved address." }, 400);
  }

  // Validate requested checks against the engine's actual registry.
  const valid = availableChecks();
  let checks: string[] | undefined;
  if (body.checks !== undefined) {
    if (!Array.isArray(body.checks)) {
      return json({ error: "checks must be an array of check names." }, 400);
    }
    checks = body.checks.filter((c): c is string => typeof c === "string");
    if (checks.length === 0) {
      return json({ error: "Select at least one check." }, 400);
    }
    const invalid = checks.filter((c) => !valid.includes(c));
    if (invalid.length > 0) {
      return json({ error: `Unknown checks: ${invalid.join(", ")}` }, 400);
    }
  }

  // Heavy checks drive a browser/jsdom that bypasses the fetch guard, so they
  // are only available when the app is running locally.
  const heavy = (checks ?? valid).filter((c) =>
    (HEAVY_CHECKS as readonly string[]).includes(c),
  );
  if (heavy.length > 0 && publicMode()) {
    return json({ error: `Unavailable in public mode: ${heavy.join(", ")}` }, 400);
  }
  if (heavy.length > 0 && heavyJobRunning) {
    return json({ error: "A slow inspection is already running. Try again shortly." }, 429);
  }

  const timeout =
    typeof body.timeout === "number" && Number.isFinite(body.timeout)
      ? Math.min(MAX_TIMEOUT, Math.max(MIN_TIMEOUT, body.timeout))
      : DEFAULT_TIMEOUT;

  if (heavy.length > 0) heavyJobRunning = true;
  try {
    const result = await inspect(domain, { checks, timeout });
    return json(result);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  } finally {
    if (heavy.length > 0) heavyJobRunning = false;
  }
};
