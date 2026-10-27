import { describe, it, expect, afterEach, vi } from "vitest";
import { VulnerableLibrariesCheck } from "./vulnerable-libraries.js";
import { stubFetch } from "../testing/fetch-stub.js";
import type { EndpointData } from "../types.js";

// These run against the real, vendored retire.js repository rather than a
// mock, so they also catch a repository update that changes its shape.

function makeEndpoint(body: string): EndpointData {
  return {
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    statusCode: 200,
    headers: { "content-type": "text/html" },
    setCookies: [],
    body,
    redirectChain: [],
  };
}

interface Library {
  component: string;
  version: string;
  vulnerabilities: number;
  highestSeverity: string | null;
  source: string;
}

describe("VulnerableLibrariesCheck", () => {
  const check = new VulnerableLibrariesCheck();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has the name 'vulnerable-libraries'", () => {
    expect(check.name).toBe("vulnerable-libraries");
  });

  it("finds a vulnerable library from its script URL, without downloading it", async () => {
    const spy = stubFetch({});
    const result = await check.run(
      makeEndpoint(
        '<script src="https://ajax.googleapis.com/ajax/libs/jquery/1.12.4/jquery.min.js"></script>',
      ),
      "example.com",
    );

    const libraries = result.data.libraries as Library[];
    expect(libraries).toHaveLength(1);
    expect(libraries[0]).toMatchObject({
      component: "jquery",
      version: "1.12.4",
      highestSeverity: "medium",
      source: "https://ajax.googleapis.com/ajax/libs/jquery/1.12.4/jquery.min.js",
    });
    expect(libraries[0].vulnerabilities).toBeGreaterThan(0);
    expect(result.data.vulnerableCount).toBe(1);
    expect(result.data.hasVulnerableLibraries).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("finds a library from a versioned file name", async () => {
    stubFetch({});
    const result = await check.run(
      makeEndpoint('<script src="/js/jquery-1.12.4.min.js"></script>'),
      "example.com",
    );
    expect((result.data.libraries as Library[])[0]).toMatchObject({
      component: "jquery",
      version: "1.12.4",
      source: "https://example.com/js/jquery-1.12.4.min.js",
    });
  });

  it("downloads unversioned scripts and reads the version from their contents", async () => {
    stubFetch({
      "https://example.com/js/vendor.js": {
        body: "/*! jQuery v3.4.1 | (c) JS Foundation and other contributors | jquery.org/license */\n!function(){}();",
      },
    });
    const result = await check.run(
      makeEndpoint('<script src="/js/vendor.js"></script>'),
      "example.com",
    );
    expect((result.data.libraries as Library[])[0]).toMatchObject({
      component: "jquery",
      version: "3.4.1",
      source: "https://example.com/js/vendor.js",
    });
  });

  it("scans inline scripts too", async () => {
    stubFetch({});
    const result = await check.run(
      makeEndpoint(
        "<script>/*! jQuery v3.4.1 | (c) JS Foundation and other contributors | jquery.org/license */</script>",
      ),
      "example.com",
    );
    expect((result.data.libraries as Library[])[0]).toMatchObject({
      component: "jquery",
      source: "inline",
    });
  });

  it("lists libraries without known vulnerabilities, but doesn't flag them", async () => {
    stubFetch({});
    const result = await check.run(
      makeEndpoint(
        '<script src="https://ajax.googleapis.com/ajax/libs/jquery/3.7.1/jquery.min.js"></script>',
      ),
      "example.com",
    );
    expect((result.data.libraries as Library[])[0]).toMatchObject({
      component: "jquery",
      version: "3.7.1",
      vulnerabilities: 0,
      highestSeverity: null,
    });
    expect(result.data.hasVulnerableLibraries).toBe(false);
  });

  it("reports each library once even when several scripts match it", async () => {
    stubFetch({});
    const result = await check.run(
      makeEndpoint(
        [
          '<script src="https://ajax.googleapis.com/ajax/libs/jquery/1.12.4/jquery.min.js"></script>',
          '<script src="/js/jquery-1.12.4.min.js"></script>',
        ].join(""),
      ),
      "example.com",
    );
    expect(result.data.libraries).toHaveLength(1);
  });

  it("reports nothing for a page without scripts", async () => {
    stubFetch({});
    const result = await check.run(makeEndpoint("<p>Hi</p>"), "example.com");
    expect(result.data).toMatchObject({
      scriptsScanned: 0,
      libraries: [],
      vulnerableCount: 0,
      hasVulnerableLibraries: false,
    });
  });
});
