import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { InspectionResult } from "./types.js";

const { inspectMock } = vi.hoisted(() => ({ inspectMock: vi.fn() }));
vi.mock("./index.js", () => ({ inspect: inspectMock }));

const { buildProgram, EXIT } = await import("./program.js");

function makeResult(overrides: Partial<InspectionResult> = {}): InspectionResult {
  return {
    domain: "example.com",
    canonicalUrl: "https://example.com",
    properties: {
      up: true,
      www: true,
      root: true,
      https: true,
      enforcesHttps: true,
      downgradesHttps: false,
      canonicallyWww: false,
      canonicallyHttps: true,
      serverError: false,
      redirect: false,
    },
    checks: {
      hsts: { name: "hsts", data: { enabled: false } },
    },
    inspectedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const downResult = makeResult({
  canonicalUrl: "",
  properties: { ...makeResult().properties, up: false, https: false },
  checks: {},
  endpoints: [
    { url: "https://example.com", up: false, redirect: false, error: "getaddrinfo ENOTFOUND" },
  ],
});

let stdout: string[];
let stderr: string[];

/** Run the CLI with the given args; returns the resulting exit code. */
async function run(...args: string[]): Promise<number> {
  const program = buildProgram()
    .exitOverride()
    .configureOutput({
      writeOut: (s) => stdout.push(s),
      writeErr: (s) => stderr.push(s),
    });
  for (const cmd of program.commands) {
    cmd.exitOverride().configureOutput({
      writeOut: (s) => stdout.push(s),
      writeErr: (s) => stderr.push(s),
    });
  }
  try {
    await program.parseAsync(["node", "site-inspector", ...args]);
  } catch (err) {
    return (err as { exitCode?: number }).exitCode ?? 1;
  }
  return Number(process.exitCode ?? 0);
}

beforeEach(() => {
  stdout = [];
  stderr = [];
  process.exitCode = undefined;
  inspectMock.mockReset().mockResolvedValue(makeResult());
  vi.spyOn(console, "log").mockImplementation((...a) => void stdout.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a) => void stderr.push(a.join(" ")));
});

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("CLI", () => {
  it("rejects a non-numeric timeout", async () => {
    expect(await run("inspect", "example.com", "-t", "abc")).toBe(1);
    expect(stderr.join("")).toMatch(/positive whole number/);
    expect(inspectMock).not.toHaveBeenCalled();
  });

  it("rejects unknown checks", async () => {
    expect(await run("inspect", "example.com", "-c", "dns,bogus")).toBe(1);
    expect(stderr.join("")).toMatch(/Unknown checks: bogus/);
    expect(inspectMock).not.toHaveBeenCalled();
  });

  it("ignores empty entries in --checks", async () => {
    expect(await run("inspect", "example.com", "-c", "dns,,headers,")).toBe(0);
    expect(inspectMock).toHaveBeenCalledWith(
      "example.com",
      expect.objectContaining({ checks: ["dns", "headers"], timeout: 10_000 }),
    );
  });

  it("passes a valid timeout through as a number", async () => {
    await run("inspect", "example.com", "-t", "2500");
    expect(inspectMock).toHaveBeenCalledWith(
      "example.com",
      expect.objectContaining({ timeout: 2500 }),
    );
  });

  it("prints JSON with an assessment summary", async () => {
    expect(await run("inspect", "example.com", "--json")).toBe(0);
    const out = JSON.parse(stdout.join("\n"));
    expect(out.domain).toBe("example.com");
    expect(out.checks.hsts).toBeDefined();
    expect(out.assessment.attentionCount).toBe(1);
    expect(out.assessment.attention[0]).toMatchObject({ check: "hsts", path: "enabled" });
  });

  it("prints only the issues as JSON with --json --only-issues", async () => {
    await run("inspect", "example.com", "--json", "--only-issues");
    const out = JSON.parse(stdout.join("\n"));
    expect(out).toEqual({
      domain: "example.com",
      canonicalUrl: "https://example.com",
      attentionCount: 1,
      attention: [expect.objectContaining({ check: "hsts", path: "enabled" })],
      insights: [],
    });
  });

  it("lists issues with --only-issues", async () => {
    await run("inspect", "example.com", "--only-issues");
    const out = stdout.join("\n");
    expect(out).toMatch(/1 item needs attention/);
    expect(out).toMatch(/HSTS/);
  });

  it("lists cross-check insights with --only-issues", async () => {
    inspectMock.mockResolvedValue(
      makeResult({
        checks: {
          "dns-security": {
            name: "dns-security",
            data: {
              spf: { exists: false, error: null },
              dmarc: { exists: false, error: null },
            },
          },
        },
      }),
    );
    await run("inspect", "example.com", "--only-issues");
    const out = stdout.join("\n");
    expect(out).toMatch(/SPF & DMARC/);
    expect(out).toMatch(/Email from this domain can be spoofed/);
  });

  it("exits 0 when issues exist without --fail-on-issues", async () => {
    expect(await run("inspect", "example.com")).toBe(EXIT.ok);
  });

  it("exits 1 with --fail-on-issues when something needs attention", async () => {
    expect(await run("inspect", "example.com", "--fail-on-issues")).toBe(EXIT.error);
  });

  it("exits 0 with --fail-on-issues when nothing needs attention", async () => {
    inspectMock.mockResolvedValue(
      makeResult({ checks: { hsts: { name: "hsts", data: { enabled: true } } } }),
    );
    expect(await run("inspect", "example.com", "--fail-on-issues")).toBe(EXIT.ok);
  });

  it("exits 2 and shows endpoint errors when the domain is down", async () => {
    inspectMock.mockResolvedValue(downResult);
    expect(await run("inspect", "example.com")).toBe(EXIT.down);
    expect(stdout.join("\n")).toMatch(/did not respond[\s\S]*ENOTFOUND/);
  });

  it("exits 1 when inspect throws", async () => {
    inspectMock.mockRejectedValue(new Error("boom"));
    expect(await run("inspect", "example.com")).toBe(EXIT.error);
    expect(stderr.join("")).toMatch(/Error: boom/);
  });

  it("titles check sections with the shared check labels", async () => {
    inspectMock.mockResolvedValue(
      makeResult({ checks: { "dns-security": { name: "dns-security", data: {} } } }),
    );
    await run("inspect", "example.com");
    expect(stdout.join("\n")).toMatch(/SPF & DMARC/);
  });

  it("formats numeric fields in their units", async () => {
    inspectMock.mockResolvedValue(
      makeResult({ checks: { hsts: { name: "hsts", data: { enabled: true, maxAge: 31536000 } } } }),
    );
    await run("inspect", "example.com");
    expect(stdout.join("\n")).toMatch(/maxAge:.*1 year/);
  });
});
