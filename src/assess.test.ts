import { describe, it, expect } from "vitest";
import { DUPLICATE_OF, PROPERTY_LABELS, assess, assessField, severityOf } from "./assess.js";
import type { DomainProperties, InspectionResult } from "./types.js";

describe("assessField", () => {
  it("treats absence-of-a-tracker and other neutral facts as neutral, never attention", () => {
    // The binary green/red bug: these are neutral facts, not failings.
    expect(assessField("privacy", "trackers.googleAnalytics", true)).toBe("neutral");
    expect(assessField("privacy", "trackers.facebookPixel", false)).toBe("neutral");
    expect(assessField("ipv6", "hasIpv6", false)).toBe("neutral");
    expect(assessField("i18n", "multilingual", false)).toBe("neutral");
    expect(assessField("cookies", "hasCookies", false)).toBe("neutral");
  });

  it("flags missing required posture as attention", () => {
    expect(assessField("hsts", "enabled", false)).toBe("attention");
    expect(assessField("csp", "hasCsp", false)).toBe("attention");
    expect(assessField("https", "valid", false)).toBe("attention");
    expect(assessField("accessibility", "hasH1", false)).toBe("attention");
  });

  it("passes present required posture", () => {
    expect(assessField("hsts", "enabled", true)).toBe("pass");
    expect(assessField("https", "valid", true)).toBe("pass");
  });

  it("handles negative-polarity fields (true is bad)", () => {
    expect(assessField("mixed-content", "hasMixedContent", true)).toBe("attention");
    expect(assessField("mixed-content", "hasMixedContent", false)).toBe("pass");
    expect(assessField("https", "expiringSoon", true)).toBe("attention");
    expect(assessField("properties", "downgradesHttps", true)).toBe("attention");
    expect(assessField("properties", "redirect", false)).toBe("pass");
    expect(assessField("tls-versions", "supported.TLSv1", true)).toBe("attention");
  });

  it("treats bonus fields' absence as neutral, presence as pass", () => {
    expect(assessField("api-discovery", "hasApi", false)).toBe("neutral");
    expect(assessField("api-discovery", "hasApi", true)).toBe("pass");
    expect(assessField("tls-versions", "supported.TLSv1.2", true)).toBe("pass");
    expect(assessField("ipv6", "hasIpv6", true)).toBe("pass");
  });

  it("returns neutral for non-booleans and unknown fields", () => {
    expect(assessField("https", "certIssuer", "Let's Encrypt")).toBe("neutral");
    expect(assessField("made-up", "whatever", true)).toBe("neutral");
  });

  it("grades non-boolean severity signals the engine already computes", () => {
    // A present-but-misconfigured CSP must not pass silently.
    expect(assessField("csp", "highSeverityCount", 3)).toBe("attention");
    expect(assessField("csp", "highSeverityCount", 0)).toBe("pass");
    // Letter grades: A/B pass, D/F attention, C unremarkable.
    expect(assessField("cache-headers", "grade", "A")).toBe("pass");
    expect(assessField("cache-headers", "grade", "D")).toBe("attention");
    expect(assessField("mobile", "grade", "F")).toBe("attention");
    expect(assessField("mobile", "grade", "C")).toBe("neutral");
  });
});

