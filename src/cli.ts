#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { inspect } from "./index.js";
import { availableChecks } from "./checks/index.js";
import type { InspectionResult } from "./types.js";

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
  .option("-t, --timeout <ms>", "Request timeout in milliseconds", "10000")
  .action(async (domain: string, opts: { json?: boolean; allEndpoints?: boolean; checks?: string; timeout?: string }) => {
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
      } else {
        printResult(result);
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
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

function printResult(result: InspectionResult): void {
  console.log();
  console.log(chalk.bold.underline(`Site Inspector: ${result.domain}`));
  console.log(chalk.gray(`Canonical URL: ${result.canonicalUrl || "(none)"}`));
  console.log(chalk.gray(`Inspected at:  ${result.inspectedAt}`));
  console.log();

  // Domain properties
  console.log(chalk.bold("Domain Properties"));
  const props = result.properties;
  printBool("Up", props.up);
  printBool("HTTPS", props.https);
  printBool("Enforces HTTPS", props.enforcesHttps);
  printBool("Downgrades HTTPS", props.downgradesHttps, true);
  printBool("WWW", props.www);
  printBool("Root", props.root);
  printBool("Canonically WWW", props.canonicallyWww);
  printBool("Canonically HTTPS", props.canonicallyHttps);
  printBool("External Redirect", props.redirect, true);
  if (props.redirectTarget) {
    console.log(`  ${chalk.gray("Redirect Target:")} ${props.redirectTarget}`);
  }
  console.log();

  // Check results
  for (const [name, check] of Object.entries(result.checks)) {
    console.log(chalk.bold(`${capitalize(name)} Check`));
    printData(check.data, 1);
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

function printBool(label: string, value: boolean, invertColor = false): void {
  const icon = value ? "✓" : "✗";
  const colorFn = invertColor ? (value ? chalk.red : chalk.green) : (value ? chalk.green : chalk.red);
  console.log(`  ${colorFn(icon)} ${label}`);
}

function printData(data: Record<string, unknown>, indent: number): void {
  const pad = "  ".repeat(indent);
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) {
      console.log(`${pad}${chalk.gray(key + ":")} ${chalk.dim("—")}`);
    } else if (typeof value === "boolean") {
      printBool(key, value);
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        console.log(`${pad}${chalk.gray(key + ":")} ${chalk.dim("(none)")}`);
      } else if (typeof value[0] === "object") {
        console.log(`${pad}${chalk.gray(key + ":")}`);
        for (const item of value) {
          printData(item as Record<string, unknown>, indent + 1);
          console.log(`${pad}  ${chalk.dim("---")}`);
        }
      } else {
        console.log(`${pad}${chalk.gray(key + ":")} ${value.join(", ")}`);
      }
    } else if (typeof value === "object") {
      console.log(`${pad}${chalk.gray(key + ":")}`);
      printData(value as Record<string, unknown>, indent + 1);
    } else {
      console.log(`${pad}${chalk.gray(key + ":")} ${String(value)}`);
    }
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

program.parse();
