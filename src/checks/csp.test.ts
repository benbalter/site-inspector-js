import { describe, it, expect } from "vitest";
import type { EndpointData } from "../types.js";
import { CspCheck } from "./csp.js";

// These tests run the real csp_evaluator, so severity mapping is checked
// against the library's actual values rather than invented ones.

function makeEndpoint(headers: Record<string, string> = {}, body = ""): EndpointData {
  return {
    url: "https://example.com",
    finalUrl: "https://example.com",
    statusCode: 200,
    headers,
    setCookies: [],
    body,
    redirectChain: [],
  };
}

describe("CspCheck", () => {
  const check = new CspCheck();

  it("has name 'csp'", () => {
    expect(check.name).toBe("csp");
  });

  it("returns hasCsp: false when no CSP header exists", async () => {
    const result = await check.run(makeEndpoint(), "example.com");
    expect(result.data).toEqual({
      hasCsp: false,
      hasReportOnly: false,
      rawPolicy: null,
      metaPolicy: null,
      findings: [],
      highSeverityCount: 0,
      mediumSeverityCount: 0,
      possibleIssueCount: 0,
      syntaxErrorCount: 0,
      infoCount: 0,
    });
  });

  it("labels and counts HIGH findings for unsafe-inline scripts", async () => {
    const csp = "script-src 'unsafe-inline'";
    const result = await check.run(makeEndpoint({ "content-security-policy": csp }), "example.com");

    expect(result.data.hasCsp).toBe(true);
    expect(result.data.rawPolicy).toBe(csp);
    expect(result.data.highSeverityCount).toBe(2);
    expect(result.data.findings).toContainEqual(
      expect.objectContaining({ severity: "HIGH", directive: "script-src" }),
    );
  });

  it("labels 'maybe' findings instead of reporting UNKNOWN", async () => {
    // csp_evaluator rates a 'self'-only policy as MEDIUM_MAYBE (50).
    const result = await check.run(
      makeEndpoint({
        "content-security-policy": "default-src 'self'; object-src 'none'; base-uri 'none'",
      }),
      "example.com",
    );

    expect(result.data.highSeverityCount).toBe(0);
    expect(result.data.possibleIssueCount).toBe(1);
    expect(result.data.findings).toEqual([
      expect.objectContaining({ severity: "MEDIUM_MAYBE", directive: "default-src" }),
    ]);
  });

  it("counts syntax errors separately from medium findings", async () => {
    const result = await check.run(
      makeEndpoint({ "content-security-policy": "default-src 'none'; scriptsrc 'self'" }),
      "example.com",
    );

    expect(result.data.syntaxErrorCount).toBeGreaterThan(0);
    expect(result.data.mediumSeverityCount).toBe(0);
    expect(result.data.findings).toContainEqual(expect.objectContaining({ severity: "SYNTAX" }));
  });

  it("detects report-only header", async () => {
    const result = await check.run(
      makeEndpoint({ "content-security-policy-report-only": "default-src 'self'" }),
      "example.com",
    );

    expect(result.data.hasCsp).toBe(false);
    expect(result.data.hasReportOnly).toBe(true);
  });

  it("handles both enforced and report-only headers", async () => {
    const csp = "default-src 'self'";
    const result = await check.run(
      makeEndpoint({
        "content-security-policy": csp,
        "content-security-policy-report-only": "script-src 'none'",
      }),
      "example.com",
    );

    expect(result.data.hasCsp).toBe(true);
    expect(result.data.hasReportOnly).toBe(true);
    expect(result.data.rawPolicy).toBe(csp);
  });

  describe("<meta> policies", () => {
    const meta = (policy: string) =>
      `<html><head><meta http-equiv="Content-Security-Policy" content="${policy}"></head></html>`;
    const strict = "script-src 'sha256-abc123='; object-src 'none'; base-uri 'none'";

    it("evaluates a policy delivered only in a <meta> tag", async () => {
      const result = await check.run(makeEndpoint({}, meta(strict)), "example.com");
      expect(result.data).toMatchObject({
        hasCsp: true,
        rawPolicy: null,
        metaPolicy: strict,
        highSeverityCount: 0,
      });
    });

    it("combines the header and <meta> policies, which browsers enforce together", async () => {
      // The common split: frame-ancestors can't go in <meta>, so it's the header.
      const result = await check.run(
        makeEndpoint({ "content-security-policy": "frame-ancestors 'none'" }, meta(strict)),
        "example.com",
      );
      expect(result.data).toMatchObject({
        hasCsp: true,
        rawPolicy: "frame-ancestors 'none'",
        metaPolicy: strict,
        highSeverityCount: 0,
      });
    });

    it("ignores directives browsers don't honor in <meta>", async () => {
      const result = await check.run(
        makeEndpoint({}, meta("frame-ancestors 'none'; report-uri /csp")),
        "example.com",
      );
      expect(result.data.hasCsp).toBe(false);
    });

    it("ignores a <meta> policy outside <head>", async () => {
      const body = `<html><head></head><body><meta http-equiv="content-security-policy" content="${strict}"></body></html>`;
      const result = await check.run(makeEndpoint({}, body), "example.com");
      expect(result.data).toMatchObject({ hasCsp: false, metaPolicy: null });
    });
  });
});
