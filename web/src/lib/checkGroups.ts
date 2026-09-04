// UI-only taxonomy for grouping and labelling checks. This grouping does NOT
// exist in the site-inspector engine (the CLI renders checks as a flat list) —
// it is defined here purely to organize the web UI.

/** Checks that launch headless Chrome and are therefore slow — opt-in only. */
export const HEAVY_CHECKS = ["lighthouse", "a11y-axe"] as const;

export interface CheckGroup {
  title: string;
  /** Check names, in display order. */
  checks: string[];
}

/** Ordered groups. Any check not listed here lands in an "Other" group. */
export const CHECK_GROUPS: CheckGroup[] = [
  {
    title: "Security & Privacy",
    checks: [
      "https",
      "tls-versions",
      "hsts",
      "hsts-preload",
      "headers",
      "csp",
      "cookies",
      "sri",
      "mixed-content",
      "cors",
      "referrer-policy",
      "permissions-policy",
      "dns-security",
      "dnssec",
      "email-security",
      "privacy",
    ],
  },
  {
    title: "DNS & Infrastructure",
    checks: ["dns", "ipv6", "geo", "whois"],
  },
  {
    title: "Content & SEO",
    checks: [
      "content",
      "canonical",
      "opengraph",
      "structured-data",
      "robots",
      "i18n",
      "favicon",
      "well-known",
      "api-discovery",
    ],
  },
  {
    title: "Performance",
    checks: ["lighthouse", "performance", "cache-headers", "carbon"],
  },
  {
    title: "Accessibility",
    checks: ["accessibility", "a11y-axe"],
  },
  {
    title: "Technology",
    checks: ["sniffer"],
  },
  {
    title: "Mobile & PWA",
    checks: ["mobile", "pwa"],
  },
];

/** Human-friendly names for check keys. Falls back to a title-cased key. */
export const CHECK_LABELS: Record<string, string> = {
  dns: "DNS",
  https: "HTTPS / TLS Certificate",
  hsts: "HSTS",
  "hsts-preload": "HSTS Preload",
  csp: "Content Security Policy",
  sri: "Subresource Integrity",
  "mixed-content": "Mixed Content",
  cors: "CORS",
  "referrer-policy": "Referrer Policy",
  "permissions-policy": "Permissions Policy",
  "tls-versions": "TLS Versions",
  "dns-security": "DNS Security",
  dnssec: "DNSSEC",
  "email-security": "Email Security (SPF/DKIM/DMARC)",
  ipv6: "IPv6",
  geo: "Geolocation",
  whois: "WHOIS",
  opengraph: "Open Graph",
  "structured-data": "Structured Data",
  i18n: "Internationalization",
  "well-known": "Well-Known URIs",
  "api-discovery": "API Discovery",
  "cache-headers": "Cache Headers",
  lighthouse: "Lighthouse",
  a11y: "Accessibility",
  accessibility: "Accessibility",
  "a11y-axe": "Accessibility (axe-core)",
  sniffer: "Detected Technologies",
  pwa: "Progressive Web App",
};

/** Bad-when-true domain properties (rendered with inverted colors). */
export const INVERTED_PROPERTIES = ["downgradesHttps", "redirect"];

/** Human-friendly labels for domain-property flags. */
export const PROPERTY_LABELS: Record<string, string> = {
  up: "Up",
  https: "HTTPS",
  enforcesHttps: "Enforces HTTPS",
  downgradesHttps: "Downgrades HTTPS",
  www: "WWW",
  root: "Root",
  canonicallyWww: "Canonically WWW",
  canonicallyHttps: "Canonically HTTPS",
  redirect: "External Redirect",
};

export function checkLabel(name: string): string {
  return CHECK_LABELS[name] ?? titleCase(name);
}

export function titleCase(s: string): string {
  return s
    .replace(/[-_]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
