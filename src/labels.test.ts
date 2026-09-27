import { describe, it, expect } from "vitest";
import { booleanText, fieldLabel, formatFieldValue, titleCase, verdictGlyph } from "./labels.js";

describe("titleCase", () => {
  it("splits dashes, camelCase, and digit boundaries", () => {
    expect(titleCase("dns-security")).toBe("Dns Security");
    expect(titleCase("allSecure")).toBe("All Secure");
    expect(titleCase("h1Count")).toBe("H1 Count");
  });
});

describe("fieldLabel", () => {
  it.each([
    ["hasGraphQL", "Has GraphQL"],
    ["hasOpenAPI", "Has OpenAPI"],
    ["ipv6Reachable", "IPv6 Reachable"],
    ["h1Count", "H1 Count"],
    ["tls13", "TLS 1.3"],
    ["hasXDefault", "Has x-default"],
    ["xssProtection", "XSS Protection"],
    ["ogTitle", "OG Title"],
    ["hasJsonLd", "Has JSON-LD"],
    ["mtaSts", "MTA-STS"],
    ["tlsRpt", "TLS-RPT"],
    ["openidConfiguration", "OpenID Configuration"],
    ["robotsTxt", "robots.txt"],
    ["securityTxt", "security.txt"],
    ["includeSubDomains", "Include Subdomains"],
    ["p3p", "P3P"],
    ["responseTimeMs", "Response Time"],
    ["allSecure", "All Secure"],
    ["TLSv1.2", "TLSv1.2"],
  ])("%s -> %s", (key, label) => {
    expect(fieldLabel(key)).toBe(label);
  });
});

describe("formatFieldValue", () => {
  it.each([
    ["performance", "decodedBytes", 576274, "562.8 KB"],
    ["performance", "decodedBytes", 512, "512 B"],
    ["performance", "decodedBytes", 5 * 1024 * 1024, "5 MB"],
    ["performance", "responseTimeMs", 52, "52 ms"],
    ["performance", "responseTimeMs", 1234, "1.2 s"],
    ["hsts", "maxAge", 31536000, "1 year"],
    ["hsts", "maxAge", 63072000, "2 years"],
    ["cache-headers", "maxAge", 0, "0 seconds"],
    ["cache-headers", "maxAge", 3600, "1 hour"],
    ["whois", "domainAge", 6928, "19 years"],
    ["https", "certDaysRemaining", 63, "63 days"],
    ["https", "certDaysRemaining", 1, "1 day"],
  ])("%s.%s = %s -> %s", (check, path, value, expected) => {
    expect(formatFieldValue(check, path, value)).toBe(expected);
  });

  it("returns null for fields without a unit, or non-numbers", () => {
    expect(formatFieldValue("performance", "redirectCount", 3)).toBeNull();
    expect(formatFieldValue("hsts", "maxAge", "31536000")).toBeNull();
  });
});

describe("verdictGlyph", () => {
  it("shows the verdict, not the value", () => {
    expect(verdictGlyph("pass")).toBe("✓");
    expect(verdictGlyph("attention")).toBe("✗");
    expect(verdictGlyph("neutral")).toBe("·");
    expect(verdictGlyph("not-applicable")).toBe("–");
  });
});

describe("booleanText", () => {
  it("reads a true field as its label and a false one as a plain 'no'", () => {
    expect(booleanText("Valid", true)).toBe("Valid");
    expect(booleanText("Downgrades HTTPS", false)).toBe("Downgrades HTTPS: no");
  });
});
