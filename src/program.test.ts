import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    });
  });

  it("lists issues with --only-issues", async () => {
    await run("inspect", "example.com", "--only-issues");
    const out = stdout.join("\n");
    expect(out).toMatch(/1 item needs attention/);
    expect(out).toMatch(/Hsts/);
    expect(out).toContain("Strict-Transport-Security");
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

  it("titles check sections readably", async () => {
    inspectMock.mockResolvedValue(
      makeResult({ checks: { "dns-security": { name: "dns-security", data: {} } } }),
    );
    await run("inspect", "example.com");
    expect(stdout.join("\n")).toMatch(/Dns Security Check/);
  });

  it("formats numeric fields in their units", async () => {
    inspectMock.mockResolvedValue(
      makeResult({ checks: { hsts: { name: "hsts", data: { enabled: true, maxAge: 31536000 } } } }),
    );
    await run("inspect", "example.com");
    expect(stdout.join("\n")).toMatch(/maxAge:.*1 year/);
  });
});

describe("--screenshot", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "site-inspector-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const withShot = (screenshot: string | null) =>
    makeResult({
      checks: {
        lighthouse: {
          name: "lighthouse",
          data: { available: true, screenshot },
        },
      },
    });

  it("asks for a screenshot, saves it, and keeps the data URI out of the output", async () => {
    inspectMock.mockResolvedValue(withShot(`data:image/jpeg;base64,${jpeg.toString("base64")}`));
    const file = join(dir, "shot.jpg");

    expect(await run("inspect", "example.com", "--json", "--screenshot", file)).toBe(0);

    expect(inspectMock).toHaveBeenCalledWith(
      "example.com",
      expect.objectContaining({ screenshot: true }),
    );
    expect(await readFile(file)).toEqual(jpeg);
    const out = JSON.parse(stdout.join("\n"));
    expect(out.checks.lighthouse.data).not.toHaveProperty("screenshot");
    expect(stderr.join("\n")).toContain(file);
  });

  it("adds lighthouse to --checks, since it takes the screenshot", async () => {
    await run("inspect", "example.com", "-c", "dns", "--screenshot", join(dir, "shot.jpg"));
    expect(inspectMock).toHaveBeenCalledWith(
      "example.com",
      expect.objectContaining({ checks: ["dns", "lighthouse"] }),
    );
  });

  it("warns when no screenshot was taken", async () => {
    inspectMock.mockResolvedValue(makeResult());
    expect(await run("inspect", "example.com", "--screenshot", join(dir, "shot.jpg"))).toBe(0);
    expect(stderr.join("\n")).toMatch(/No screenshot/);
  });
});

describe("several domains", () => {
  const clean = (domain: string) =>
    makeResult({
      domain,
      checks: { hsts: { name: "hsts", data: { enabled: true } } },
    });

  beforeEach(() => {
    inspectMock.mockImplementation(async (domain: string) => clean(domain));
  });

  it("inspects each domain in turn", async () => {
    expect(await run("inspect", "a.test", "b.test")).toBe(0);
    expect(inspectMock.mock.calls.map(([d]) => d)).toEqual(["a.test", "b.test"]);
  });

  it("reads more domains from --input, skipping blank lines and comments", async () => {
    const dir = await mkdtemp(join(tmpdir(), "site-inspector-"));
    const file = join(dir, "domains.txt");
    await writeFile(file, "b.test\n\n# a comment\n  c.test  \n");
    try {
      await run("inspect", "a.test", "--input", file, "--jsonl");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    expect(inspectMock.mock.calls.map(([d]) => d)).toEqual(["a.test", "b.test", "c.test"]);
  });

  it("prints one JSON object per line with --jsonl", async () => {
    await run("inspect", "a.test", "b.test", "--jsonl");
    expect(stdout).toHaveLength(2);
    const lines = stdout.map((line) => JSON.parse(line));
    expect(lines.map((l) => l.domain)).toEqual(["a.test", "b.test"]);
    expect(lines[0].assessment).toEqual({ attentionCount: 0, attention: [] });
  });

  it("prints a JSON array with --json", async () => {
    await run("inspect", "a.test", "b.test", "--json");
    const out = JSON.parse(stdout.join("\n"));
    expect(out.map((r: InspectionResult) => r.domain)).toEqual(["a.test", "b.test"]);
  });

  it("ends text output with a summary of every domain", async () => {
    inspectMock.mockImplementation(async (domain: string) =>
      domain === "b.test" ? makeResult({ domain }) : clean(domain),
    );
    await run("inspect", "a.test", "b.test");
    const out = stdout.join("\n");
    expect(out).toMatch(/a\.test.*0 need attention/);
    expect(out).toMatch(/b\.test.*1 need attention/);
  });

  it("keeps going after an error, and exits 1", async () => {
    inspectMock.mockImplementation(async (domain: string) => {
      if (domain === "a.test") throw new Error("boom");
      return clean(domain);
    });
    expect(await run("inspect", "a.test", "b.test", "--jsonl")).toBe(EXIT.error);
    expect(inspectMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(stdout[0]).domain).toBe("b.test");
    expect(stderr.join("\n")).toContain("a.test: boom");
  });

  it("lists failed domains in the text summary", async () => {
    inspectMock.mockImplementation(async (domain: string) => {
      if (domain === "a.test") throw new Error("boom");
      return clean(domain);
    });
    await run("inspect", "a.test", "b.test");
    expect(stdout.join("\n")).toMatch(/a\.test.*error: boom/);
  });

  it("exits with the worst status across domains", async () => {
    inspectMock.mockImplementation(async (domain: string) =>
      domain === "down.test" ? { ...downResult, domain } : makeResult({ domain }),
    );
    expect(await run("inspect", "a.test", "down.test", "--fail-on-issues", "--jsonl")).toBe(
      EXIT.down,
    );
  });

  it("refuses --screenshot with more than one domain", async () => {
    expect(await run("inspect", "a.test", "b.test", "--screenshot", "x.jpg")).toBe(EXIT.error);
    expect(inspectMock).not.toHaveBeenCalled();
  });

  it("needs at least one domain", async () => {
    expect(await run("inspect")).toBe(EXIT.error);
    expect(inspectMock).not.toHaveBeenCalled();
  });
});
