import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { EndpointData } from "../types.js";
import { stubFetch, type FakeResponse } from "../testing/fetch-stub.js";

const mockIsCatchAll = vi.fn();
vi.mock("../utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils.js")>()),
  isCatchAll: (...args: unknown[]) => mockIsCatchAll(...args) as unknown,
}));

import { ExposedFilesCheck, EXPOSED_FILES } from "./exposed-files.js";

const ORIGIN = "https://www.example.com";
const EXPOSED_FILE_PATHS = Object.values(EXPOSED_FILES);

function makeEndpoint(body = "<html><head><title>Home</title></head></html>"): EndpointData {
  return {
    url: "http://example.com/",
    finalUrl: `${ORIGIN}/`,
    statusCode: 200,
    headers: {},
    setCookies: [],
    body,
    redirectChain: [],
  };
}

const NOT_FOUND: FakeResponse = { status: 404, body: "Not Found" };

/** Every probed path answers 404 unless overridden. */
function routes(overrides: Record<string, FakeResponse> = {}): Record<string, FakeResponse> {
  const out: Record<string, FakeResponse> = {};
  for (const path of EXPOSED_FILE_PATHS) out[`${ORIGIN}${path}`] = NOT_FOUND;
  for (const [path, res] of Object.entries(overrides)) out[`${ORIGIN}${path}`] = res;
  return out;
}

const SECRET = "hunter2-s3cr3t";

const EXPOSED: Record<string, FakeResponse> = {
  "/.git/HEAD": { body: "ref: refs/heads/main\n" },
  "/.env": {
    headers: { "content-type": "text/plain" },
    body: `# app config\nAPP_ENV=production\nDB_PASSWORD=${SECRET}\n`,
  },
  "/.DS_Store": {
    headers: { "content-type": "application/octet-stream" },
    body: "\0\0\0\u0001Bud1\0\0\u0010\0\0\0\b\0\0\0\u0010\0\0\0",
  },
  "/server-status": {
    body: "<html><head><title>Apache Status</title></head><body><h1>Apache Server Status for www.example.com</h1>",
  },
  "/.svn/entries": { body: "10\n\ndir\n1234\nhttps://svn.example.com/repo/trunk\n" },
  "/wp-config.php.bak": {
    body: `<?php\ndefine( 'DB_NAME', 'wp' );\ndefine( 'DB_PASSWORD', '${SECRET}' );\n`,
  },
};

describe("ExposedFilesCheck", () => {
  const check = new ExposedFilesCheck();

  beforeEach(() => {
    mockIsCatchAll.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has the correct name", () => {
    expect(check.name).toBe("exposed-files");
  });

  it("reports nothing exposed when every probe 404s", async () => {
    stubFetch(routes());
    const result = await check.run(makeEndpoint(), "example.com");
    expect(result).toEqual({
      name: "exposed-files",
      data: {
        files: {
          gitHead: false,
          env: false,
          dsStore: false,
          serverStatus: false,
          svnEntries: false,
          wpConfigBackup: false,
        },
        exposed: [],
        exposedCount: 0,
        directoryListing: false,
        catchAll: false,
      },
    });
  });

  it("detects every file by its content signature without leaking contents", async () => {
    stubFetch(routes(EXPOSED));
    const result = await check.run(makeEndpoint(), "example.com");
    expect(result.data.exposed).toEqual(EXPOSED_FILE_PATHS);
    expect(result.data.exposedCount).toBe(EXPOSED_FILE_PATHS.length);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain("refs/heads");
  });

  it("probes against the final origin", async () => {
    const spy = stubFetch(routes());
    await check.run(makeEndpoint(), "example.com");
    const urls = spy.mock.calls.map(([u]) => String(u));
    expect(urls).toContain(`${ORIGIN}/.git/HEAD`);
    expect(mockIsCatchAll).toHaveBeenCalledWith(ORIGIN, 5000);
  });

  it("accepts a detached-HEAD SHA", async () => {
    stubFetch(routes({ "/.git/HEAD": { body: "4b825dc642cb6eb9a060e54bf8d69288fbee4904\n" } }));
    const result = await check.run(makeEndpoint(), "example.com");
    expect(result.data.exposed).toEqual(["/.git/HEAD"]);
  });

  it("ignores a soft-404 HTML page answering 200 on a catch-all site", async () => {
    mockIsCatchAll.mockResolvedValue(true);
    const page = {
      headers: { "content-type": "text/html; charset=utf-8" },
      body: "<!DOCTYPE html><html><body><p>API_KEY=not-really</p>Apache docs</body></html>",
    };
    stubFetch(routes(Object.fromEntries(EXPOSED_FILE_PATHS.map((p) => [p, page]))));
    const result = await check.run(makeEndpoint(), "example.com");
    expect(result.data.exposedCount).toBe(0);
    expect(result.data.catchAll).toBe(true);
  });

  it("ignores a signature on a non-200 response", async () => {
    stubFetch(routes({ "/.git/HEAD": { status: 403, body: "ref: refs/heads/main" } }));
    const result = await check.run(makeEndpoint(), "example.com");
    expect((result.data.files as Record<string, unknown>).gitHead).toBe(false);
  });

  it("trusts a bare SVN format number only when the site isn't a catch-all", async () => {
    stubFetch(routes({ "/.svn/entries": { body: "12\n" } }));
    const plain = await check.run(makeEndpoint(), "example.com");
    expect(plain.data.exposed).toEqual(["/.svn/entries"]);

    mockIsCatchAll.mockResolvedValue(true);
    const catchAll = await check.run(makeEndpoint(), "example.com");
    expect(catchAll.data.exposed).toEqual([]);
  });

  it("reports null, not false, when a probe fails", async () => {
    const { [`${ORIGIN}/.env`]: _unreachable, ...r } = routes();
    stubFetch(r);
    const result = await check.run(makeEndpoint(), "example.com");
    const files = result.data.files as Record<string, boolean | null>;
    expect(files.env).toBeNull();
    expect(files.gitHead).toBe(false);
    expect(result.data.exposedCount).toBe(0);
  });

  it("reports null for every path once the check is aborted", async () => {
    stubFetch(routes(EXPOSED));
    const controller = new AbortController();
    controller.abort();
    const result = await check.run(makeEndpoint(), "example.com", {
      timeoutMs: 1000,
      signal: controller.signal,
    });
    expect(Object.values(result.data.files as object)).toEqual(EXPOSED_FILE_PATHS.map(() => null));
    expect(result.data.exposedCount).toBe(0);
  });

  it("detects a directory listing on the homepage", async () => {
    stubFetch(routes());
    const result = await check.run(
      makeEndpoint("<html><head><title>Index of /</title></head><body><h1>Index of /</h1>"),
      "example.com",
    );
    expect(result.data.directoryListing).toBe(true);
  });
});
