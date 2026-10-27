// Where to learn how to fix a finding, keyed like the verdict tables in
// assess.ts (`"<check>.<dotted-path>"`). Every field that can need attention
// has one; assess.test.ts enforces that. Dependency-free so browser bundles
// can import it via `site-inspector/assess`.

const MDN = "https://developer.mozilla.org/en-US/docs";
const MOZILLA_TLS_CONFIG = "https://ssl-config.mozilla.org/";
const VIEWPORT = `${MDN}/Web/HTML/Reference/Elements/meta/name/viewport`;
const ROBOTS = "https://developers.google.com/search/docs/crawling-indexing/robots/intro";
const CANONICAL =
  "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls";

export const REMEDIATION: Record<string, string> = {
  "properties.https": "https://letsencrypt.org/getting-started/",
  "properties.downgradesHttps": `${MDN}/Web/Security/Practical_implementation_guides/TLS`,
  "properties.serverError": `${MDN}/Web/HTTP/Reference/Status#server_error_responses`,
  "properties.redirect": `${MDN}/Web/HTTP/Guides/Redirections`,

  "https.valid": "https://letsencrypt.org/docs/",
  "https.expiringSoon": "https://certbot.eff.org/",
  "https.chainComplete": "https://whatsmychaincert.com/",
  "hsts.enabled": `${MDN}/Web/HTTP/Reference/Headers/Strict-Transport-Security`,
  "headers.clickjackingProtection": `${MDN}/Web/Security/Attacks/Clickjacking`,
  "csp.hasCsp": `${MDN}/Web/HTTP/Guides/CSP`,
  "csp.highSeverityCount": `${MDN}/Web/HTTP/Guides/CSP`,
  "cookies.prefixViolation": `${MDN}/Web/HTTP/Reference/Headers/Set-Cookie#cookie_prefixes`,
  "mixed-content.hasMixedContent": `${MDN}/Web/Security/Defenses/Mixed_content`,
  "vulnerable-libraries.hasVulnerableLibraries":
    "https://top10.owasp.org/A06_2021-Vulnerable_and_Outdated_Components/",
  "cors.misconfigured": `${MDN}/Web/HTTP/Guides/CORS`,
  "cors.wildcard": `${MDN}/Web/HTTP/Guides/CORS`,

  // Mozilla's generator writes a server config that fixes all of these.
  "tls-versions.supported.TLSv1": MOZILLA_TLS_CONFIG,
  "tls-versions.supported.TLSv1.1": MOZILLA_TLS_CONFIG,
  "tls-versions.hasDeprecated": MOZILLA_TLS_CONFIG,
  "tls-versions.forwardSecrecy": MOZILLA_TLS_CONFIG,
  "tls-versions.aead": MOZILLA_TLS_CONFIG,

  "dnssec.validationFailed": "https://dnsviz.net/",
  "smtp-tls.starttls": "https://internet.nl/test-mail/",
  "rpki.invalid": "https://rpki.readthedocs.io/en/latest/",
  "whois.expiresIn":
    "https://www.icann.org/resources/pages/domain-name-renewal-expiration-faqs-2018-12-07-en",

  "canonical.noindex": CANONICAL,
  "canonical.conflict": CANONICAL,
  "links.soft404": "https://developers.google.com/crawling/docs/troubleshooting/http-status-codes",
  "links.hasBrokenLinks": `${MDN}/Web/HTTP/Reference/Status/404`,
  "robots.blocksGooglebot": ROBOTS,
  "robots.blocksAll": ROBOTS,
  "cache-headers.grade": `${MDN}/Web/HTTP/Guides/Caching`,

  "mobile.hasViewport": VIEWPORT,
  "mobile.grade": VIEWPORT,
  "accessibility.viewport": VIEWPORT,
  "accessibility.htmlLang": `${MDN}/Web/HTML/Reference/Global_attributes/lang`,
  "accessibility.hasH1": `${MDN}/Web/HTML/Reference/Elements/Heading_Elements`,
};

/** A page explaining how to fix a field that needs attention, if there is one. */
export function remediationUrl(check: string, path: string): string | null {
  return REMEDIATION[`${check}.${path}`] ?? null;
}
