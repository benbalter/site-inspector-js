import { describe, it, expect } from "vitest";
import {
  ATTENTION_FIELDS,
  CRITICAL_FIELDS,
  GRADE_DUPLICATES,
  PROPERTY_LABELS,
  REMEDIATION,
  assess,
  assessField,
  gradeFor,
} from "./assess.js";
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
    expect(assessField("rpki", "invalid", true)).toBe("attention");
    expect(assessField("links", "soft404", true)).toBe("attention");
    expect(assessField("vulnerable-libraries", "hasVulnerableLibraries", true)).toBe("attention");
    expect(assessField("links", "hasBrokenLinks", false)).toBe("pass");
    expect(assessField("cookies", "prefixViolation", true)).toBe("attention");
  });

  it("treats bonus fields' absence as neutral, presence as pass", () => {
    expect(assessField("api-discovery", "hasApi", false)).toBe("neutral");
    expect(assessField("api-discovery", "hasApi", true)).toBe("pass");
    expect(assessField("tls-versions", "supported.TLSv1.2", true)).toBe("pass");
    expect(assessField("ipv6", "hasIpv6", true)).toBe("pass");
    expect(assessField("headers", "openerIsolation", false)).toBe("neutral");
    expect(assessField("headers", "crossOriginIsolated", true)).toBe("pass");
    expect(assessField("carbon", "greenHosting", false)).toBe("neutral");
    expect(assessField("carbon", "greenHosting", true)).toBe("pass");
    expect(assessField("tls-versions", "http2", false)).toBe("neutral");
    expect(assessField("tls-versions", "http3", true)).toBe("pass");
    expect(assessField("tls-versions", "ocspStapling", false)).toBe("neutral");
    expect(assessField("tls-versions", "forwardSecrecy", false)).toBe("attention");
    expect(assessField("email-security", "dkim.exists", false)).toBe("neutral");
    expect(assessField("smtp-tls", "starttls", false)).toBe("attention");
    expect(assessField("smtp-tls", "connected", false)).toBe("neutral");
    expect(assessField("tls-versions", "staticRsaKeyExchange", true)).toBe("neutral");
  });

  it("passes good carbon ratings without flagging poor ones", () => {
    expect(assessField("lighthouse", "carbonRating", "A+")).toBe("pass");
    expect(assessField("lighthouse", "carbonRating", "B")).toBe("pass");
    expect(assessField("lighthouse", "carbonRating", "C")).toBe("neutral");
    expect(assessField("lighthouse", "carbonRating", "F")).toBe("neutral");
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

  it("flags a domain registration about to lapse", () => {
    expect(assessField("whois", "expiresIn", -3)).toBe("attention");
    expect(assessField("whois", "expiresIn", 14)).toBe("attention");
    expect(assessField("whois", "expiresIn", 15)).toBe("pass");
    expect(assessField("whois", "expiresIn", null)).toBe("neutral");
  });

  it("credits a transfer lock without flagging its absence", () => {
    expect(assessField("whois", "transferLock", true)).toBe("pass");
    expect(assessField("whois", "transferLock", false)).toBe("neutral");
  });

  it("flags DNSSEC that fails validation", () => {
    expect(assessField("dnssec", "validationFailed", true)).toBe("attention");
    expect(assessField("dnssec", "validationFailed", false)).toBe("pass");
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

describe("remediation links", () => {
  /** Fields that can need attention but have nothing useful to link to. */
  const NO_LINK: Record<string, string> = {
    "properties.up": "the site is down; there's no general fix to point to",
    "lighthouse.carbonRating": "graded pass or neutral, never attention",
  };

  it("links every field that can need attention to a fix", () => {
    const missing = ATTENTION_FIELDS.filter((key) => !REMEDIATION[key] && !NO_LINK[key]);
    expect(missing).toEqual([]);
  });

  it("only links fields that exist in the verdict tables", () => {
    const stale = Object.keys(REMEDIATION).filter((key) => !ATTENTION_FIELDS.includes(key));
    expect(stale).toEqual([]);
  });

  it("uses HTTPS links", () => {
    for (const url of Object.values(REMEDIATION)) expect(url).toMatch(/^https:\/\//);
  });

  it("attaches the link to findings that need attention, and only those", () => {
    const { findings } = assess({
      domain: "example.com",
      canonicalUrl: "https://example.com",
      properties: {} as DomainProperties,
      checks: {
        hsts: { name: "hsts", data: { enabled: false } },
        dns: { name: "dns", data: { ipv6: true } },
      },
      inspectedAt: "2026-01-01T00:00:00.000Z",
    } as InspectionResult);

    const hsts = findings.find((f) => f.check === "hsts");
    expect(hsts?.learnMore).toBe(REMEDIATION["hsts.enabled"]);
    expect(findings.find((f) => f.check === "dns")).not.toHaveProperty("learnMore");
  });
});

describe("grade", () => {
  const finding = (check: string, path: string) => ({
    check,
    path,
    label: path,
    value: false,
    severity: "attention" as const,
  });

  it("gives A+ when nothing needs attention", () => {
    expect(gradeFor([])).toEqual({ grade: "A+", score: 100, criticalCount: 0 });
  });

  it("takes 10 points per ordinary issue", () => {
    expect(gradeFor([finding("hsts", "enabled")])).toMatchObject({ grade: "A", score: 90 });
    expect(gradeFor([finding("hsts", "enabled"), finding("csp", "hasCsp")])).toMatchObject({
      grade: "B",
      score: 80,
    });
  });

  it("takes 25 points per critical issue", () => {
    expect(gradeFor([finding("https", "valid")])).toEqual({
      grade: "C",
      score: 75,
      criticalCount: 1,
    });
  });

  it("charges once for findings that restate the same problem", () => {
    // Old TLS versions: the per-version flags and hasDeprecated are one issue.
    expect(
      gradeFor([
        finding("tls-versions", "supported.TLSv1"),
        finding("tls-versions", "supported.TLSv1.1"),
        finding("tls-versions", "hasDeprecated"),
      ]),
    ).toMatchObject({ grade: "A", score: 90 });
    // Both checks read the same viewport meta tag.
    expect(
      gradeFor([finding("mobile", "hasViewport"), finding("accessibility", "viewport")]),
    ).toMatchObject({ score: 90 });
  });

  it("still charges a restated finding when the one covering it isn't flagged", () => {
    expect(gradeFor([finding("tls-versions", "supported.TLSv1")])).toMatchObject({ score: 90 });
  });

  it("only treats real verdict fields as duplicates", () => {
    for (const [field, coveredBy] of Object.entries(GRADE_DUPLICATES)) {
      expect(ATTENTION_FIELDS).toContain(field);
      expect(ATTENTION_FIELDS).toContain(coveredBy);
    }
  });

  it("bottoms out at F and a score of 0", () => {
    const many = Array.from({ length: 20 }, () => finding("hsts", "enabled"));
    expect(gradeFor(many)).toMatchObject({ grade: "F", score: 0 });
  });

  it("only counts findings that need attention", () => {
    expect(gradeFor([{ ...finding("hsts", "enabled"), severity: "pass" }]).grade).toBe("A+");
  });

  it("marks only fields that can need attention as critical", () => {
    for (const key of CRITICAL_FIELDS) expect(ATTENTION_FIELDS).toContain(key);
  });

  it("is part of every assessment", () => {
    const assessment = assess({
      domain: "example.com",
      canonicalUrl: "https://example.com",
      properties: {} as DomainProperties,
      checks: { hsts: { name: "hsts", data: { enabled: false } } },
      inspectedAt: "2026-01-01T00:00:00.000Z",
    } as InspectionResult);
    expect(assessment.grade).toBe("A");
    expect(assessment.score).toBe(90);
  });
});
