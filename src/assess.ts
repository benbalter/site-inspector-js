import type { InspectionResult } from "./types.js";
import { fieldLabel } from "./labels.js";

/**
 * A verdict for a single field: whether it is good, needs attention, is a
 * neutral fact carrying no judgment, or doesn't apply to this site (e.g. HSTS
 * on a site without HTTPS).
 */
export type Severity = "pass" | "attention" | "neutral" | "not-applicable";

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
  "properties.serverError": "negative",
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
  "dns-security.spf.multipleRecords": "negative",
  "dns-security.dmarc.exists": "positive-bonus",
  "dns-security.dmarc.strongPolicy": "positive-bonus",
  "dnssec.enabled": "positive-bonus",
  "email-security.bimi.exists": "positive-bonus",
  "email-security.mtaSts.exists": "positive-bonus",
  "email-security.tlsRpt.exists": "positive-bonus",

  // privacy
  "privacy.hasPrivacyPolicy": "positive-bonus",
  "privacy.hasCookiePolicy": "positive-bonus",
  "privacy.gpcSupported": "positive-bonus",

  // infrastructure
  "ipv6.hasIpv6": "positive-bonus",
  "ipv6.dualStack": "positive-bonus",

  // content & SEO
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
  "csp.highSeverityCount": zeroPasses,
  // Letter grades: A/B pass, D/F need attention, C is unremarkable.
  "cache-headers.grade": gradeSeverity,
  "mobile.grade": gradeSeverity,
  // Browsers only trust HSTS long enough to matter at six months or more.
  "hsts.maxAge": (v) =>
    typeof v === "number" && v > 0 ? (v >= SIX_MONTHS ? "pass" : "attention") : "neutral",
  // Graded even when absent (null): a missing nosniff is the finding.
  "headers.xContentTypeOptions": (v) =>
    typeof v === "string" && v.trim().toLowerCase() === "nosniff" ? "pass" : "attention",
  "referrer-policy.strictness": (v) =>
    v === "loose" ? "attention" : v === "strict" || v === "moderate" ? "pass" : "neutral",
  // A DMARC pct below 100 leaves some spoofed mail unenforced.
  "dns-security.dmarc.percentage": (v) =>
    typeof v === "number" ? (v < 100 ? "attention" : "pass") : "neutral",
  "email-security.mtaSts.mode": (v) => (v === "enforce" ? "pass" : "neutral"),
  "whois.expiresIn": (v) => (typeof v === "number" && v < 30 ? "attention" : "neutral"),
  "a11y-axe.critical": zeroPasses,
  "a11y-axe.serious": zeroPasses,
  "lighthouse.scores.performance": lighthouseScore,
  "lighthouse.scores.accessibility": lighthouseScore,
  "lighthouse.scores.bestPractices": lighthouseScore,
  "lighthouse.scores.seo": lighthouseScore,
};

const SIX_MONTHS = 15_552_000;

function zeroPasses(value: unknown): Severity {
  if (typeof value !== "number") return "neutral";
  return value > 0 ? "attention" : "pass";
}

/** Lighthouse's own bands: 90+ is good, under 50 is poor. */
function lighthouseScore(value: unknown): Severity {
  if (typeof value !== "number") return "neutral";
  if (value >= 90) return "pass";
  return value < 50 ? "attention" : "neutral";
}

/**
 * Fields that repeat a signal another check owns, keyed by the duplicate and
 * pointing at the owner. The duplicate is left ungraded so one missing thing
 * counts once.
 */
export const DUPLICATE_OF: Record<string, string> = {
  "accessibility.viewport": "mobile.hasViewport",
  "dns.ipv6": "ipv6.hasIpv6",
  "content.robotsTxt": "robots.exists",
  "well-known.mtaSts": "email-security.mtaSts.exists",
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
  /** The field's value: booleans always, others when a rule grades them. */
  value: boolean | number | string | null;
  severity: Severity;
  /** Why the verdict differs from the field on its own (e.g. not applicable). */
  note?: string;
}

/**
 * A conclusion drawn from several fields, possibly across checks, that no
 * single field shows on its own (e.g. "email can be spoofed").
 */
export interface Insight {
  id: string;
  /** The check the insight is shown with. */
  check: string;
  title: string;
  severity: "pass" | "attention";
  /** What to do about it, or the specifics behind it. */
  detail: string;
  /** The `"check.path"` keys the conclusion rests on. */
  because: string[];
}

