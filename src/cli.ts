#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { inspect } from "./index.js";
import { assess, assessField } from "./assess.js";
import { availableChecks } from "./checks/index.js";
import type { InspectionResult } from "./types.js";
import type { Severity } from "./assess.js";

const program = new Command();

program
  .name("site-inspector")
  .description("Inspect a domain's technology, security, and capabilities")
  .version("0.1.0");

program
  .command("inspect")
  .description("Inspect a domain")
  .argument("<domain>", "Domain to inspect (e.g., example.com)")
  .option("-j, --json", "Output as JSON")
  .option("-a, --all-endpoints", "Show all 4 endpoint variants")
  .option("-c, --checks <checks>", "Comma-separated list of checks to run")
  .option("-i, --only-issues", "Show only items that need attention")
  .option("-t, --timeout <ms>", "Request timeout in milliseconds", "10000")
  .action(
    async (
      domain: string,
      opts: {
        json?: boolean;
        allEndpoints?: boolean;
        checks?: string;
        onlyIssues?: boolean;
        timeout?: string;
      },
    ) => {
      try {
        const checks = opts.checks?.split(",").map((c) => c.trim());
        const timeout = parseInt(opts.timeout ?? "10000", 10);

        if (checks) {
          const valid = availableChecks();
          const invalid = checks.filter((c) => !valid.includes(c));
          if (invalid.length > 0) {
            console.error(chalk.red(`Unknown checks: ${invalid.join(", ")}`));
            console.error(`Available: ${valid.join(", ")}`);
            process.exit(1);
          }
        }

        console.error(chalk.gray(`Inspecting ${domain}...`));
        const result = await inspect(domain, { timeout, checks, allEndpoints: opts.allEndpoints });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (opts.onlyIssues) {
          printIssues(result);
        } else {
          printResult(result);
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    },
  );

program
  .command("checks")
  .description("List available checks")
  .action(() => {
    console.log(chalk.bold("Available checks:"));
    for (const name of availableChecks()) {
      console.log(`  ${chalk.cyan(name)}`);
    }
  });

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
  printProp("Up", "up", props.up);
  printProp("HTTPS", "https", props.https);
  printProp("Enforces HTTPS", "enforcesHttps", props.enforcesHttps);
  printProp("Downgrades HTTPS", "downgradesHttps", props.downgradesHttps);
  printProp("WWW", "www", props.www);
  printProp("Root", "root", props.root);
  printProp("Canonically WWW", "canonicallyWww", props.canonicallyWww);
  printProp("Canonically HTTPS", "canonicallyHttps", props.canonicallyHttps);
  printProp("External Redirect", "redirect", props.redirect);
  if (props.redirectTarget) {
    console.log(`  ${chalk.gray("Redirect Target:")} ${props.redirectTarget}`);
  }
  console.log();

  // Check results
  for (const [name, check] of Object.entries(result.checks)) {
    console.log(chalk.bold(`${capitalize(name)} Check`));
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
      console.log(chalk.bold(capitalize(currentCheck)));
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
      console.log(`${pad}${chalk.gray(key + ":")} ${String(value)}`);
    }
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

program.parse();