describe("assess", () => {
  it("rolls up attention across properties and checks, recursing nested objects", () => {
    const result: InspectionResult = {
      domain: "example.com",
      canonicalUrl: "https://example.com",
      properties: {
        up: true,
        www: true,
        root: true,
        https: true,
        enforcesHttps: false, // bonus absent -> neutral
        downgradesHttps: false, // negative false -> pass
        canonicallyWww: false,
        canonicallyHttps: false,
        serverError: false,
        redirect: false,
      },
      checks: {
        hsts: { name: "hsts", data: { enabled: false } }, // attention
        csp: { name: "csp", data: { hasCsp: false } }, // attention
        "dns-security": {
          name: "dns-security",
          data: { spf: { exists: true, strongPolicy: false } }, // nested: pass + neutral
        },
        privacy: {
          name: "privacy",
          data: { trackers: { googleAnalytics: true } }, // neutral
        },
      },
      inspectedAt: "2026-09-03T00:00:00.000Z",
    };

    const a = assess(result);
    expect(a.attentionCount).toBe(2);
    expect(a.attentionByCheck).toEqual({ hsts: 1, csp: 1 });
    // Nested field was reached and labelled.
    const spf = a.findings.find((f) => f.path === "spf.strongPolicy");
    expect(spf?.label).toBe("SPF · Strong Policy");
    expect(spf?.severity).toBe("neutral");
    // The tracker fact is present as a finding but not attention.
    expect(a.findings.some((f) => f.path === "trackers.googleAnalytics")).toBe(true);
    expect(a.attention.some((f) => f.check === "privacy")).toBe(false);
  });
});

describe("PROPERTY_LABELS", () => {
  it("labels every boolean domain property", () => {
    // Typed as the full interface, so adding a property forces updating this.
    const props: Required<Omit<DomainProperties, "redirectTarget">> = {
      up: true,
      www: true,
      root: true,
      https: true,
      enforcesHttps: true,
      downgradesHttps: false,
      canonicallyWww: false,
      canonicallyHttps: true,
      serverError: false,
      redirect: false,
    };
    expect(Object.keys(PROPERTY_LABELS).sort()).toEqual(Object.keys(props).sort());
  });
});

/** A minimal up, HTTPS result; pass `checks` as `{ name: data }`. */
function makeResult(
  checks: Record<string, Record<string, unknown>>,
  properties: Partial<DomainProperties> = {},
): InspectionResult {
  return {
    domain: "example.com",
    canonicalUrl: "https://example.com",
    properties: {
      up: true,
      www: true,
      root: true,
      https: true,
      enforcesHttps: true,
      downgradesHttps: false,
      canonicallyWww: false,
      canonicallyHttps: true,
      serverError: false,
      redirect: false,
      ...properties,
    },
    checks: Object.fromEntries(
      Object.entries(checks).map(([name, data]) => [name, { name, data }]),
    ),
    inspectedAt: "2026-09-03T00:00:00.000Z",
  };
}

function severityIn(result: InspectionResult, check: string, path: string): string | undefined {
  return assess(result).findings.find((f) => f.check === check && f.path === path)?.severity;
}

describe("assess — graded values", () => {
  it("grades HSTS max-age: short is attention, six months or more passes", () => {
    expect(assessField("hsts", "maxAge", 300)).toBe("attention");
    expect(assessField("hsts", "maxAge", 31536000)).toBe("pass");
    expect(assessField("hsts", "maxAge", 0)).toBe("neutral");
    expect(assessField("hsts", "maxAge", null)).toBe("neutral");
  });

  it("grades referrer-policy strictness", () => {
    expect(assessField("referrer-policy", "strictness", "loose")).toBe("attention");
    expect(assessField("referrer-policy", "strictness", "strict")).toBe("pass");
    expect(assessField("referrer-policy", "strictness", "moderate")).toBe("pass");
    expect(assessField("referrer-policy", "strictness", "none")).toBe("neutral");
  });

  it("flags a missing or wrong X-Content-Type-Options", () => {
    expect(assessField("headers", "xContentTypeOptions", "nosniff")).toBe("pass");
    expect(assessField("headers", "xContentTypeOptions", null)).toBe("attention");
    const r = makeResult({ headers: { xContentTypeOptions: null } });
    expect(severityIn(r, "headers", "xContentTypeOptions")).toBe("attention");
  });

  it("grades email, registration, and audit signals", () => {
    expect(assessField("dns-security", "spf.multipleRecords", true)).toBe("attention");
    expect(assessField("dns-security", "dmarc.percentage", 50)).toBe("attention");
    expect(assessField("dns-security", "dmarc.percentage", 100)).toBe("pass");
    expect(assessField("email-security", "mtaSts.mode", "enforce")).toBe("pass");
    expect(assessField("email-security", "mtaSts.mode", "testing")).toBe("neutral");
    expect(assessField("whois", "expiresIn", 10)).toBe("attention");
    expect(assessField("whois", "expiresIn", 300)).toBe("neutral");
    expect(assessField("a11y-axe", "critical", 2)).toBe("attention");
    expect(assessField("a11y-axe", "serious", 0)).toBe("pass");
    expect(assessField("lighthouse", "scores.performance", 40)).toBe("attention");
    expect(assessField("lighthouse", "scores.seo", 95)).toBe("pass");
    expect(assessField("lighthouse", "scores.seo", 70)).toBe("neutral");
    expect(assessField("lighthouse", "scores.seo", null)).toBe("neutral");
  });
});

