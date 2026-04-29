import { describe, it, expect } from "vitest";
import { ReferrerPolicyCheck } from "./referrer-policy.js";
import type { EndpointData } from "../types.js";

function makeEndpoint(headers: Record<string, string> = {}): EndpointData {
  return {
    url: "https://example.com",
    statusCode: 200,
    headers,
    body: "",
    redirectChain: [],
  };
}

describe("ReferrerPolicyCheck", () => {
  const check = new ReferrerPolicyCheck();

  it("reports no header when referrer-policy is absent", async () => {
    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.name).toBe("referrer-policy");
    expect(result.data.present).toBe(false);
    expect(result.data.policy).toBe(null);
    expect(result.data.strictness).toBe("none");
    expect(result.data.recommended).toBe("strict-origin-when-cross-origin");
    expect(result.data.rawHeader).toBe(null);
  });

  it("identifies strict policy (no-referrer)", async () => {
    const result = await check.run(
      makeEndpoint({ "referrer-policy": "no-referrer" }),
      "example.com",
    );

    expect(result.data.present).toBe(true);
    expect(result.data.policy).toBe("no-referrer");
    expect(result.data.strictness).toBe("strict");
    expect(result.data.rawHeader).toBe("no-referrer");
  });

  it("identifies strict policy (same-origin)", async () => {
    const result = await check.run(
      makeEndpoint({ "referrer-policy": "same-origin" }),
      "example.com",
    );

    expect(result.data.present).toBe(true);
    expect(result.data.policy).toBe("same-origin");
    expect(result.data.strictness).toBe("strict");
  });

  it("identifies strict policy (strict-origin)", async () => {
    const result = await check.run(
      makeEndpoint({ "referrer-policy": "strict-origin" }),
      "example.com",
    );

    expect(result.data.present).toBe(true);
    expect(result.data.policy).toBe("strict-origin");
    expect(result.data.strictness).toBe("strict");
  });

  it("identifies moderate policy (strict-origin-when-cross-origin)", async () => {
    const result = await check.run(
      makeEndpoint({
        "referrer-policy": "strict-origin-when-cross-origin",
      }),
      "example.com",
    );

    expect(result.data.present).toBe(true);
    expect(result.data.policy).toBe("strict-origin-when-cross-origin");
    expect(result.data.strictness).toBe("moderate");
  });

  it("identifies moderate policy (origin)", async () => {
    const result = await check.run(
      makeEndpoint({ "referrer-policy": "origin" }),
      "example.com",
    );

    expect(result.data.present).toBe(true);
    expect(result.data.policy).toBe("origin");
    expect(result.data.strictness).toBe("moderate");
  });

  it("identifies moderate policy (origin-when-cross-origin)", async () => {
    const result = await check.run(
      makeEndpoint({ "referrer-policy": "origin-when-cross-origin" }),
      "example.com",
    );

    expect(result.data.present).toBe(true);
    expect(result.data.policy).toBe("origin-when-cross-origin");
    expect(result.data.strictness).toBe("moderate");
  });

  it("identifies loose policy (no-referrer-when-downgrade)", async () => {
    const result = await check.run(
      makeEndpoint({ "referrer-policy": "no-referrer-when-downgrade" }),
      "example.com",
    );

    expect(result.data.present).toBe(true);
    expect(result.data.policy).toBe("no-referrer-when-downgrade");
    expect(result.data.strictness).toBe("loose");
  });

  it("identifies loose policy (unsafe-url)", async () => {
    const result = await check.run(
      makeEndpoint({ "referrer-policy": "unsafe-url" }),
      "example.com",
    );

    expect(result.data.present).toBe(true);
    expect(result.data.policy).toBe("unsafe-url");
    expect(result.data.strictness).toBe("loose");
  });

  it("handles case-insensitive policy values", async () => {
    const result = await check.run(
      makeEndpoint({ "referrer-policy": "NO-REFERRER" }),
      "example.com",
    );

    expect(result.data.policy).toBe("no-referrer");
    expect(result.data.strictness).toBe("strict");
  });

  it("handles comma-separated fallback values (uses last recognized)", async () => {
    const result = await check.run(
      makeEndpoint({
        "referrer-policy": "invalid-policy, strict-origin-when-cross-origin",
      }),
      "example.com",
    );

    expect(result.data.present).toBe(true);
    expect(result.data.policy).toBe("strict-origin-when-cross-origin");
    expect(result.data.strictness).toBe("moderate");
    expect(result.data.rawHeader).toBe(
      "invalid-policy, strict-origin-when-cross-origin",
    );
  });

  it("handles comma-separated fallback values with multiple valid policies (uses last)", async () => {
    const result = await check.run(
      makeEndpoint({
        "referrer-policy": "no-referrer, origin, strict-origin-when-cross-origin",
      }),
      "example.com",
    );

    expect(result.data.present).toBe(true);
    expect(result.data.policy).toBe("strict-origin-when-cross-origin");
    expect(result.data.strictness).toBe("moderate");
  });

  it("uses last unrecognized policy when no recognized policies present", async () => {
    const result = await check.run(
      makeEndpoint({
        "referrer-policy": "some-invalid, another-invalid",
      }),
      "example.com",
    );

    expect(result.data.present).toBe(true);
    expect(result.data.policy).toBe("another-invalid");
    expect(result.data.strictness).toBe("none");
  });

  it("returns correct check name", async () => {
    const result = await check.run(
      makeEndpoint({ "referrer-policy": "no-referrer" }),
      "example.com",
    );

    expect(result.name).toBe("referrer-policy");
  });

  it("includes raw header in result", async () => {
    const raw = "strict-origin-when-cross-origin";
    const result = await check.run(
      makeEndpoint({ "referrer-policy": raw }),
      "example.com",
    );

    expect(result.data.rawHeader).toBe(raw);
  });
});
