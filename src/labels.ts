// Presentation metadata shared by every front end: human-readable labels for
// check fields and domain properties, and units for numeric fields. Kept
// dependency-free so browser bundles can import it via `site-inspector/assess`.

import type { Severity } from "./assess.js";

/** Display labels for the domain properties, in display order. */
export const PROPERTY_LABELS: Record<string, string> = {
  up: "Up",
  https: "HTTPS",
  enforcesHttps: "Enforces HTTPS",
  downgradesHttps: "Downgrades HTTPS",
  www: "WWW",
  root: "Root",
  canonicallyWww: "Canonically WWW",
  canonicallyHttps: "Canonically HTTPS",
  serverError: "Server Error",
  redirect: "External Redirect",
};

/**
 * The glyph for a verdict. It shows the verdict, not the field's value, so
 * "Downgrades HTTPS: no" gets a ✓: the glyph always answers "is this good?".
 */
export function verdictGlyph(severity: Severity): string {
  switch (severity) {
    case "pass":
      return "✓";
    case "attention":
      return "✗";
    case "not-applicable":
      return "–";
    default:
      return "·";
  }
}

/** A boolean field as text: its label when true, "<label>: no" when false. */
export function booleanText(label: string, value: boolean): string {
  return value ? label : `${label}: no`;
}

