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
    checks: [
      "https",
      "tls-versions",
      "tls-ciphers",
      "ocsp-stapling",
      "hsts",
      "hsts-preload",
      "redirect-hygiene",
      "mixed-content",
    ],
  },
  {
    title: "Browser Hardening & Privacy",
    checks: [
      "headers",
      "csp",
      "cross-origin-isolation",
      "cookies",
      "sri",
      "cors",
      "referrer-policy",
      "permissions-policy",
      "reporting",
      "privacy",
    ],
  },
  {
    title: "Attack Surface",
    checks: ["exposed-files", "subdomain-takeover", "certificate-transparency", "api-discovery"],
  },
  {
    title: "Email & Domain Trust",
    checks: ["dns-security", "dkim", "email-security", "mx-tls", "caa", "dnssec", "whois"],
  },
  {
    title: "Infrastructure",
    checks: ["dns", "ipv6", "rpki", "geo", "green-hosting", "sniffer"],
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
      "ads-txt",
    ],
  },
  {
    title: "Performance",
    checks: ["lighthouse", "performance", "http-versions", "cache-headers", "carbon"],
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
  "cross-origin-isolation": "Cross-Origin Isolation",
  reporting: "Reporting (Report-To / NEL)",
  "ads-txt": "ads.txt",
  "http-versions": "HTTP/2 & HTTP/3",
  caa: "CAA Records",
  dkim: "DKIM",
  "ocsp-stapling": "OCSP Stapling",
  "mx-tls": "Mail Server TLS",
  "tls-ciphers": "Cipher Suites",
  rpki: "RPKI Route Validation",
  "redirect-hygiene": "Redirect Hygiene",
};

export function checkLabel(name: string): string {
  return CHECK_LABELS[name] ?? titleCase(name);
}
