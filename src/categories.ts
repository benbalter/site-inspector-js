// How checks are grouped and named for display. Dependency-free so browser
// bundles can import it via `site-inspector/assess`.

import { titleCase } from "./labels.js";

export interface CheckCategory {
  title: string;
  /** Check names, in display order. */
  checks: string[];
}

/** Ordered categories. Every registered check belongs to exactly one. */
export const CHECK_CATEGORIES: CheckCategory[] = [
  {
    title: "Transport Security",
    checks: ["https", "tls-versions", "hsts", "hsts-preload", "mixed-content"],
  },
  {
    title: "Browser Hardening & Privacy",
    checks: [
      "headers",
      "csp",
      "cookies",
      "sri",
      "cors",
      "referrer-policy",
      "permissions-policy",
      "privacy",
    ],
  },
  {
    title: "Email & Domain Trust",
    checks: ["dns-security", "email-security", "dnssec", "whois"],
  },
  {
    title: "Infrastructure",
    checks: ["dns", "ipv6", "geo", "sniffer", "api-discovery"],
  },
  {
    title: "Discoverability",
    checks: [
      "content",
      "canonical",
      "robots",
      "opengraph",
      "structured-data",
      "i18n",
      "well-known",
    ],
  },
  {
    title: "Performance",
    checks: ["lighthouse", "performance", "cache-headers", "carbon"],
  },
  {
    title: "Accessibility & Mobile",
    checks: ["accessibility", "a11y-axe", "mobile", "pwa", "favicon"],
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
  cors: "CORS",
  "tls-versions": "TLS Versions",
  "dns-security": "SPF & DMARC",
  dnssec: "DNSSEC",
  "email-security": "MTA-STS, TLS-RPT & BIMI",
  ipv6: "IPv6",
  geo: "Geolocation",
  whois: "WHOIS",
  opengraph: "Open Graph",
  i18n: "Internationalization",
  "well-known": "Well-Known URIs",
  "api-discovery": "API Discovery",
  "a11y-axe": "Accessibility (axe-core)",
  sniffer: "Detected Technologies",
  pwa: "Progressive Web App",
};

export function checkLabel(name: string): string {
  return CHECK_LABELS[name] ?? titleCase(name);
}
