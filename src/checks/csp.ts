import { createRequire } from "node:module";
import type { EndpointData, CheckResult } from "../types.js";
import type { Check } from "./check.js";
import { parseHtml } from "../utils.js";

const require = createRequire(import.meta.url);
const { CspParser } = require("csp_evaluator/dist/parser");
const { CspEvaluator } = require("csp_evaluator");

// A TypeScript numeric enum: maps both name -> value and value -> name.
const { Severity } = require("csp_evaluator/dist/finding") as {
  Severity: Record<string, number> & Record<number, string>;
};

function severityLabel(severity: number): string {
  return Severity[severity] ?? "UNKNOWN";
}

// Directives a <meta> policy can't carry; browsers ignore them there.
const HEADER_ONLY_DIRECTIVES = new Set(["frame-ancestors", "report-uri", "sandbox"]);

/** Split a policy into its directives, keyed by lowercased name. */
function directives(policy: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of policy.split(";")) {
    const directive = part.trim();
    const name = directive.split(/\s+/)[0]?.toLowerCase();
    if (name && !map.has(name)) map.set(name, directive);
  }
  return map;
}

/** The <meta> policies in <head>, minus the directives browsers ignore there. */
function metaPolicy(endpoint: EndpointData): string | null {
  const $ = parseHtml(endpoint);
  const kept: string[] = [];
  $('head meta[http-equiv="content-security-policy" i][content]').each((_i, el) => {
    for (const [name, directive] of directives($(el).attr("content") ?? "")) {
      if (!HEADER_ONLY_DIRECTIVES.has(name)) kept.push(directive);
    }
  });
  return kept.length > 0 ? kept.join("; ") : null;
}

/**
 * Browsers enforce the header and <meta> policies together, so evaluate one
 * policy with each directive from whichever defines it. Where both do, the
 * real restriction is tighter than either, so keeping the header's errs
 * toward reporting too much rather than too little.
 */
function combinePolicies(header: string | null, meta: string | null): string | null {
  if (!header || !meta) return header ?? meta;
  const combined = directives(header);
  for (const [name, directive] of directives(meta)) {
    if (!combined.has(name)) combined.set(name, directive);
  }
  return [...combined.values()].join("; ");
}

export class CspCheck implements Check {
  name = "csp";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const rawPolicy = endpoint.headers["content-security-policy"] ?? null;
    const reportOnlyPolicy = endpoint.headers["content-security-policy-report-only"] ?? null;
    const meta = metaPolicy(endpoint);
    const policy = combinePolicies(rawPolicy, meta);

    if (!policy) {
      return {
        name: this.name,
        data: {
          hasCsp: false,
          hasReportOnly: reportOnlyPolicy !== null,
          rawPolicy: null,
          metaPolicy: null,
          findings: [],
          highSeverityCount: 0,
          mediumSeverityCount: 0,
          possibleIssueCount: 0,
          syntaxErrorCount: 0,
          infoCount: 0,
        },
      };
    }

    const parsed = new CspParser(policy).csp;
    const evaluator = new CspEvaluator(parsed);
    const rawFindings: Array<{
      severity: number;
      directive: string;
      description: string;
    }> = evaluator.evaluate();

    const count = (...severities: number[]) =>
      rawFindings.filter((f) => severities.includes(f.severity)).length;

    const findings = rawFindings.map((f) => ({
      severity: severityLabel(f.severity),
      directive: f.directive,
      description: f.description,
    }));

    return {
      name: this.name,
      data: {
        hasCsp: true,
        hasReportOnly: reportOnlyPolicy !== null,
        rawPolicy,
        metaPolicy: meta,
        findings,
        highSeverityCount: count(Severity.HIGH),
        mediumSeverityCount: count(Severity.MEDIUM),
        possibleIssueCount: count(Severity.HIGH_MAYBE, Severity.MEDIUM_MAYBE),
        syntaxErrorCount: count(Severity.SYNTAX),
        infoCount: count(Severity.INFO),
      },
    };
  }
}
