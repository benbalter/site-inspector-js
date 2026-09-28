import { describe, it, expect } from "vitest";
import type { EndpointData } from "../types.js";
import { ReportingCheck } from "./reporting.js";

function makeEndpoint(headers: Record<string, string>): EndpointData {
  return {
    url: "http://example.com/",
    finalUrl: "https://www.example.com/",
    statusCode: 200,
    headers,
    setCookies: [],
    body: "",
    redirectChain: [],
  };
}

// Shapes as sent by real sites (e.g. Cloudflare's NEL and GitHub's CSP reporting).
const CLOUDFLARE_REPORT_TO =
  '{"endpoints":[{"url":"https:\\/\\/a.nel.cloudflare.com\\/report\\/v4?s=abc"}],"group":"cf-nel","max_age":604800}';
const CLOUDFLARE_NEL = '{"success_fraction":0,"report_to":"cf-nel","max_age":604800}';

describe("ReportingCheck", () => {
  const check = new ReportingCheck();

  it("has the correct name", () => {
    expect(check.name).toBe("reporting");
  });

  it("parses Report-To and NEL", async () => {
    const result = await check.run(
      makeEndpoint({ "report-to": CLOUDFLARE_REPORT_TO, nel: CLOUDFLARE_NEL }),
      "example.com",
    );
    expect(result.name).toBe("reporting");
    expect(result.data).toEqual({
      reportToPresent: true,
      reportToGroups: [
        {
          group: "cf-nel",
          maxAge: 604800,
          includeSubdomains: false,
          endpoints: ["https://a.nel.cloudflare.com/report/v4?s=abc"],
        },
      ],
      reportToError: null,
      reportingEndpointsPresent: false,
      reportingEndpoints: [],
      reportingEndpointsError: null,
      nelPresent: true,
      nel: {
        reportTo: "cf-nel",
        maxAge: 604800,
        includeSubdomains: false,
        successFraction: 0,
        failureFraction: 1,
      },
      nelError: null,
      nelGroupDefined: true,
      cspReportUri: false,
      cspReportTo: false,
      cspReportOnlyReportUri: false,
      cspReportOnlyReportTo: false,
      hasReportingEndpoint: true,
    });
  });

  it("parses several comma-joined Report-To groups and defaults the group name", async () => {
    const raw =
      '{"max_age":10886400,"endpoints":[{"url":"/r"}]}, {"group":"csp","max_age":1,"include_subdomains":true,"endpoints":[{"url":"https://r.example/csp"}]}';
    const result = await check.run(makeEndpoint({ "report-to": raw }), "example.com");
    expect(result.data.reportToGroups).toEqual([
      {
        group: "default",
        maxAge: 10886400,
        includeSubdomains: false,
        endpoints: ["https://www.example.com/r"],
      },
      {
        group: "csp",
        maxAge: 1,
        includeSubdomains: true,
        endpoints: ["https://r.example/csp"],
      },
    ]);
  });

  it("parses Reporting-Endpoints and resolves relative URLs against finalUrl", async () => {
    const result = await check.run(
      makeEndpoint({
        "reporting-endpoints": 'default="https://r.example/a", csp-endpoint="/csp";foo=1,x="a\\"b"',
      }),
      "example.com",
    );
    expect(result.data.reportingEndpointsPresent).toBe(true);
    expect(result.data.reportingEndpointsError).toBeNull();
    expect(result.data.reportingEndpoints).toEqual([
      { name: "default", url: "https://r.example/a" },
      { name: "csp-endpoint", url: "https://www.example.com/csp" },
      { name: "x", url: "https://www.example.com/a%22b" },
    ]);
    expect(result.data.hasReportingEndpoint).toBe(true);
  });

  it("reports parse errors as fields instead of throwing", async () => {
    const result = await check.run(
      makeEndpoint({
        "report-to": "{not json",
        "reporting-endpoints": "default=https://unquoted.example",
        nel: '"a string"',
      }),
      "example.com",
    );
    expect(result.data.reportToPresent).toBe(true);
    expect(result.data.reportToGroups).toEqual([]);
    expect(typeof result.data.reportToError).toBe("string");
    expect(result.data.reportingEndpointsPresent).toBe(true);
    expect(result.data.reportingEndpoints).toEqual([]);
    expect(result.data.reportingEndpointsError).toMatch(/not a string/);
    expect(result.data.nelPresent).toBe(true);
    expect(result.data.nel).toBeNull();
    expect(typeof result.data.nelError).toBe("string");
    expect(result.data.nelGroupDefined).toBeNull();
    expect(result.data.hasReportingEndpoint).toBe(false);
  });

  it("skips parameters with quoted strings", async () => {
    const result = await check.run(
      makeEndpoint({ "reporting-endpoints": 'default="https://r/a";foo="x,\\"y", b="/b"' }),
      "example.com",
    );
    expect(result.data.reportingEndpointsError).toBeNull();
    expect(result.data.reportingEndpoints).toEqual([
      { name: "default", url: "https://r/a" },
      { name: "b", url: "https://www.example.com/b" },
    ]);
  });

  it("rejects an unterminated Reporting-Endpoints string", async () => {
    const result = await check.run(
      makeEndpoint({ "reporting-endpoints": 'default="https://r.example' }),
      "example.com",
    );
    expect(result.data.reportingEndpointsError).toMatch(/Unexpected end of input/);
  });

  it("flags a NEL group that Report-To doesn't declare", async () => {
    const result = await check.run(
      makeEndpoint({
        "report-to": '{"group":"other","max_age":1,"endpoints":[{"url":"https://r.example"}]}',
        nel: '{"report_to":"network-errors","max_age":1,"success_fraction":0.01,"failure_fraction":0.5}',
      }),
      "example.com",
    );
    expect(result.data.nelGroupDefined).toBe(false);
    expect(result.data.nel).toMatchObject({ successFraction: 0.01, failureFraction: 0.5 });
  });

  it("detects CSP report-uri and report-to in enforced and report-only policies", async () => {
    const result = await check.run(
      makeEndpoint({
        "content-security-policy":
          "default-src 'none'; report-uri https://api.github.com/_private/browser/errors",
        "content-security-policy-report-only": "script-src 'self'; report-to csp-endpoint",
      }),
      "example.com",
    );
    expect(result.data.cspReportUri).toBe(true);
    expect(result.data.cspReportTo).toBe(false);
    expect(result.data.cspReportOnlyReportUri).toBe(false);
    expect(result.data.cspReportOnlyReportTo).toBe(true);
  });

  it("doesn't mistake a report-uri source value for the directive", async () => {
    const result = await check.run(
      makeEndpoint({ "content-security-policy": "default-src 'self' report-uri.example" }),
      "example.com",
    );
    expect(result.data.cspReportUri).toBe(false);
  });

  it("reports nothing configured", async () => {
    const result = await check.run(makeEndpoint({}), "example.com");
    expect(result.data).toMatchObject({
      reportToPresent: false,
      reportingEndpointsPresent: false,
      nelPresent: false,
      nel: null,
      nelGroupDefined: null,
      cspReportUri: false,
      cspReportTo: false,
      hasReportingEndpoint: false,
    });
  });
});
