import { createRequire } from "node:module";
import type { EndpointData, CheckResult } from "../types.js";
import type { Check } from "./check.js";

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

export class CspCheck implements Check {
  name = "csp";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const rawPolicy = endpoint.headers["content-security-policy"] ?? null;
    const reportOnlyPolicy = endpoint.headers["content-security-policy-report-only"] ?? null;

    if (!rawPolicy) {
      return {
        name: this.name,
        data: {
          hasCsp: false,
          hasReportOnly: reportOnlyPolicy !== null,
          rawPolicy: null,
          findings: [],
          highSeverityCount: 0,
          mediumSeverityCount: 0,
          possibleIssueCount: 0,
          syntaxErrorCount: 0,
          infoCount: 0,
        },
      };
    }

    const parsed = new CspParser(rawPolicy).csp;
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
