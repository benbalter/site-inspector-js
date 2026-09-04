import { describe, it, expect } from "vitest";
import { assess, assessField } from "./assess.js";
import type { InspectionResult } from "./types.js";

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
    expect(spf?.label).toBe("Spf · Strong Policy");
    expect(spf?.severity).toBe("neutral");
    // The tracker fact is present as a finding but not attention.
    expect(a.findings.some((f) => f.path === "trackers.googleAnalytics")).toBe(true);
    expect(a.attention.some((f) => f.check === "privacy")).toBe(false);
  });
});