/** Turn a field or check name like `dns-security` or `allSecure` into a label. */
export function titleCase(s: string): string {
  return s
    .replace(/[-_]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Field keys whose label can't be derived from the key. */
const KEY_LABELS: Record<string, string> = {
  tls13: "TLS 1.3",
  p3p: "P3P",
  hasXDefault: "Has x-default",
  ll: "Coordinates",
  dir: "Text Direction",
  fingerprint256: "SHA-256 Fingerprint",
  xFrameOptions: "X-Frame-Options",
  xContentTypeOptions: "X-Content-Type-Options",
  xXssProtection: "X-XSS-Protection",
  sMaxAge: "s-maxage",
  swRegistrationInHtml: "Service Worker Registered in HTML",
  responseTimeMs: "Response Time",
  contentLengthBytes: "Transfer Size",
  decodedBytes: "Decoded Size",
  htmlSize: "HTML Size",
  htmlSizeKb: "HTML Size (KB)",
  adFlag: "Validated (AD Flag)",
  coop: "COOP",
  coopRaw: "COOP Header",
  coopPresent: "Has COOP",
  coopReportOnly: "COOP (Report-Only)",
  coopReportOnlyPresent: "Has COOP Report-Only",
  coep: "COEP",
  coepRaw: "COEP Header",
  coepPresent: "Has COEP",
  coepReportOnly: "COEP (Report-Only)",
  coepReportOnlyPresent: "Has COEP Report-Only",
  corp: "CORP",
  corpRaw: "CORP Header",
  corpPresent: "Has CORP",
  isolated: "Cross-Origin Isolated",
  nel: "NEL",
  nelPresent: "Has NEL",
  nelError: "NEL Error",
  nelGroupDefined: "NEL Group Declared",
  cspReportUri: "CSP report-uri",
  cspReportTo: "CSP report-to",
  cspReportOnlyReportUri: "CSP Report-Only report-uri",
  cspReportOnlyReportTo: "CSP Report-Only report-to",
  http2: "HTTP/2",
  http3Advertised: "HTTP/3 Advertised",
  http3Protocols: "HTTP/3 Protocols",
  http3MaxAge: "HTTP/3 Max Age",
  alpnProtocol: "ALPN Protocol",
  altSvc: "Alt-Svc",
  allStarttls: "All Offer STARTTLS",
  starttls: "STARTTLS",
  mx: "MX",
  hasMx: "Has MX",
  nullMx: "Null MX",
  minRsaKeyBits: "Smallest RSA Key",
  hasActiveKey: "Active Key Found",
  httpsFirst: "Upgrades to HTTPS First",
  crossHostBeforeHttps: "Changes Host Before HTTPS",
  hstsOnAllHttpsHops: "HSTS on Every HTTPS Hop",
  httpsHopsWithoutHsts: "HTTPS Hops Without HSTS",
  keyBits: "Key Size",
  staticRsaAccepted: "Static RSA Accepted",
  cbcAccepted: "CBC Suites Accepted",
  tripleDesAccepted: "3DES Accepted",
  forwardSecrecyOnly: "Forward Secrecy Only",
  gitHead: ".git/HEAD",
  env: ".env",
  dsStore: ".DS_Store",
  serverStatus: "server-status",
  svnEntries: ".svn/entries",
  wpConfigBackup: "wp-config.php backup",
  adsTxt: "ads.txt",
  appAdsTxt: "app-ads.txt",
  asn: "ASN",
  validatingRoas: "Validating ROAs",
  ipv6: "IPv6",
  co2GramsPerView: "CO₂ per View (HTML only)",
  co2GramsPerViewGreenHosting: "CO₂ per View on Green Hosting (HTML only)",
  co2Model: "CO₂ Model",
  co2Scope: "CO₂ Scope",
  co2Error: "CO₂ Error",
  insecureRequests: "Insecure Requests (Runtime)",
  insecureRequestCount: "Insecure Request Count (Runtime)",
};

/** Words that title-casing gets wrong: acronyms and product names. */
const WORD_FIXES: Record<string, string> = {
  Aaaa: "AAAA",
  Ad: "AD",
  Api: "API",
  Bimi: "BIMI",
  Caa: "CAA",
  Cdn: "CDN",
  Csp: "CSP",
  Dmarc: "DMARC",
  Dnskey: "DNSKEY",
  Dns: "DNS",
  Dnt: "DNT",
  Ds: "DS",
  Etag: "ETag",
  Gpc: "GPC",
  Html: "HTML",
  Http: "HTTP",
  Https: "HTTPS",
  Ip: "IP",
  Ipv4: "IPv4",
  Ipv6: "IPv6",
  Json: "JSON",
  Kb: "KB",
  Mta: "MTA",
  Mx: "MX",
  Og: "OG",
  Openid: "OpenID",
  Rrsig: "RRSIG",
  Seo: "SEO",
  Spf: "SPF",
  Sri: "SRI",
  Svg: "SVG",
  Tls: "TLS",
  Uri: "URI",
  Url: "URL",
  Xss: "XSS",
};

/** Multi-word fixes, applied after the word fixes. */
const PHRASE_FIXES: [RegExp, string][] = [
  [/\bGraph QL\b/, "GraphQL"],
  [/\bOpen API\b/, "OpenAPI"],
  [/\bOpen Search\b/, "OpenSearch"],
  [/\bJSON Ld\b/, "JSON-LD"],
  [/\bMTA Sts\b/, "MTA-STS"],
  [/\bTLS Rpt\b/, "TLS-RPT"],
  [/\bSub Domains\b/, "Subdomains"],
  [/\bSitemap Xml\b/, "sitemap.xml"],
  [/\bFavicon Ico\b/, "favicon.ico"],
];

/** Human-readable label for a check field, e.g. `hasGraphQL` → "Has GraphQL". */
export function fieldLabel(key: string): string {
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  let label = titleCase(key)
    .split(" ")
    .map((word) => WORD_FIXES[word] ?? word)
    .join(" ");
  for (const [pattern, replacement] of PHRASE_FIXES) label = label.replace(pattern, replacement);
  // File names: "Robots Txt" → "robots.txt"
  return label.replace(/\b(Robots|Humans|Security) Txt\b/, (_m, name: string) => {
    return `${name.toLowerCase()}.txt`;
  });
}

/** The unit of a numeric field, for formatting. */
export type Unit = "bytes" | "ms" | "seconds" | "days";

/** Units for numeric fields, keyed by `check.path`. Unlisted numbers are plain. */
export const FIELD_UNITS: Record<string, Unit> = {
  "performance.responseTimeMs": "ms",
  "performance.contentLengthBytes": "bytes",
  "performance.decodedBytes": "bytes",
  "carbon.htmlSize": "bytes",
  "hsts.maxAge": "seconds",
  "cache-headers.maxAge": "seconds",
  "cache-headers.sMaxAge": "seconds",
  "cache-headers.age": "seconds",
  "robots.crawlDelay": "seconds",
  "https.certDaysRemaining": "days",
  "whois.domainAge": "days",
  "whois.expiresIn": "days",
  "lighthouse.metrics.firstContentfulPaint": "ms",
  "lighthouse.metrics.largestContentfulPaint": "ms",
  "lighthouse.metrics.totalBlockingTime": "ms",
  "lighthouse.metrics.speedIndex": "ms",
  "lighthouse.metrics.timeToInteractive": "ms",
  "http-versions.http3MaxAge": "seconds",
};

function plural(n: number, unit: string): string {
  const rounded = Math.round(n * 10) / 10;
  return `${rounded} ${unit}${rounded === 1 ? "" : "s"}`;
}

function formatBytes(bytes: number): string {
  if (Math.abs(bytes) < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (Math.abs(kb) < 1024) return `${Math.round(kb * 10) / 10} KB`;
  return `${Math.round((kb / 1024) * 10) / 10} MB`;
}

function formatMs(ms: number): string {
  return Math.abs(ms) < 1000 ? `${Math.round(ms)} ms` : `${Math.round(ms / 100) / 10} s`;
}

const DURATIONS: [number, string][] = [
  [365 * 86400, "year"],
  [86400, "day"],
  [3600, "hour"],
  [60, "minute"],
];

function formatSeconds(seconds: number): string {
  for (const [size, unit] of DURATIONS) {
    if (Math.abs(seconds) >= size) return plural(seconds / size, unit);
  }
  return plural(seconds, "second");
}

function formatDays(days: number): string {
  return Math.abs(days) >= 365 ? plural(days / 365, "year") : plural(days, "day");
}

/**
 * Format a numeric field in its unit (e.g. 31536000 seconds → "1 year").
 * Returns null when the field has no known unit, so callers show it as-is.
 */
export function formatFieldValue(check: string, path: string, value: unknown): string | null {
  const unit = FIELD_UNITS[`${check}.${path}`];
  if (!unit || typeof value !== "number" || !Number.isFinite(value)) return null;
  switch (unit) {
    case "bytes":
      return formatBytes(value);
    case "ms":
      return formatMs(value);
    case "seconds":
      return formatSeconds(value);
    case "days":
      return formatDays(value);
  }
}
