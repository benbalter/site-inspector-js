import { readFile, writeFile } from "node:fs/promises";
import { text } from "node:stream/consumers";
import { Command, InvalidArgumentError } from "commander";
import chalk from "chalk";
import { inspect } from "./index.js";
import { PROPERTY_LABELS, assess, assessField, formatFieldValue, titleCase } from "./assess.js";
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
  screenshot?: string;
  jsonl?: boolean;
  input?: string;
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

/**
 * Move the Lighthouse screenshot out of the result and into a file, so a data
 * URI doesn't flood the terminal or the JSON.
 */
async function saveScreenshot(result: InspectionResult, path: string): Promise<void> {
  const data = result.checks.lighthouse?.data;
  const uri = data?.screenshot;
  if (data) delete data.screenshot;
  const match = typeof uri === "string" ? /^data:image\/\w+;base64,(.*)$/.exec(uri) : null;
  if (!match) {
    console.error(
      chalk.yellow(
        "No screenshot was taken: it comes from the lighthouse check, which needs Chrome.",
      ),
    );
    return;
  }
  await writeFile(path, Buffer.from(match[1], "base64"));
  console.error(chalk.gray(`Saved a screenshot to ${path}`));
}

/** The screenshot comes from Lighthouse, so `--screenshot` adds it to `--checks`. */
function withScreenshotCheck(checks?: string[], screenshot?: string): string[] | undefined {
  if (!checks || screenshot === undefined || checks.includes("lighthouse")) return checks;
  return [...checks, "lighthouse"];
}

/** Domains from the arguments, then from --input: one per line, `#` starts a comment. */
async function collectDomains(args: string[], input?: string): Promise<string[]> {
  if (input === undefined) return args;
  const contents = input === "-" ? await text(process.stdin) : await readFile(input, "utf8");
  const fromFile = contents
    .split("\n")
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean);
  return [...args, ...fromFile];
}

/** The JSON shape for one result, or just its issues with --only-issues. */
function jsonOutput(result: InspectionResult, assessment: Assessment, onlyIssues?: boolean) {
  const { attention, attentionCount } = assessment;
  return onlyIssues
    ? { domain: result.domain, canonicalUrl: result.canonicalUrl, attentionCount, attention }
    : { ...result, assessment: { attentionCount, attention } };
}

interface SummaryRow {
  domain: string;
  up: boolean;
  attentionCount: number;
  error?: string;
}