/** The result of assessing an entire inspection. */
export interface Assessment {
  /** Every graded field found: all booleans, plus values a rule grades. */
  findings: Finding[];
  /** Conclusions drawn across fields and checks. */
  insights: Insight[];
  /** Just the findings that need attention. */
  attention: Finding[];
  /** Count of findings and insights needing attention. */
  attentionCount: number;
  /** Attention count (findings and insights) keyed by check name (or `"properties"`). */
  attentionByCheck: Record<string, number>;
  /** Each finding's verdict in context, keyed by `"check.path"`. */
  severities: Record<string, Severity>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const path = keys.join(".");
  const graded = `${check}.${path}` in VALUE_RULES;
  if (
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string" ||
    // An absent value is a finding only where a rule grades absence.
    (value == null && graded)
  ) {
    const severity = assessField(check, path, value);
    // Booleans are always findings; non-booleans only when a rule graded them.
    if (typeof value === "boolean" || severity !== "neutral") {
      out.push({
        check,
        path,
        label: keys.map(fieldLabel).join(" · "),
        value: value ?? null,
        severity,
      });
    }
  }
}

/** Read a nested field of a check's data; `undefined` if the check or field is missing. */
function field(result: InspectionResult, check: string, path: string): unknown {
  let value: unknown = check === "properties" ? result.properties : result.checks[check]?.data;
  for (const key of path.split(".")) {
    if (!isPlainObject(value)) return undefined;
    value = value[key];
  }
  return value;
}

/** A check's data, or `undefined` if it didn't run or failed. */
function checkData(result: InspectionResult, check: string): Record<string, unknown> | undefined {
  const data = result.checks[check]?.data;
  return isPlainObject(data) && data.error === undefined ? data : undefined;
}

/**
 * A verdict that depends on the rest of the result. When `when` returns true,
 * findings matching `keys` (exact, or prefix when ending in ".") that currently
 * have one of the `replaces` severities become `severity`. `when` returns
 * `undefined` when it can't tell (a check failed or didn't run), which leaves
 * findings as they are.
 */
interface ContextRule {
  keys: string[];
  when: (result: InspectionResult) => boolean | undefined;
  severity: Severity;
  replaces: Severity[];
  note: string;
}

function hasMx(result: InspectionResult): boolean | undefined {
  const mx = checkData(result, "dns")?.mx;
  if (!Array.isArray(mx)) return undefined;
  // A null MX (RFC 7505, "0 .") resolves to an empty exchange: no mail accepted.
  return mx.some((r) => isPlainObject(r) && typeof r.exchange === "string" && r.exchange !== "");
}

const CONTEXT_RULES: ContextRule[] = [
  {
    keys: ["https.", "tls-versions.", "hsts.", "hsts-preload.", "mixed-content."],
    when: (r) => !r.properties.https,
    severity: "not-applicable",
    replaces: ["attention", "neutral"],
    note: "Not applicable: the site doesn't serve HTTPS.",
  },
  {
    keys: ["cookies.allSecure", "cookies.allHttpOnly"],
    when: (r) => {
      const has = checkData(r, "cookies")?.hasCookies;
      return typeof has === "boolean" ? !has : undefined;
    },
    severity: "not-applicable",
    replaces: ["pass", "attention", "neutral"],
    note: "Not applicable: the site sets no cookies.",
  },
  {
    keys: ["email-security.mtaSts.", "email-security.tlsRpt."],
    when: (r) => {
      const mx = hasMx(r);
      return mx === undefined ? undefined : !mx;
    },
    severity: "not-applicable",
    replaces: ["attention", "neutral"],
    note: "Not applicable: the domain doesn't receive mail (no MX records).",
  },
  {
    // CSP frame-ancestors supersedes X-Frame-Options.
    keys: ["headers.clickjackingProtection"],
    when: (r) => {
      const csp = checkData(r, "headers")?.contentSecurityPolicy;
      if (typeof csp !== "string") return undefined;
      return /(^|;)\s*frame-ancestors\s/i.test(csp);
    },
    severity: "pass",
    replaces: ["attention"],
    note: "Protected by the CSP frame-ancestors directive.",
  },
];

function matches(rule: ContextRule, key: string): boolean {
  return rule.keys.some((k) => (k.endsWith(".") ? key.startsWith(k) : key === k));
}

function applyContext(result: InspectionResult, findings: Finding[]): void {
  for (const rule of CONTEXT_RULES) {
    if (rule.when(result) !== true) continue;
    for (const f of findings) {
      if (rule.replaces.includes(f.severity) && matches(rule, `${f.check}.${f.path}`)) {
        f.severity = rule.severity;
        f.note = rule.note;
      }
    }
  }
}

type InsightRule = (result: InspectionResult) => Insight | undefined;

