import { describe, it, expect } from "vitest";
import { PrivacyCheck } from "./privacy.js";
import type { EndpointData } from "../types.js";

function makeEndpoint(body: string, headers: Record<string, string> = {}): EndpointData {
  return {
    url: "https://example.com",
    statusCode: 200,
    headers,
    body,
    redirectChain: [],
  };
}

describe("PrivacyCheck", () => {
  const check = new PrivacyCheck();

  it("detects OneTrust consent banner and privacy policy", async () => {
    const body = `
      <html>
        <body>
          <script src="https://cdn.cookielaw.org/optanon.js"></script>
          <a href="/privacy-policy">Privacy Policy</a>
        </body>
      </html>
    `;
    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.name).toBe("privacy");
    expect(result.data.hasConsentBanner).toBe(true);
    expect(result.data.consentLibraries).toContain("OneTrust");
    expect(result.data.hasPrivacyPolicy).toBe(true);
  });

  it("detects tracking without consent", async () => {
    const body = `
      <html>
        <body>
          <script async src="https://www.googletagmanager.com/gtag/js?id=GA-123"></script>
          <img src="https://connect.facebook.com/tr?id=123">
        </body>
      </html>
    `;
    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.hasConsentBanner).toBe(false);
    expect(result.data.trackers.googleAnalytics).toBe(true);
    expect(result.data.trackers.facebookPixel).toBe(true);
  });

  it("reports clean page with no trackers or consent", async () => {
    const body = `
      <html>
        <body>
          <h1>Welcome</h1>
          <p>No tracking here.</p>
        </body>
      </html>
    `;
    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.hasConsentBanner).toBe(false);
    expect(result.data.consentLibraries).toEqual([]);
    expect(result.data.trackers.googleAnalytics).toBe(false);
    expect(result.data.trackers.facebookPixel).toBe(false);
  });

  it("detects multiple consent libraries", async () => {
    const body = `
      <html>
        <body>
          <script src="https://cdn.cookielaw.org/optanon.js"></script>
          <script src="https://cdn.cookiebot.com/uc.js"></script>
          <script src="https://www.didomi.io/embed.js"></script>
        </body>
      </html>
    `;
    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.hasConsentBanner).toBe(true);
    expect(result.data.consentLibraries).toContain("OneTrust");
    expect(result.data.consentLibraries).toContain("CookieBot");
    expect(result.data.consentLibraries).toContain("Didomi");
    expect(result.data.consentLibraries.length).toBe(3);
  });

  it("detects cookie policy link", async () => {
    const body = `
      <html>
        <body>
          <a href="/cookie-policy">Cookie Policy</a>
          <a href="/cookies">Our Cookies</a>
        </body>
      </html>
    `;
    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.hasCookiePolicy).toBe(true);
  });

  it("detects German privacy policy (Datenschutz)", async () => {
    const body = `
      <html>
        <body>
          <a href="/datenschutz">Datenschutz</a>
        </body>
      </html>
    `;
    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.hasPrivacyPolicy).toBe(true);
  });

  it("respects Do Not Track header", async () => {
    const body = "<html><body>Test</body></html>";
    const result = await check.run(
      makeEndpoint(body, { tk: "1" }),
      "example.com",
    );

    expect(result.data.dntHeader).toBe("1");
  });

  it("respects GPC (Global Privacy Control) header", async () => {
    const body = "<html><body>Test</body></html>";
    const result = await check.run(
      makeEndpoint(body, { "sec-gpc": "1" }),
      "example.com",
    );

    expect(result.data.gpcHeader).toBe("1");
  });

  it("detects P3P header", async () => {
    const body = "<html><body>Test</body></html>";
    const result = await check.run(
      makeEndpoint(body, {
        p3p: 'CP="IDC DSP COR ADM DEVi TAIi PSA PSD IVAi IVDi CONi TELo OTPi OUR DELi SAMi OTRo"',
      }),
      "example.com",
    );

    expect(result.data.p3p).toBe(true);
  });

  it("handles empty body gracefully", async () => {
    const result = await check.run(makeEndpoint(""), "example.com");

    expect(result.name).toBe("privacy");
    expect(result.data.hasConsentBanner).toBe(false);
    expect(result.data.consentLibraries).toEqual([]);
  });

  it("detects CookieConsent.js library", async () => {
    const body = '<script src="/js/cookieconsent.js"></script>';
    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.hasConsentBanner).toBe(true);
    expect(result.data.consentLibraries).toContain("CookieConsent");
  });

  it("detects privacy policy text without href attribute", async () => {
    const body = "<html><body>>Privacy Policy</body></html>";
    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.hasPrivacyPolicy).toBe(true);
  });

  it("detects complex Google Analytics patterns", async () => {
    const body = `
      <script>
        gtag('config', 'GA-12345');
        ga('create', 'UA-12345-1');
      </script>
    `;
    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.trackers.googleAnalytics).toBe(true);
  });

  it("detects Facebook pixel patterns", async () => {
    const body = `
      <script>
        fbq('init', '1234567890');
        fbq('track', 'PageView');
      </script>
    `;
    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.trackers.facebookPixel).toBe(true);
  });

  it("returns null for missing headers", async () => {
    const body = "<html><body>Test</body></html>";
    const result = await check.run(makeEndpoint(body, {}), "example.com");

    expect(result.data.dntHeader).toBe(null);
    expect(result.data.gpcHeader).toBe(null);
    expect(result.data.p3p).toBe(false);
  });

  it("detects Klaro consent library", async () => {
    const body = '<script src="https://example.com/klaro-config.js"></script>';
    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.hasConsentBanner).toBe(true);
    expect(result.data.consentLibraries).toContain("Klaro");
  });

  it("detects Quantcast choice platform", async () => {
    const body = '<script src="https://example.com/__tcfapi"></script>';
    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.hasConsentBanner).toBe(true);
    expect(result.data.consentLibraries).toContain("Quantcast");
  });

  it("detects TrustArc/TRUSTe consent", async () => {
    const body = '<script src="https://trustarc.b.self.com/notice.js"></script>';
    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.hasConsentBanner).toBe(true);
    expect(result.data.consentLibraries).toContain("TrustArc");
  });

  it("detects Iubenda consent library", async () => {
    const body = '<script type="text/javascript" src="//cdn.iubenda.com/iubenda.js"></script>';
    const result = await check.run(makeEndpoint(body), "example.com");

    expect(result.data.hasConsentBanner).toBe(true);
    expect(result.data.consentLibraries).toContain("Iubenda");
  });
});
