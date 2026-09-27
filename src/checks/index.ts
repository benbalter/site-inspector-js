import type { Check, CheckContext } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { DnsCheck } from "./dns.js";
import { HeadersCheck } from "./headers.js";
import { HttpsCheck } from "./https.js";
import { HstsCheck } from "./hsts.js";
import { ContentCheck } from "./content.js";
import { CookiesCheck } from "./cookies.js";
import { SnifferCheck } from "./sniffer.js";
import { AccessibilityCheck } from "./accessibility.js";
import { WellKnownCheck } from "./well-known.js";
import { SriCheck } from "./sri.js";
import { MixedContentCheck } from "./mixed-content.js";
import { CarbonCheck } from "./carbon.js";
import { WhoisCheck } from "./whois.js";
import { CspCheck } from "./csp.js";
import { LighthouseCheck } from "./lighthouse.js";
import { RobotsCheck } from "./robots.js";
import { OpenGraphCheck } from "./opengraph.js";
import { DnsSecurityCheck } from "./dns-security.js";
import { PerformanceCheck } from "./performance.js";
import { StructuredDataCheck } from "./structured-data.js";
import { HstsPreloadCheck } from "./hsts-preload.js";
import { CorsCheck } from "./cors.js";
import { ReferrerPolicyCheck } from "./referrer-policy.js";
import { PermissionsPolicyCheck } from "./permissions-policy.js";
import { CacheHeadersCheck } from "./cache-headers.js";
import { TlsVersionsCheck } from "./tls-versions.js";
import { EmailSecurityCheck } from "./email-security.js";
import { DnssecCheck } from "./dnssec.js";
import { Ipv6Check } from "./ipv6.js";
import { GeoCheck } from "./geo.js";
import { CanonicalCheck } from "./canonical.js";
import { I18nCheck } from "./i18n.js";
import { MobileCheck } from "./mobile.js";
import { FaviconCheck } from "./favicon.js";
import { PrivacyCheck } from "./privacy.js";
import { A11yAxeCheck } from "./a11y-axe.js";
import { ApiDiscoveryCheck } from "./api-discovery.js";
import { PwaCheck } from "./pwa.js";

/** All available checks, keyed by name. */
const ALL_CHECKS: Check[] = [
  new DnsCheck(),
  new HeadersCheck(),
  new HttpsCheck(),
  new HstsCheck(),
  new ContentCheck(),
  new CookiesCheck(),
  new SnifferCheck(),
  new AccessibilityCheck(),
  new WellKnownCheck(),
  new SriCheck(),
  new MixedContentCheck(),
  new CarbonCheck(),
  new WhoisCheck(),
  new CspCheck(),
  new LighthouseCheck(),
  new RobotsCheck(),
  new OpenGraphCheck(),
  new DnsSecurityCheck(),
  new PerformanceCheck(),
  new StructuredDataCheck(),
  new HstsPreloadCheck(),
  new CorsCheck(),
  new ReferrerPolicyCheck(),
  new PermissionsPolicyCheck(),
  new CacheHeadersCheck(),
  new TlsVersionsCheck(),
  new EmailSecurityCheck(),
  new DnssecCheck(),
  new Ipv6Check(),
  new GeoCheck(),
  new CanonicalCheck(),
  new I18nCheck(),
  new MobileCheck(),
  new FaviconCheck(),
  new PrivacyCheck(),
  new A11yAxeCheck(),
  new ApiDiscoveryCheck(),
  new PwaCheck(),
];

/** Get the list of all available check names. */
export function availableChecks(): string[] {
  return ALL_CHECKS.map((c) => c.name);
}

/** Throw if any of `names` isn't a known check. */
export function assertKnownChecks(names: string[]): void {
  const valid = availableChecks();
  const unknown = names.filter((name) => !valid.includes(name));
  if (unknown.length > 0) throw new Error(`Unknown checks: ${unknown.join(", ")}`);
}

/** Default time budget for a single check, in milliseconds. */
export const DEFAULT_CHECK_TIMEOUT = 60_000;

/** Default time budget for a heavy check (Lighthouse, axe), in milliseconds. */
export const DEFAULT_HEAVY_CHECK_TIMEOUT = 180_000;

/** Options for {@link runChecks}. */
export interface RunChecksOptions {
  /** Request timeout passed to checks via their context (default 10s). */
  timeoutMs?: number;
  /** Maximum time any single check may run (default 60s, or 180s for heavy checks). */
  checkTimeoutMs?: number;
}

/**
 * Run one check, failing it with a timeout error if it exceeds its budget.
 * The check's signal is aborted so it can stop any work still in flight.
 */
async function runOne(
  check: Check,
  endpoint: EndpointData,
  domain: string,
  timeoutMs: number,
  checkTimeoutMs: number,
): Promise<CheckResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Timed out after ${checkTimeoutMs}ms`));
    }, checkTimeoutMs);
  });

  try {
    return await Promise.race([
      check.run(endpoint, domain, { timeoutMs, signal: controller.signal }),
      deadline,
    ]);
  } catch (err) {
    return {
      name: check.name,
      data: { error: err instanceof Error ? err.message : String(err) },
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run selected checks against an endpoint. Light checks run in parallel;
 * heavy ones (Chrome, jsdom) then run one at a time so they don't compete
 * for CPU and memory.
 * @param endpoint - The fetched endpoint data.
 * @param domain - The domain being inspected.
 * @param filter - Optional list of check names to run (default: all).
 * @param options - Timeouts.
 * @throws If `filter` names a check that doesn't exist.
 */
export async function runChecks(
  endpoint: EndpointData,
  domain: string,
  filter?: string[],
  options: RunChecksOptions = {},
): Promise<Record<string, CheckResult>> {
  const { timeoutMs = 10_000, checkTimeoutMs } = options;

  if (filter) assertKnownChecks(filter);

  const checks = filter ? ALL_CHECKS.filter((c) => filter.includes(c.name)) : ALL_CHECKS;
  const run = (c: Check) =>
    runOne(
      c,
      endpoint,
      domain,
      timeoutMs,
      checkTimeoutMs ?? (c.heavy ? DEFAULT_HEAVY_CHECK_TIMEOUT : DEFAULT_CHECK_TIMEOUT),
    );

  // Results are stored by registry position so the output keeps that order.
  const results: CheckResult[] = [];
  const indexed = checks.map((c, i) => ({ c, i }));
  await Promise.all(
    indexed.filter(({ c }) => !c.heavy).map(async ({ c, i }) => (results[i] = await run(c))),
  );
  for (const { c, i } of indexed.filter(({ c }) => c.heavy)) {
    results[i] = await run(c);
  }

  return Object.fromEntries(checks.map((c, i) => [c.name, results[i]]));
}

export type { Check, CheckContext };