describe("assess — duplicate signals", () => {
  it("counts a missing viewport once, not once per check that reports it", () => {
    const r = makeResult({
      mobile: { hasViewport: false },
      accessibility: { viewport: false },
    });
    const a = assess(r);
    expect(a.attentionCount).toBe(1);
    expect(a.attentionByCheck).toEqual({ mobile: 1 });
    expect(assessField("accessibility", "viewport", false)).toBe("neutral");
    expect(assessField("dns", "ipv6", true)).toBe("neutral");
    expect(assessField("content", "robotsTxt", true)).toBe("neutral");
    expect(DUPLICATE_OF["accessibility.viewport"]).toBe("mobile.hasViewport");
  });
});

describe("assess — applicability", () => {
  it("marks transport findings not applicable when the site has no HTTPS", () => {
    const r = makeResult(
      { hsts: { enabled: false, maxAge: null }, https: { valid: false } },
      { https: false, enforcesHttps: false, canonicallyHttps: false },
    );
    const a = assess(r);
    expect(severityIn(r, "hsts", "enabled")).toBe("not-applicable");
    // A broken certificate may be why HTTPS is down, so it stays flagged.
    expect(severityIn(r, "https", "valid")).toBe("attention");
    expect(a.attention.map((f) => `${f.check}.${f.path}`)).toEqual([
      "properties.https",
      "https.valid",
    ]);
    expect(a.findings.find((f) => f.path === "enabled")?.note).toMatch(/HTTPS/);
  });

  it("does not grade cookie flags when there are no cookies", () => {
    const r = makeResult({ cookies: { hasCookies: false, allSecure: true, allHttpOnly: true } });
    expect(severityIn(r, "cookies", "allSecure")).toBe("not-applicable");
    expect(severityIn(r, "cookies", "allHttpOnly")).toBe("not-applicable");
  });

  it("marks MTA-STS and TLS-RPT not applicable for a domain with no or null MX", () => {
    const email = { mtaSts: { exists: false }, tlsRpt: { exists: false }, bimi: { exists: false } };
    for (const mx of [[], [{ exchange: "", priority: 0 }]]) {
      const r = makeResult({ dns: { mx }, "email-security": email });
      expect(severityIn(r, "email-security", "mtaSts.exists")).toBe("not-applicable");
      expect(severityIn(r, "email-security", "tlsRpt.exists")).toBe("not-applicable");
      expect(severityIn(r, "email-security", "bimi.exists")).toBe("neutral");
    }
  });

  it("leaves findings alone when a prerequisite is unknown", () => {
    const email = { mtaSts: { exists: false }, tlsRpt: { exists: false } };
    // DNS failed, or didn't run: we can't tell whether mail applies.
    const unknownDns: Record<string, Record<string, unknown>>[] = [
      { dns: { error: "timeout" } },
      {},
    ];
    for (const checks of unknownDns) {
      const r = makeResult({ ...checks, "email-security": email });
      expect(severityIn(r, "email-security", "mtaSts.exists")).toBe("neutral");
    }
    const withMx = makeResult({
      dns: { mx: [{ exchange: "mx.example.com", priority: 10 }] },
      "email-security": email,
    });
    expect(severityIn(withMx, "email-security", "mtaSts.exists")).toBe("neutral");
  });

  it("credits CSP frame-ancestors as clickjacking protection", () => {
    const r = makeResult({
      headers: {
        clickjackingProtection: false,
        contentSecurityPolicy: "default-src 'self'; frame-ancestors 'none'",
      },
    });
    expect(severityIn(r, "headers", "clickjackingProtection")).toBe("pass");
    const without = makeResult({
      headers: { clickjackingProtection: false, contentSecurityPolicy: "default-src 'self'" },
    });
    expect(severityIn(without, "headers", "clickjackingProtection")).toBe("attention");
  });

  it("exposes contextual verdicts to front ends through severityOf", () => {
    const r = makeResult({ cookies: { hasCookies: false, allSecure: true } });
    const a = assess(r);
    expect(severityOf(a, "cookies", "allSecure", true)).toBe("not-applicable");
    // Falls back to the context-free rule for fields assess() didn't record.
    expect(severityOf(a, "hsts", "enabled", false)).toBe("attention");
  });
});

