import { createRequire } from "node:module";
import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
// axe-core needs a window context
const axeSource = require.resolve("axe-core");

interface AxeViolation {
  id: string;
  impact: string;
  description: string;
  nodes: unknown[];
}

interface AxeResults {
  violations: AxeViolation[];
  passes: unknown[];
  incomplete: unknown[];
}

export class A11yAxeCheck implements Check {
  name = "a11y-axe";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const body = endpoint.body ?? "";

    if (!body.trim()) {
      return {
        name: this.name,
        data: {
          violations: 0,
          critical: 0,
          serious: 0,
          moderate: 0,
          minor: 0,
          passes: 0,
          incomplete: 0,
          topIssues: [],
        },
      };
    }

    try {
      const dom = new JSDOM(body, {
        runScripts: "dangerously",
        resources: "usable",
        pretendToBeVisual: true,
        url: endpoint.url,
      });

      // Inject axe-core
      const fs = require("fs");
      const axeScript = fs.readFileSync(axeSource, "utf-8");
      dom.window.eval(axeScript);

      const results = await new Promise<AxeResults>((resolve, reject) => {
        dom.window.axe.run(dom.window.document, { runOnly: ["wcag2a", "wcag2aa"] }, (err: Error | null, res: AxeResults) => {
          if (err) reject(err);
          else resolve(res);
        });
      });

      dom.window.close();

      const violations = results.violations || [];
      const bySeverity = { critical: 0, serious: 0, moderate: 0, minor: 0 };
      for (const v of violations) {
        const impact = v.impact as keyof typeof bySeverity;
        if (impact in bySeverity) bySeverity[impact]++;
      }

      const topIssues = violations.slice(0, 10).map((v: AxeViolation) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        nodes: v.nodes.length,
      }));

      return {
        name: this.name,
        data: {
          violations: violations.length,
          critical: bySeverity.critical,
          serious: bySeverity.serious,
          moderate: bySeverity.moderate,
          minor: bySeverity.minor,
          passes: (results.passes || []).length,
          incomplete: (results.incomplete || []).length,
          topIssues,
        },
      };
    } catch (error) {
      return {
        name: this.name,
        data: {
          violations: 0,
          critical: 0,
          serious: 0,
          moderate: 0,
          minor: 0,
          passes: 0,
          incomplete: 0,
          topIssues: [],
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}
