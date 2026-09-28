import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { parseDictionary } from "structured-headers";

interface ReportToGroup {
  group: string;
  maxAge: number | null;
  includeSubdomains: boolean;
  endpoints: string[];
}

interface NelPolicy {
  reportTo: string | null;
  maxAge: number | null;
  includeSubdomains: boolean;
  successFraction: number;
  failureFraction: number;
}

interface NamedEndpoint {
  name: string;
  url: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function resolveUrl(url: string, base: string): string {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

/** Parse a JSON header that may arrive as several comma-joined objects. */
function parseJsonList(raw: string): Record<string, unknown>[] {
  const parsed: unknown = JSON.parse(`[${raw}]`);
  if (!Array.isArray(parsed) || !parsed.every((v) => v && typeof v === "object")) {
    throw new Error("expected JSON objects");
  }
  return parsed as Record<string, unknown>[];
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseReportTo(raw: string, base: string): ReportToGroup[] {
  return parseJsonList(raw).map((obj) => {
    const endpoints = Array.isArray(obj.endpoints) ? (obj.endpoints as unknown[]) : [];
    return {
      group: typeof obj.group === "string" ? obj.group : "default",
      maxAge: num(obj.max_age),
      includeSubdomains: obj.include_subdomains === true,
      endpoints: endpoints
        .map((e) => (e && typeof e === "object" ? (e as { url?: unknown }).url : undefined))
        .filter((u): u is string => typeof u === "string")
        .map((u) => resolveUrl(u, base)),
    };
  });
}

function parseNel(raw: string): NelPolicy {
  const [obj] = parseJsonList(raw);
  return {
    reportTo: typeof obj.report_to === "string" ? obj.report_to : null,
    maxAge: num(obj.max_age),
    includeSubdomains: obj.include_subdomains === true,
    // Defaults from the Network Error Logging spec.
    successFraction: num(obj.success_fraction) ?? 0,
    failureFraction: num(obj.failure_fraction) ?? 1,
  };
}

/**
 * Parse Reporting-Endpoints, an RFC 8941 dictionary of names to URL strings
 * (`default="https://r.example/a", csp="/csp"`).
 */
function parseReportingEndpoints(raw: string, base: string): NamedEndpoint[] {
  return [...parseDictionary(raw)].map(([name, member]) => {
    const [value] = member;
    if (typeof value !== "string") throw new Error(`"${name}" is not a string`);
    return { name, url: resolveUrl(value, base) };
  });
}

function cspDirectives(raw: string | null): Set<string> {
  const names = new Set<string>();
  if (!raw) return names;
  for (const policy of raw.split(",")) {
    for (const directive of policy.split(";")) {
      const name = directive.trim().split(/\s+/)[0]?.toLowerCase();
      if (name) names.add(name);
    }
  }
  return names;
}

export class ReportingCheck implements Check {
  name = "reporting";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const base = endpoint.finalUrl || endpoint.url;
    const h = endpoint.headers;

    const reportToRaw = h["report-to"] ?? null;
    let reportToGroups: ReportToGroup[] = [];
    let reportToError: string | null = null;
    if (reportToRaw !== null) {
      try {
        reportToGroups = parseReportTo(reportToRaw, base);
      } catch (err) {
        reportToError = errorMessage(err);
      }
    }

    const reportingEndpointsRaw = h["reporting-endpoints"] ?? null;
    let reportingEndpoints: NamedEndpoint[] = [];
    let reportingEndpointsError: string | null = null;
    if (reportingEndpointsRaw !== null) {
      try {
        reportingEndpoints = parseReportingEndpoints(reportingEndpointsRaw, base);
      } catch (err) {
        reportingEndpointsError = errorMessage(err);
      }
    }

    const nelRaw = h.nel ?? null;
    let nel: NelPolicy | null = null;
    let nelError: string | null = null;
    if (nelRaw !== null) {
      try {
        nel = parseNel(nelRaw);
      } catch (err) {
        nelError = errorMessage(err);
      }
    }

    const csp = cspDirectives(h["content-security-policy"] ?? null);
    const cspReportOnly = cspDirectives(h["content-security-policy-report-only"] ?? null);

    // NEL can only deliver reports to a group declared in Report-To.
    const nelGroupDefined =
      nel?.reportTo == null || reportToError !== null
        ? null
        : reportToGroups.some((g) => g.group === nel.reportTo);

    return {
      name: this.name,
      data: {
        reportToPresent: reportToRaw !== null,
        reportToGroups,
        reportToError,
        reportingEndpointsPresent: reportingEndpointsRaw !== null,
        reportingEndpoints,
        reportingEndpointsError,
        nelPresent: nelRaw !== null,
        nel,
        nelError,
        nelGroupDefined,
        cspReportUri: csp.has("report-uri"),
        cspReportTo: csp.has("report-to"),
        cspReportOnlyReportUri: cspReportOnly.has("report-uri"),
        cspReportOnlyReportTo: cspReportOnly.has("report-to"),
        hasReportingEndpoint:
          reportToGroups.some((g) => g.endpoints.length > 0) || reportingEndpoints.length > 0,
      },
    };
  }
}