const INSIGHT_RULES: InsightRule[] = [
  // SPF says who may send; DMARC tells receivers to reject what fails. Without
  // both, anyone can send mail that appears to come from this domain.
  (r) => {
    const data = checkData(r, "dns-security");
    const spf = data?.spf;
    const dmarc = data?.dmarc;
    if (!isPlainObject(spf) || !isPlainObject(dmarc)) return undefined;
    if (spf.error || dmarc.error) return undefined;
    const base = {
      id: "email-spoofing",
      check: "dns-security",
      because: [
        "dns-security.spf.exists",
        "dns-security.dmarc.exists",
        "dns-security.dmarc.strongPolicy",
      ],
    };
    if (spf.exists && dmarc.strongPolicy) {
      return {
        ...base,
        title: "Protected against email spoofing",
        severity: "pass",
        detail: "SPF is published and DMARC tells receivers to quarantine or reject forged mail.",
      };
    }
    if (!spf.exists || !dmarc.exists || dmarc.policy === "none") {
      return {
        ...base,
        title: "Email from this domain can be spoofed",
        severity: "attention",
        detail:
          "Publish an SPF record and a DMARC policy of quarantine or reject. " +
          "Domains that send no mail should use 'v=spf1 -all' and 'p=reject'.",
      };
    }
    return undefined;
  },
  (r) => {
    const expires = field(r, "well-known", "securityTxt.expires");
    if (field(r, "well-known", "securityTxt.present") !== true || typeof expires !== "string") {
      return undefined;
    }
    const at = Date.parse(expires);
    if (Number.isNaN(at) || at >= Date.parse(r.inspectedAt)) return undefined;
    return {
      id: "security-txt-expired",
      check: "well-known",
      title: "security.txt has expired",
      severity: "attention",
      detail: `Its Expires field (${expires}) has passed, so researchers should treat it as stale (RFC 9116).`,
      because: ["well-known.securityTxt.expires"],
    };
  },
  (r) => {
    const errors = field(r, "hsts-preload", "errors");
    if (field(r, "hsts", "preload") !== true || field(r, "hsts-preload", "preloaded") !== false) {
      return undefined;
    }
    if (!Array.isArray(errors) || errors.length === 0) return undefined;
    const reasons = errors
      .map((e) => (isPlainObject(e) ? (e.summary ?? e.message) : undefined))
      .filter((s): s is string => typeof s === "string");
    return {
      id: "hsts-preload-blocked",
      check: "hsts-preload",
      title: "HSTS preload requested but blocked",
      severity: "attention",
      detail: `The header asks to be preloaded, but hstspreload.org reports: ${reasons.join("; ")}.`,
      because: ["hsts.preload", "hsts-preload.preloaded", "hsts-preload.errors"],
    };
  },
];

/**
 * Assess an entire inspection result, producing per-field verdicts in context,
 * cross-check insights, and an "items needing attention" rollup. Consumers
 * (CLI, web UI) use this to color output and to filter to just what's wrong.
 */
export function assess(result: InspectionResult): Assessment {
  const findings: Finding[] = [];

  walk("properties", [], result.properties, findings);
  for (const check of Object.values(result.checks)) {
    walk(check.name, [], check.data, findings);
  }
  applyContext(result, findings);

  const insights = INSIGHT_RULES.map((rule) => rule(result)).filter(
    (i): i is Insight => i !== undefined,
  );

  const attention = findings.filter((f) => f.severity === "attention");
  const attentionByCheck: Record<string, number> = {};
  for (const { check } of [...attention, ...insights.filter((i) => i.severity === "attention")]) {
    attentionByCheck[check] = (attentionByCheck[check] ?? 0) + 1;
  }
  const severities: Record<string, Severity> = {};
  for (const f of findings) severities[`${f.check}.${f.path}`] = f.severity;

  return {
    findings,
    insights,
    attention,
    attentionCount: Object.values(attentionByCheck).reduce((sum, n) => sum + n, 0),
    attentionByCheck,
    severities,
  };
}

/**
 * A field's verdict in the context of the whole result, falling back to the
 * context-free {@link assessField} for fields `assess()` didn't record (such
 * as fields inside arrays).
 */
export function severityOf(
  assessment: Assessment,
  check: string,
  path: string,
  value: unknown,
): Severity {
  return assessment.severities[`${check}.${path}`] ?? assessField(check, path, value);
}

// Labels and units live in labels.ts; re-exported so front ends get all
// presentation metadata from the dependency-free `site-inspector/assess`.
export {
  PROPERTY_LABELS,
  FIELD_UNITS,
  fieldLabel,
  formatFieldValue,
  titleCase,
  type Unit,
} from "./labels.js";
export { CHECK_CATEGORIES, CHECK_LABELS, checkLabel, type CheckCategory } from "./categories.js";
