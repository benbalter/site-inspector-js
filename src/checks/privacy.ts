import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

const CONSENT_LIBRARIES = [
  { name: "OneTrust", pattern: /onetrust|optanon/i },
  { name: "CookieBot", pattern: /cookiebot|cookieconsent/i },
  { name: "CookieYes", pattern: /cookie-law-info|cookieyes/i },
  { name: "Quantcast", pattern: /quantcast.*choice|__tcfapi/i },
  { name: "TrustArc", pattern: /trustarc|truste/i },
  { name: "Osano", pattern: /osano/i },
  { name: "Klaro", pattern: /klaro/i },
  { name: "CookieConsent", pattern: /cookieconsent\.js/i },
  { name: "Didomi", pattern: /didomi/i },
  { name: "Iubenda", pattern: /iubenda/i },
];

export class PrivacyCheck implements Check {
  name = "privacy";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const body = endpoint.body ?? "";

    // Detect consent management platforms
    const detectedLibraries: string[] = [];
    for (const lib of CONSENT_LIBRARIES) {
      if (lib.pattern.test(body)) {
        detectedLibraries.push(lib.name);
      }
    }
    const hasConsentBanner = detectedLibraries.length > 0;

    // Detect privacy policy link
    const hasPrivacyPolicy =
      /href=["'][^"']*privac[^"']*["']/i.test(body) ||
      /href=["'][^"']*datenschutz[^"']*["']/i.test(body) ||
      />privacy\s*policy</i.test(body);

    // Detect cookie policy link
    const hasCookiePolicy =
      /href=["'][^"']*cookie[^"']*polic[^"']*["']/i.test(body) ||
      />cookie\s*policy</i.test(body);

    // Detect Do Not Track / GPC respect
    const dntHeader = endpoint.headers["tk"] ?? null;
    const gpcHeader = endpoint.headers["sec-gpc"] ?? null;

    // P3P header (legacy)
    const p3p = endpoint.headers["p3p"] ?? null;

    // Detect Google Analytics / tracking
    const hasGoogleAnalytics =
      /gtag|google-analytics|googletagmanager|ga\('create'/i.test(body);
    const hasFacebookPixel =
      /facebook.*pixel|fbq\(|connect\.facebook/i.test(body);

    return {
      name: this.name,
      data: {
        hasConsentBanner,
        consentLibraries: detectedLibraries,
        hasPrivacyPolicy,
        hasCookiePolicy,
        dntHeader,
        gpcHeader,
        p3p: p3p !== null,
        trackers: {
          googleAnalytics: hasGoogleAnalytics,
          facebookPixel: hasFacebookPixel,
        },
      },
    };
  }
}
