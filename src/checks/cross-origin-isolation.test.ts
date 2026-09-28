import { describe, it, expect } from "vitest";
import type { EndpointData } from "../types.js";
import { CrossOriginIsolationCheck } from "./cross-origin-isolation.js";

function makeEndpoint(
  headers: Record<string, string>,
  finalUrl = "https://example.com/",
): EndpointData {
  return {
    url: "http://example.com/",
    finalUrl,
    statusCode: 200,
    headers,
    setCookies: [],
    body: "",
    redirectChain: [],
  };
}

describe("CrossOriginIsolationCheck", () => {
  const check = new CrossOriginIsolationCheck();

  it("has the correct name", () => {
    expect(check.name).toBe("cross-origin-isolation");
  });

  it("reports an isolated page with require-corp", async () => {
    const result = await check.run(
      makeEndpoint({
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-embedder-policy": "require-corp",
        "cross-origin-resource-policy": "same-origin",
      }),
      "example.com",
    );
    expect(result).toEqual({
      name: "cross-origin-isolation",
      data: {
        coopPresent: true,
        coop: "same-origin",
        coopRaw: "same-origin",
        coepPresent: true,
        coep: "require-corp",
        coepRaw: "require-corp",
        corpPresent: true,
        corp: "same-origin",
        corpRaw: "same-origin",
        coopReportOnlyPresent: false,
        coopReportOnly: null,
        coepReportOnlyPresent: false,
        coepReportOnly: null,
        isolated: true,
      },
    });
  });

  it("treats credentialless COEP as isolating", async () => {
    const result = await check.run(
      makeEndpoint({
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-embedder-policy": "credentialless",
      }),
      "example.com",
    );
    expect(result.data.isolated).toBe(true);
    expect(result.data.corpPresent).toBe(false);
  });

  it("ignores report-to parameters", async () => {
    const result = await check.run(
      makeEndpoint({
        "cross-origin-opener-policy": 'same-origin; report-to="coop"',
        "cross-origin-embedder-policy": 'require-corp;report-to="coep"',
      }),
      "example.com",
    );
    expect(result.data.coop).toBe("same-origin");
    expect(result.data.coep).toBe("require-corp");
    expect(result.data.coopRaw).toBe('same-origin; report-to="coop"');
    expect(result.data.isolated).toBe(true);
  });

  it("treats a wrongly cased token as invalid, as browsers do", async () => {
    // Structured-field tokens are case-sensitive (RFC 8941).
    const result = await check.run(
      makeEndpoint({ "cross-origin-opener-policy": "Same-Origin" }),
      "example.com",
    );
    expect(result.data.coopPresent).toBe(true);
    expect(result.data.coop).toBeNull();
  });

  it("is not isolated over plain HTTP", async () => {
    const result = await check.run(
      makeEndpoint(
        {
          "cross-origin-opener-policy": "same-origin",
          "cross-origin-embedder-policy": "require-corp",
        },
        "http://example.com/",
      ),
      "example.com",
    );
    expect(result.data.coop).toBe("same-origin");
    expect(result.data.isolated).toBe(false);
  });

  it("is not isolated with same-origin-allow-popups", async () => {
    const result = await check.run(
      makeEndpoint({
        "cross-origin-opener-policy": "same-origin-allow-popups",
        "cross-origin-embedder-policy": "require-corp",
      }),
      "example.com",
    );
    expect(result.data.coop).toBe("same-origin-allow-popups");
    expect(result.data.isolated).toBe(false);
  });

  it("is not isolated without COEP", async () => {
    const result = await check.run(
      makeEndpoint({ "cross-origin-opener-policy": "same-origin" }),
      "example.com",
    );
    expect(result.data.coepPresent).toBe(false);
    expect(result.data.coep).toBeNull();
    expect(result.data.isolated).toBe(false);
  });

  it("reports no headers", async () => {
    const result = await check.run(makeEndpoint({}), "example.com");
    expect(result.data).toMatchObject({
      coopPresent: false,
      coop: null,
      coopRaw: null,
      coepPresent: false,
      corpPresent: false,
      isolated: false,
    });
  });

  it("reports unknown or duplicated values as present but unparsed", async () => {
    const result = await check.run(
      makeEndpoint({
        "cross-origin-opener-policy": "same-origin, same-origin",
        "cross-origin-resource-policy": "bogus",
      }),
      "example.com",
    );
    expect(result.data.coopPresent).toBe(true);
    expect(result.data.coop).toBeNull();
    expect(result.data.corpPresent).toBe(true);
    expect(result.data.corp).toBeNull();
  });

  it("reports report-only variants separately", async () => {
    const result = await check.run(
      makeEndpoint({
        "cross-origin-opener-policy-report-only": 'same-origin; report-to="coop"',
        "cross-origin-embedder-policy-report-only": "require-corp",
      }),
      "example.com",
    );
    expect(result.data.coopReportOnlyPresent).toBe(true);
    expect(result.data.coopReportOnly).toBe("same-origin");
    expect(result.data.coepReportOnlyPresent).toBe(true);
    expect(result.data.coepReportOnly).toBe("require-corp");
    expect(result.data.coopPresent).toBe(false);
    expect(result.data.isolated).toBe(false);
  });
});
