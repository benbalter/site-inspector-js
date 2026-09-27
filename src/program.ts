import { Command, InvalidArgumentError } from "commander";
import chalk from "chalk";
import { inspect } from "./index.js";
import {
  PROPERTY_LABELS,
  assess,
  booleanText,
  checkLabel,
  formatFieldValue,
  severityOf,
  verdictGlyph,
} from "./assess.js";
import { availableChecks } from "./checks/index.js";
import { VERSION } from "./utils.js";
import type { InspectionResult } from "./types.js";
import type { Assessment, Severity } from "./assess.js";

/** Exit codes the CLI can return. */
export const EXIT = {
  ok: 0,
  /** Bad input, an unexpected error, or issues found with --fail-on-issues. */
  error: 1,
  /** The domain didn't respond on any endpoint. */
  down: 2,
} as const;

interface InspectCliOptions {
  json?: boolean;
  allEndpoints?: boolean;
  checks?: string[];
  onlyIssues?: boolean;
  failOnIssues?: boolean;
  timeout: number;
}

function parseTimeout(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new InvalidArgumentError("Must be a positive whole number of milliseconds.");
  }
  return n;
}

function parseChecks(value: string): string[] {
  const names = value
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const valid = availableChecks();
  const invalid = names.filter((c) => !valid.includes(c));
  if (invalid.length > 0) {
    throw new InvalidArgumentError(
      `Unknown checks: ${invalid.join(", ")}\nAvailable: ${valid.join(", ")}`,
    );
  }
  if (names.length === 0) throw new InvalidArgumentError("No checks given.");
  return names;
}

/** Build the CLI program. Exported so tests can drive it without spawning a process. */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name("site-inspector")
    .description("Inspect a domain's technology, security, and capabilities")
    .version(VERSION);

  program
    .command("inspect")
    .description("Inspect a domain")
    .argument("<domain>", "Domain to inspect (e.g., example.com)")
    .option("-j, --json", "Output as JSON")
    .option("-a, --all-endpoints", "Show all 4 endpoint variants")
    .option("-c, --checks <checks>", "Comma-separated list of checks to run", parseChecks)
    .option("-i, --only-issues", "Show only items that need attention")
    .option("--fail-on-issues", "Exit with status 1 if any item needs attention")
    .option("-t, --timeout <ms>", "Request timeout in milliseconds", parseTimeout, 10_000)
    .addHelpText(
      "after",
      "\nExit status: 0 on success, 1 on error (or issues with --fail-on-issues), 2 if the domain is down.",
    )
    .action(async (domain: string, opts: InspectCliOptions) => {
      try {
        console.error(chalk.gray(`Inspecting ${domain}...`));
        const result = await inspect(domain, {
          timeout: opts.timeout,
          checks: opts.checks,
          allEndpoints: opts.allEndpoints,
        });
        const assessment = assess(result);

        if (opts.json) {
          const { attention, attentionCount, insights } = assessment;
          const output = opts.onlyIssues
            ? {
                domain: result.domain,
                canonicalUrl: result.canonicalUrl,
                attentionCount,
                attention,
                insights: insights.filter((i) => i.severity === "attention"),
              }
            : { ...result, assessment: { attentionCount, attention, insights } };
          console.log(JSON.stringify(output, null, 2));
        } else if (!result.properties.up) {
          printDown(result);
        } else if (opts.onlyIssues) {
          printIssues(result, assessment);
        } else {
          printResult(result, assessment);
        }

        if (!result.properties.up) {
          process.exitCode = EXIT.down;
        } else if (opts.failOnIssues && assessment.attentionCount > 0) {
          process.exitCode = EXIT.error;
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exitCode = EXIT.error;
      }
    });

  program
    .command("checks")
    .description("List available checks")
    .action(() => {
      console.log(chalk.bold("Available checks:"));
      for (const name of availableChecks()) {
        console.log(`  ${chalk.cyan(name)}`);
      }
    });

  return program;
}

/** A domain that didn't respond anywhere: say so, and show why. */
function printDown(result: InspectionResult): void {
  console.log();
  console.log(chalk.bold.underline(`Site Inspector: ${result.domain}`));
  console.log(chalk.red("✗ The domain did not respond on any endpoint."));
  for (const ep of result.endpoints ?? []) {
    console.log(`  ${chalk.red("✗")} ${ep.url}${ep.error ? chalk.gray(` — ${ep.error}`) : ""}`);
  }
  console.log();
}

