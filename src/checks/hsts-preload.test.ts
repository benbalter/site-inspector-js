import { describe, it, expect, vi, afterEach } from "vitest";
import { HstsPreloadCheck } from "./hsts-preload.js";
import type { EndpointData } from "../types.js";
import { stubFetch } from "../testing/fetch-stub.js";

function makeEndpoint(): EndpointData {
  return {
    url: "https://example.com",
    finalUrl: "https://example.com",
    statusCode: 200,
    headers: {},
    setCookies: [],
    body: "",
    redirectChain: [],
  };
}

const STATUS = "https://hstspreload.org/api/v2/status?domain=example.com";
const PRELOADABLE = "https://hstspreload.org/api/v2/preloadable?domain=example.com";

/** Stub both hstspreload.org endpoints with the API's real response shapes. */
function stubApi(status: object, preloadable: object) {
  return stubFetch({
    [STATUS]: { body: JSON.stringify(status) },
    [PRELOADABLE]: { body: JSON.stringify(preloadable) },
  });
}

const noHeader = {
  code: "response.no_header",
  summary: "No HSTS header",
  message: "Response error: No HSTS header is present on the response.",
};

describe("HstsPreloadCheck", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const check = new HstsPreloadCheck();

  it("has name 'hsts-preload'", () => {
    expect(check.name).toBe("hsts-preload");
  });

  it("reports a preloaded, eligible domain", async () => {
    stubApi({ name: "example.com", status: "preloaded" }, { errors: [], warnings: [] });

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.name).toBe("hsts-preload");
    expect(result.data).toEqual({
      preloaded: true,
      status: "preloaded",
      eligible: true,
      errors: [],
      warnings: [],
    });
  });

  it("reports an ineligible domain with its errors", async () => {
    stubApi({ status: "unknown" }, { errors: [noHeader], warnings: [] });

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.data).toEqual({
      preloaded: false,
      status: "unknown",
      eligible: false,
      errors: [noHeader],
      warnings: [],
    });
  });

  it("is still eligible when there are only warnings", async () => {
    const warning = { code: "header.preloadable.max_age.over_2_years", summary: "", message: "" };
    stubApi({ status: "pending" }, { errors: [], warnings: [warning] });

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.data).toMatchObject({ status: "pending", eligible: true, warnings: [warning] });
  });

  it.each(["removed", "pending", "unknown"])("passes through status %s", async (status) => {
    stubApi({ status }, { errors: [], warnings: [] });
    const result = await check.run(makeEndpoint(), "example.com");
    expect(result.data).toMatchObject({ preloaded: false, status });
  });

  it("reports eligibility as unknown when the API is unreachable", async () => {
    stubFetch({});

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.data).toEqual({
      preloaded: false,
      status: "unknown",
      eligible: null,
      errors: [],
      warnings: [],
    });
  });

  it("encodes the domain in the URLs", async () => {
    const spy = stubFetch({});
    await check.run(makeEndpoint(), "example-test.com");
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("domain=example-test.com"),
      expect.any(Object),
    );
  });
});