describe("assess — insights", () => {
  const spoofable = {
    spf: { exists: true, strongPolicy: false, error: null },
    dmarc: { exists: false, policy: null, strongPolicy: false, error: null },
  };

  it("flags a domain whose email can be spoofed, and counts it", () => {
    const a = assess(makeResult({ "dns-security": spoofable }));
    const insight = a.insights.find((i) => i.id === "email-spoofing");
    expect(insight?.severity).toBe("attention");
    expect(insight?.check).toBe("dns-security");
    expect(insight?.because).toContain("dns-security.dmarc.exists");
    expect(a.attentionCount).toBe(1);
    expect(a.attentionByCheck["dns-security"]).toBe(1);
  });

  it("passes a domain with SPF and an enforcing DMARC policy", () => {
    const a = assess(
      makeResult({
        "dns-security": {
          spf: { exists: true, strongPolicy: true, error: null },
          dmarc: { exists: true, policy: "reject", strongPolicy: true, error: null },
        },
      }),
    );
    expect(a.insights.find((i) => i.id === "email-spoofing")?.severity).toBe("pass");
    expect(a.attentionCount).toBe(0);
  });

  it("says nothing about spoofing when the DNS lookups failed", () => {
    const a = assess(
      makeResult({
        "dns-security": {
          spf: { exists: false, error: "SERVFAIL" },
          dmarc: { exists: false, error: "SERVFAIL" },
        },
      }),
    );
    expect(a.insights.find((i) => i.id === "email-spoofing")).toBeUndefined();
  });

  it("flags an expired security.txt", () => {
    const expired = makeResult({
      "well-known": { securityTxt: { present: true, expires: "2025-01-01T00:00:00Z" } },
    });
    expect(assess(expired).insights.map((i) => i.id)).toContain("security-txt-expired");
    const current = makeResult({
      "well-known": { securityTxt: { present: true, expires: "2027-01-01T00:00:00Z" } },
    });
    expect(assess(current).insights.map((i) => i.id)).not.toContain("security-txt-expired");
  });

  it("explains why a requested HSTS preload is blocked", () => {
    const a = assess(
      makeResult({
        hsts: { enabled: true, preload: true },
        "hsts-preload": {
          preloaded: false,
          errors: [{ code: "header.max_age", summary: "Max-age too low", message: "…" }],
        },
      }),
    );
    const insight = a.insights.find((i) => i.id === "hsts-preload-blocked");
    expect(insight?.severity).toBe("attention");
    expect(insight?.detail).toContain("Max-age too low");
  });
});
