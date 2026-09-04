import type { InspectionResult } from "./types.js";

/**
 * A verdict for a single field: whether it is good, needs attention, or is a
 * neutral fact carrying no judgment.
 */
export type Severity = "pass" | "attention" | "neutral";

/**
 * How a boolean field's value maps to a verdict:
 * - `positive-required`: true is good, false needs attention (e.g. a valid cert).
 * - `positive-bonus`: true is good, false is merely absent — not a failing
 *   (e.g. IPv6 support, an API surface).
 * - `negative`: true needs attention, false is good (e.g. mixed content).
 *
 * Any field NOT listed in {@link POLARITY} is treated as neutral and is never
 * colored — this is deliberate: we curate judgments rather than guess from
 * field names, so a red/attention marker always means something.
 */
type Polarity = "positive-required" | "positive-bonus" | "negative";

/**
 * Curated per-field polarity, keyed by `"<check>.<dotted-path>"`. Domain
 * properties use the pseudo-check name `"properties"`.
 *
 * Where a check already emits its own verdict (e.g. `strongPolicy`,
 * `expiringSoon`, `misconfigured`), we anchor on that rather than re-deriving.
 */
const POLARITY: Record<string, Polarity> = {
  // Domain properties
  "properties.up": "positive-required",
  "properties.https": "positive-required",
  "properties.enforcesHttps": "positive-bonus",
  "properties.downgradesHttps": "negative",
  "properties.canonicallyHttps": "positive-bonus",
  "properties.redirect": "negative",

  // https / TLS certificate
  "https.valid": "positive-required",
  "https.expiringSoon": "negative",
  "https.chainComplete": "positive-required",

  // hsts
  "hsts.enabled": "positive-required",
  "hsts.includeSubDomains": "positive-bonus",
  "hsts.preload": "positive-bonus",
  "hsts.preloadReady": "positive-bonus",
  "hsts-preload.preloaded": "positive-bonus",

  // headers / csp
  "headers.clickjackingProtection": "positive-required",
  "csp.hasCsp": "positive-required",

  // cookies
  "cookies.allSecure": "positive-bonus",
  "cookies.allHttpOnly": "positive-bonus",

  // transport / content mixing
  "mixed-content.hasMixedContent": "negative",
  "tls-versions.supported.TLSv1": "negative",
  "tls-versions.supported.TLSv1.1": "negative",
  "tls-versions.supported.TLSv1.2": "positive-bonus",
  "tls-versions.supported.TLSv1.3": "positive-bonus",
  "tls-versions.hasDeprecated": "negative",
  "tls-versions.tls13": "positive-bonus",

  // cross-origin
  "cors.misconfigured": "negative",
  "cors.wildcard": "negative",

  // policies
  "referrer-policy.present": "positive-bonus",
  "permissions-policy.present": "positive-bonus",

  // DNS / email security
  "dns-security.spf.exists": "positive-bonus",
  "dns-security.spf.strongPolicy": "positive-bonus",
  "dns-security.dmarc.exists": "positive-bonus",
  "dns-security.dmarc.strongPolicy": "positive-bonus",
  "dnssec.enabled": "positive-bonus",
  "email-security.bimi.exists": "positive-bonus",
  "email-security.mtaSts.exists": "positive-bonus",
  "email-security.tlsRpt.exists": "positive-bonus",

  // privacy
  "privacy.hasPrivacyPolicy": "positive-bonus",
  "privacy.hasCookiePolicy": "positive-bonus",

  // infrastructure
  "dns.ipv6": "positive-bonus",
  "ipv6.hasIpv6": "positive-bonus",
  "ipv6.dualStack": "positive-bonus",

  // content & SEO
  "content.robotsTxt": "positive-bonus",
  "content.sitemapXml": "positive-bonus",
  "canonical.noindex": "negative",
  "canonical.conflict": "negative",
  "opengraph.socialReady": "positive-bonus",
  "structured-data.hasJsonLd": "positive-bonus",
  "robots.exists": "positive-bonus",
  "robots.blocksGooglebot": "negative",
  "robots.blocksAll": "negative",
  "favicon.present": "positive-bonus",
  "well-known.securityTxt.present": "positive-bonus",
  "api-discovery.hasApi": "positive-bonus",

  // performance
  "cache-headers.etag": "positive-bonus",
  "cache-headers.lastModified": "positive-bonus",
  "performance.compressed": "positive-bonus",

  // mobile / pwa
  "mobile.hasViewport": "positive-required",
  "pwa.hasManifest": "positive-bonus",
  "pwa.hasServiceWorker": "positive-bonus",
  "pwa.installable": "positive-bonus",

  // accessibility
  "accessibility.htmlLang": "positive-required",
  "accessibility.viewport": "positive-required",
  "accessibility.hasH1": "positive-required",
  "accessibility.isSequential": "positive-bonus",
};