function printResult(result: InspectionResult, assessment: Assessment): void {
  console.log();
  console.log(chalk.bold.underline(`Site Inspector: ${result.domain}`));
  console.log(chalk.gray(`Canonical URL: ${result.canonicalUrl || "(none)"}`));
  console.log(chalk.gray(`Inspected at:  ${result.inspectedAt}`));
  printSummary(assessment);
  console.log();

  // Domain properties
  console.log(chalk.bold("Domain Properties"));
  const props = result.properties;
  for (const [key, label] of Object.entries(PROPERTY_LABELS)) {
    const value = props[key as keyof typeof props];
    if (typeof value === "boolean") {
      console.log(
        `  ${booleanLine(label, value, severityOf(assessment, "properties", key, value))}`,
      );
    }
  }
  if (props.redirectTarget) {
    console.log(`  ${chalk.gray("Redirect Target:")} ${props.redirectTarget}`);
  }
  console.log();

  // Check results
  for (const [name, check] of Object.entries(result.checks)) {
    console.log(chalk.bold(checkLabel(name)));
    for (const insight of assessment.insights.filter((i) => i.check === name)) {
      const glyph = insight.severity === "pass" ? chalk.green("✓") : chalk.yellow("!");
      console.log(`  ${glyph} ${insight.title}${chalk.gray(` — ${insight.detail}`)}`);
    }
    printData(check.data, 1, name, "", assessment);
    console.log();
  }

  // Endpoints
  if (result.endpoints) {
    console.log(chalk.bold("All Endpoints"));
    for (const ep of result.endpoints) {
      const status = ep.up ? chalk.green("✓") : chalk.red("✗");
      const code = ep.statusCode ? chalk.gray(` (${ep.statusCode})`) : "";
      const redir = ep.redirect ? chalk.yellow(` → ${ep.redirectTarget}`) : "";
      console.log(`  ${status} ${ep.url}${code}${redir}`);
      if (ep.error) console.log(`    ${chalk.red(ep.error)}`);
    }
    console.log();
  }
}

/** Print the "N items need attention" rollup line. */
function printSummary({ attentionCount }: Assessment): void {
  if (attentionCount === 0) {
    console.log(chalk.green("✓ No issues found"));
  } else {
    const noun = attentionCount === 1 ? "item needs" : "items need";
    console.log(chalk.yellow(`⚠ ${attentionCount} ${noun} attention`));
  }
}

/** Compact view: only the fields that need attention, grouped by check. */
function printIssues(result: InspectionResult, assessment: Assessment): void {
  console.log();
  console.log(chalk.bold.underline(`Site Inspector: ${result.domain}`));
  const { attention, attentionCount, insights } = assessment;
  if (attentionCount === 0) {
    console.log(chalk.green("✓ No issues found"));
    console.log();
    return;
  }
  const noun = attentionCount === 1 ? "item needs" : "items need";
  console.log(chalk.yellow.bold(`${attentionCount} ${noun} attention:`));
  console.log();
  const items = [
    ...insights
      .filter((i) => i.severity === "attention")
      .map((i) => ({ check: i.check, text: `${i.title}${chalk.gray(` — ${i.detail}`)}` })),
    ...attention.map((f) => ({ check: f.check, text: f.label })),
  ];
  // Group by check, keeping each check's first appearance order.
  const order = [...new Set(items.map((i) => i.check))];
  for (const check of order) {
    console.log(chalk.bold(check === "properties" ? "Domain Properties" : checkLabel(check)));
    for (const item of items.filter((i) => i.check === check)) {
      console.log(`  ${chalk.yellow("✗")} ${item.text}`);
    }
  }
  console.log();
}

/** A boolean field: a glyph and color for its verdict, then its value as text. */
function booleanLine(label: string, value: boolean, severity: Severity): string {
  const glyph = verdictGlyph(severity);
  const colored =
    severity === "pass"
      ? chalk.green(glyph)
      : severity === "attention"
        ? chalk.yellow(glyph)
        : chalk.dim(glyph);
  return `${colored} ${booleanText(label, value)}`;
}

function printData(
  data: Record<string, unknown>,
  indent: number,
  checkName: string,
  prefix: string,
  assessment: Assessment,
): void {
  const pad = "  ".repeat(indent);
  for (const [key, value] of Object.entries(data)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined) {
      // Some absences are the finding (e.g. no X-Content-Type-Options).
      const missing =
        severityOf(assessment, checkName, path, null) === "attention"
          ? chalk.yellow("✗ missing")
          : chalk.dim("—");
      console.log(`${pad}${chalk.gray(key + ":")} ${missing}`);
    } else if (typeof value === "boolean") {
      console.log(
        `${pad}${booleanLine(key, value, severityOf(assessment, checkName, path, value))}`,
      );
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        console.log(`${pad}${chalk.gray(key + ":")} ${chalk.dim("(none)")}`);
      } else if (typeof value[0] === "object") {
        console.log(`${pad}${chalk.gray(key + ":")}`);
        for (const item of value) {
          printData(item as Record<string, unknown>, indent + 1, checkName, path, assessment);
          console.log(`${pad}  ${chalk.dim("---")}`);
        }
      } else {
        console.log(`${pad}${chalk.gray(key + ":")} ${value.join(", ")}`);
      }
    } else if (typeof value === "object") {
      console.log(`${pad}${chalk.gray(key + ":")}`);
      printData(value as Record<string, unknown>, indent + 1, checkName, path, assessment);
    } else {
      const text = formatFieldValue(checkName, path, value) ?? String(value);
      console.log(`${pad}${chalk.gray(key + ":")} ${text}`);
    }
  }
}
