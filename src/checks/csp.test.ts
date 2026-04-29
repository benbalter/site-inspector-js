import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EndpointData } from "../types.js";

const { mockCspParser, mockCspEvaluator } = vi.hoisted(() => ({
  mockCspParser: vi.fn(),
  mockCspEvaluator: vi.fn(),
}));

vi.mock("node:module", () => ({
  createRequire: () => (id: string) => {
    if (id === "csp_evaluator/dist/parser") {
      return { CspParser: mockCspParser };
    }
    if (id === "csp_evaluator") {
      return { CspEvaluator: mockCspEvaluator };
    }
    throw new Error(`Unexpected require: ${id}`);
  },
}));

import { CspCheck } from "./csp.js";

function makeEndpoint(headers: Record<string, string> = {}): EndpointData {
  return {
    url: "https://example.com",
    statusCode: 200,
    headers,
    body: "",
    redirectChain: [],
  };
}

describe("CspCheck", () => {
  const check = new CspCheck();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has name 'csp'", () => {
    expect(check.name).toBe("csp");
  });

  it("returns hasCsp: false when no CSP header exists", async () => {
    const result = await check.run(makeEndpoint(), "example.com");
    expect(result.data).toEqual({
      hasCsp: false,
      hasReportOnly: false,
      rawPolicy: null,
      findings: [],
      highSeverityCount: 0,
      mediumSeverityCount: 0,
      infoCount: 0,
    });
    expect(mockCspParser).not.toHaveBeenCalled();
  });

  it("returns hasCsp: true with no high severity findings for a strong CSP", async () => {
    const csp = "default-src 'none'; script-src 'self'; style-src 'self'";
    const mockParsed = { directives: [] };
    mockCspParser.mockImplementation(function (this: any) { this.csp = mockParsed; });
    mockCspEvaluator.mockImplementation(function () {
      return {
        evaluate: () => [
          {
            severity: 30,
            directive: "default-src",
            description: "No reporting configured",
          },
        ],
      };
    });

    const result = await check.run(
      makeEndpoint({ "content-security-policy": csp }),
      "example.com",
    );

    expect(result.data.hasCsp).toBe(true);
    expect(result.data.rawPolicy).toBe(csp);
    expect(result.data.highSeverityCount).toBe(0);
    expect(result.data.mediumSeverityCount).toBe(0);
    expect(result.data.infoCount).toBe(1);
    expect(result.data.findings).toEqual([
      {
        severity: "INFO",
        directive: "default-src",
        description: "No reporting configured",
      },
    ]);
  });

  it("reports high severity findings for weak CSP with unsafe-inline", async () => {
    const csp = "default-src 'self'; script-src 'unsafe-inline'";
    const mockParsed = { directives: [] };
    mockCspParser.mockImplementation(function (this: any) { this.csp = mockParsed; });
    mockCspEvaluator.mockImplementation(function () {
      return {
        evaluate: () => [
          {
            severity: 10,
            directive: "script-src",
            description: "'unsafe-inline' allows the execution of unsafe in-page scripts.",
          },
          {
            severity: 20,
            directive: "script-src",
            description: "Consider adding 'strict-dynamic'.",
          },
        ],
      };
    });

    const result = await check.run(
      makeEndpoint({ "content-security-policy": csp }),
      "example.com",
    );

    expect(result.data.hasCsp).toBe(true);
    expect(result.data.highSeverityCount).toBe(1);
    expect(result.data.mediumSeverityCount).toBe(1);
    expect(result.data.findings).toHaveLength(2);
    expect(result.data.findings[0].severity).toBe("HIGH");
    expect(result.data.findings[1].severity).toBe("MEDIUM");
  });

  it("detects report-only header", async () => {
    const result = await check.run(
      makeEndpoint({
        "content-security-policy-report-only": "default-src 'self'",
      }),
      "example.com",
    );

    expect(result.data.hasCsp).toBe(false);
    expect(result.data.hasReportOnly).toBe(true);
  });

  it("handles both enforced and report-only headers", async () => {
    const csp = "default-src 'self'";
    const mockParsed = { directives: [] };
    mockCspParser.mockImplementation(function (this: any) { this.csp = mockParsed; });
    mockCspEvaluator.mockImplementation(function () {
      return { evaluate: () => [] };
    });

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
    expect(result.data.findings).toEqual([]);
  });
});