/** One line per domain after a multi-domain text run. */
function printBulkSummary(rows: SummaryRow[]): void {
  const width = Math.max(...rows.map((r) => r.domain.length));
  console.log(chalk.bold.underline("Summary"));
  for (const { domain, up, attentionCount, error } of rows) {
    const status = error
      ? chalk.red(`error: ${error}`)
      : !up
        ? chalk.red("down")
        : attentionCount > 0
          ? chalk.yellow(`${attentionCount} need attention`)
          : chalk.green(`${attentionCount} need attention`);
    console.log(`  ${domain.padEnd(width)}  ${status}`);
  }
  console.log();
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
    .description("Inspect one or more domains")
    .argument("[domains...]", "Domains to inspect (e.g., example.com)")
    .option("-f, --input <file>", "Also inspect the domains in a file, one per line (- for stdin)")
    .option("-j, --json", "Output as JSON (an array when inspecting several domains)")
    .option("--jsonl", "Output one line of JSON per domain")
    .option("-a, --all-endpoints", "Show all 4 endpoint variants")
    .option("-c, --checks <checks>", "Comma-separated list of checks to run", parseChecks)
    .option("-i, --only-issues", "Show only items that need attention")
    .option("--fail-on-issues", "Exit with status 1 if any item needs attention")
    .option("-s, --screenshot <file>", "Save a screenshot of the page (JPEG; runs Lighthouse)")
    .option("-t, --timeout <ms>", "Request timeout in milliseconds", parseTimeout, 10_000)
    .addHelpText(
      "after",
      "\nExit status: 0 on success, 1 on error (or issues with --fail-on-issues), 2 if the domain is down.\nWith several domains, the worst status wins.",
    )
    .action(async (args: string[], opts: InspectCliOptions) => {
      let domains: string[];
      try {
        domains = await collectDomains(args, opts.input);
      } catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exitCode = EXIT.error;
        return;
      }
      if (domains.length === 0) {
        console.error(
          chalk.red("Error: give a domain to inspect, or a file of them with --input."),
        );
        process.exitCode = EXIT.error;
        return;
      }
      if (opts.screenshot !== undefined && domains.length > 1) {
        console.error(chalk.red("Error: --screenshot takes a single domain."));
        process.exitCode = EXIT.error;
        return;
      }

      const many = domains.length > 1;
      const outputs: unknown[] = [];
      const summary: SummaryRow[] = [];
      let exitCode: number = EXIT.ok;

      // One at a time: heavy checks are serialized anyway, and it's gentler on
      // the sites and DNS resolvers involved.
      for (const [i, domain] of domains.entries()) {
        try {
          const progress = many ? ` (${i + 1}/${domains.length})` : "";
          console.error(chalk.gray(`Inspecting ${domain}${progress}...`));
          const result = await inspect(domain, {
            timeout: opts.timeout,
            checks: withScreenshotCheck(opts.checks, opts.screenshot),
            allEndpoints: opts.allEndpoints,
            screenshot: opts.screenshot !== undefined,
          });
          if (opts.screenshot !== undefined) await saveScreenshot(result, opts.screenshot);
          const assessment = assess(result);

          if (opts.jsonl) {
            console.log(JSON.stringify(jsonOutput(result, assessment, opts.onlyIssues)));
          } else if (opts.json) {
            outputs.push(jsonOutput(result, assessment, opts.onlyIssues));
          } else if (!result.properties.up) {
            printDown(result);
          } else if (opts.onlyIssues) {
            printIssues(result);
          } else {
            printResult(result);
          }

          const up = result.properties.up;
          summary.push({ domain: result.domain, up, attentionCount: assessment.attentionCount });
          if (!up) {
            exitCode = Math.max(exitCode, EXIT.down);
          } else if (opts.failOnIssues && assessment.attentionCount > 0) {
            exitCode = Math.max(exitCode, EXIT.error);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(chalk.red(`Error: ${many ? `${domain}: ` : ""}${message}`));
          summary.push({ domain, up: false, attentionCount: 0, error: message });
          exitCode = Math.max(exitCode, EXIT.error);
        }
      }

      if (opts.json && !opts.jsonl && outputs.length > 0) {
        console.log(JSON.stringify(many ? outputs : outputs[0], null, 2));
      }
      if (many && !opts.json && !opts.jsonl) printBulkSummary(summary);
      if (exitCode !== EXIT.ok) process.exitCode = exitCode;
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

function printResult(result: InspectionResult): void {
  console.log();
  console.log(chalk.bold.underline(`Site Inspector: ${result.domain}`));
  console.log(chalk.gray(`Canonical URL: ${result.canonicalUrl || "(none)"}`));
  console.log(chalk.gray(`Inspected at:  ${result.inspectedAt}`));
  printSummary(result);
  console.log();

  // Domain properties
  console.log(chalk.bold("Domain Properties"));
  const props = result.properties;
  for (const [key, label] of Object.entries(PROPERTY_LABELS)) {
    const value = props[key as keyof typeof props];
    if (typeof value === "boolean") printProp(label, key, value);
  }
  if (props.redirectTarget) {
    console.log(`  ${chalk.gray("Redirect Target:")} ${props.redirectTarget}`);
  }
  console.log();

  // Check results
  for (const [name, check] of Object.entries(result.checks)) {
    console.log(chalk.bold(`${titleCase(name)} Check`));
    printData(check.data, 1, name, "");
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
function printSummary(result: InspectionResult): void {
  const { attentionCount } = assess(result);
  if (attentionCount === 0) {
    console.log(chalk.green("✓ No issues found"));
  } else {
    const noun = attentionCount === 1 ? "item needs" : "items need";
    console.log(chalk.yellow(`⚠ ${attentionCount} ${noun} attention`));
  }
}

/** Compact view: only the fields that need attention, grouped by check. */
function printIssues(result: InspectionResult): void {
  console.log();
  console.log(chalk.bold.underline(`Site Inspector: ${result.domain}`));
  const { attention, attentionCount } = assess(result);
  if (attentionCount === 0) {
    console.log(chalk.green("✓ No issues found"));
    console.log();
    return;
  }
  const noun = attentionCount === 1 ? "item needs" : "items need";
  console.log(chalk.yellow.bold(`${attentionCount} ${noun} attention:`));
  console.log();
  let currentCheck = "";
  for (const finding of attention) {
    if (finding.check !== currentCheck) {
      currentCheck = finding.check;
      console.log(chalk.bold(titleCase(currentCheck)));
    }
    console.log(`  ${chalk.yellow("✗")} ${finding.label}`);
  }
  console.log();
}

/** Color a ✓/✗ glyph by verdict: pass=green, attention=yellow, neutral=dim. */
function severityGlyph(value: boolean, severity: Severity): string {
  const icon = value ? "✓" : "✗";
  if (severity === "pass") return chalk.green(icon);
  if (severity === "attention") return chalk.yellow(icon);
  return chalk.dim(icon);
}

/** Print a domain property, colored by its assessed verdict. */
function printProp(label: string, key: string, value: boolean): void {
  console.log(`  ${severityGlyph(value, assessField("properties", key, value))} ${label}`);
}

function printData(
  data: Record<string, unknown>,
  indent: number,
  checkName: string,
  prefix: string,
): void {
  const pad = "  ".repeat(indent);
  for (const [key, value] of Object.entries(data)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined) {
      console.log(`${pad}${chalk.gray(key + ":")} ${chalk.dim("—")}`);
    } else if (typeof value === "boolean") {
      console.log(`${pad}${severityGlyph(value, assessField(checkName, path, value))} ${key}`);
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        console.log(`${pad}${chalk.gray(key + ":")} ${chalk.dim("(none)")}`);
      } else if (typeof value[0] === "object") {
        console.log(`${pad}${chalk.gray(key + ":")}`);
        for (const item of value) {
          printData(item as Record<string, unknown>, indent + 1, checkName, path);
          console.log(`${pad}  ${chalk.dim("---")}`);
        }
      } else {
        console.log(`${pad}${chalk.gray(key + ":")} ${value.join(", ")}`);
      }
    } else if (typeof value === "object") {
      console.log(`${pad}${chalk.gray(key + ":")}`);
      printData(value as Record<string, unknown>, indent + 1, checkName, path);
    } else {
      const text = formatFieldValue(checkName, path, value) ?? String(value);
      console.log(`${pad}${chalk.gray(key + ":")} ${text}`);
    }
  }
}