/**
 * Curated rules for non-boolean fields where the engine already computes a real
 * verdict (severity counts, letter grades). Keyed like {@link POLARITY}. These
 * are the richest "what's wrong" signals — e.g. a present-but-misconfigured CSP
 * would otherwise pass as green.
 */
const VALUE_RULES: Record<string, (value: unknown) => Severity> = {
  // A CSP with high-severity findings needs attention even though it exists.
  "csp.highSeverityCount": (v) => (typeof v === "number" && v > 0 ? "attention" : "pass"),
  // Letter grades: A/B pass, D/F need attention, C is unremarkable.
  "cache-headers.grade": gradeSeverity,
  "mobile.grade": gradeSeverity,
};

function gradeSeverity(value: unknown): Severity {
  if (typeof value !== "string") return "neutral";
  if (/^[AB]/i.test(value)) return "pass";
  if (/^[DF]/i.test(value)) return "attention";
  return "neutral";
}

/**
 * Assess a single field. Booleans use the curated {@link POLARITY} table;
 * a few non-boolean fields use {@link VALUE_RULES} (severity counts, grades).
 * Anything else — or any unlisted field — is `neutral` (never colored). This is
 * deliberate: we curate judgments rather than guess, so a colored marker always
 * means something.
 *
 * @param check - The check name (or `"properties"` for domain properties).
 * @param path - The dotted path of the field within the check's data.
 * @param value - The field value.
 */
export function assessField(check: string, path: string, value: unknown): Severity {
  const key = `${check}.${path}`;
  if (typeof value === "boolean") {
    const polarity = POLARITY[key];
    if (!polarity) return "neutral";
    switch (polarity) {
      case "positive-required":
        return value ? "pass" : "attention";
      case "positive-bonus":
        return value ? "pass" : "neutral";
      case "negative":
        return value ? "attention" : "pass";
    }
  }
  const rule = VALUE_RULES[key];
  return rule ? rule(value) : "neutral";
}

/** A single assessed boolean field within an inspection result. */
export interface Finding {
  /** Check name, or `"properties"` for domain properties. */
  check: string;
  /** Dotted path of the field within the check's data. */
  path: string;
  /** Human-readable label (e.g. `"SPF · Strong Policy"`). */
  label: string;
  value: boolean | number | string;
  severity: Severity;
}

/** The result of assessing an entire inspection. */
export interface Assessment {
  /** Every graded boolean field found. */
  findings: Finding[];
  /** Just the findings that need attention. */
  attention: Finding[];
  /** Count of findings needing attention. */
  attentionCount: number;
  /** Attention count keyed by check name (or `"properties"`). */
  attentionByCheck: Record<string, number>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function titleCase(s: string): string {
  return s
    .replace(/[-_]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function walk(check: string, keys: string[], value: unknown, out: Finding[]): void {
  // Recurse into plain nested objects only; array items are left ungraded to
  // avoid path explosion (their aggregates, e.g. cookies.allSecure, are graded).
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      walk(check, [...keys, k], v, out);
    }
    return;
  }
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    const path = keys.join(".");
    const severity = assessField(check, path, value);
    // Booleans are always findings; non-booleans only when a rule graded them.
    if (typeof value === "boolean" || severity !== "neutral") {
      out.push({
        check,
        path,
        label: keys.map(titleCase).join(" · "),
        value,
        severity,
      });
    }
  }
}

/**
 * Assess an entire inspection result, producing per-field verdicts and an
 * "items needing attention" rollup. Consumers (CLI, web UI) use this to color
 * output and to filter to just what's wrong.
 */
export function assess(result: InspectionResult): Assessment {
  const findings: Finding[] = [];

  walk("properties", [], result.properties, findings);
  for (const check of Object.values(result.checks)) {
    walk(check.name, [], check.data, findings);
  }

  const attention = findings.filter((f) => f.severity === "attention");
  const attentionByCheck: Record<string, number> = {};
  for (const f of attention) {
    attentionByCheck[f.check] = (attentionByCheck[f.check] ?? 0) + 1;
  }

  return {
    findings,
    attention,
    attentionCount: attention.length,
    attentionByCheck,
  };
}
