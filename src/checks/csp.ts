import { createRequire } from "node:module";
import type { EndpointData, CheckResult } from "../types.js";
import type { Check } from "./check.js";

const require = createRequire(import.meta.url);
const { CspParser } = require("csp_evaluator/dist/parser");
const { CspEvaluator } = require("csp_evaluator");

const SEVERITY_LABELS: Record<number, string> = {
  10: "HIGH",
  20: "MEDIUM",
  30: "INFO",
  0: "NONE",
};

function severityLabel(severity: number): string {
  return SEVERITY_LABELS[severity] ?? "UNKNOWN";
}

export class CspCheck implements Check {
  name = "csp";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const rawPolicy = endpoint.headers["content-security-policy"] ?? null;
    const reportOnlyPolicy =
      endpoint.headers["content-security-policy-report-only"] ?? null;

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
        highSeverityCount: rawFindings.filter((f) => f.severity === 10).length,
        mediumSeverityCount: rawFindings.filter((f) => f.severity === 20)
          .length,
        infoCount: rawFindings.filter((f) => f.severity === 30).length,
      },
    };
  }
}
