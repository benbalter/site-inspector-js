import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EndpointData } from "../types.js";

const mockSafeFetch = vi.fn();
vi.mock("../utils.js", () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}));

import { WellKnownCheck } from "./well-known.js";

function makeEndpoint(url = "https://example.com/"): EndpointData {
  return {
    url,
    statusCode: 200,
    headers: {},
    body: "",
    redirectChain: [],
  };
}

function setupSafeFetch(
  handler: (url: string) => { statusCode: number; body: string } | null,
) {
  mockSafeFetch.mockImplementation(async (url: string) => {
    const res = handler(url);
    if (!res) return null;
    return {
      ok: res.statusCode >= 200 && res.statusCode < 300,
      statusCode: res.statusCode,
      headers: {},
      body: res.body,
      redirected: false,
      finalUrl: url,
    };
  });
}

describe("WellKnownCheck", () => {
  const check = new WellKnownCheck();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has the correct name", () => {
    expect(check.name).toBe("well-known");
  });

  it("parses a security.txt with all fields", async () => {
    const securityTxt = [
      "Contact: mailto:security@example.com",
      "Expires: 2025-12-31T23:59:59Z",
      "Encryption: https://example.com/pgp-key.txt",
      "Policy: https://example.com/security-policy",
    ].join("\n");

    setupSafeFetch((url) => {
      if (url.includes("security.txt")) {
        return { statusCode: 200, body: securityTxt };
      }
      return { statusCode: 404, body: "" };
    });

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.data.securityTxt).toEqual({
      present: true,
      contact: "mailto:security@example.com",
      expires: "2025-12-31T23:59:59Z",
      encryption: "https://example.com/pgp-key.txt",
      policy: "https://example.com/security-policy",
    });
    expect(result.data.changePassword).toBe(false);
    expect(result.data.openidConfiguration).toBe(false);
    expect(result.data.webfinger).toBe(false);
    expect(result.data.mtaSts).toBe(false);
    expect(result.data.assetlinks).toBe(false);
    expect(result.data.appleAppSiteAssociation).toBe(false);
    expect(result.data.nodeinfo).toBe(false);
    expect(result.data.humansTxt).toBe(false);
  });

  it("reports absent security.txt when not found", async () => {
    setupSafeFetch(() => ({ statusCode: 404, body: "" }));

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.data.securityTxt).toEqual({
      present: false,
      contact: null,
      expires: null,
      encryption: null,
      policy: null,
    });
  });

  it("detects change-password support (200)", async () => {
    setupSafeFetch((url) => {
      if (url.includes("change-password")) {
        return { statusCode: 200, body: "" };
      }
      return { statusCode: 404, body: "" };
    });

    const result = await check.run(makeEndpoint(), "example.com");
    expect(result.data.changePassword).toBe(true);
  });

  it("detects change-password support (redirect followed to 200)", async () => {
    setupSafeFetch((url) => {
      if (url.includes("change-password")) {
        return { statusCode: 200, body: "" };
      }
      return { statusCode: 404, body: "" };
    });

    const result = await check.run(makeEndpoint(), "example.com");
    expect(result.data.changePassword).toBe(true);
  });

  it("detects openid-configuration", async () => {
    setupSafeFetch((url) => {
      if (url.includes("openid-configuration")) {
        return { statusCode: 200, body: '{"issuer":"https://example.com"}' };
      }
      return { statusCode: 404, body: "" };
    });

    const result = await check.run(makeEndpoint(), "example.com");
    expect(result.data.openidConfiguration).toBe(true);
  });

  it("detects webfinger support", async () => {
    setupSafeFetch((url) => {
      if (url.includes("webfinger")) {
        return { statusCode: 200, body: '{"subject":"acct:test@test"}' };
      }
      return { statusCode: 404, body: "" };
    });

    const result = await check.run(makeEndpoint(), "example.com");
    expect(result.data.webfinger).toBe(true);
  });

  it("detects MTA-STS policy", async () => {
    setupSafeFetch((url) => {
      if (url.includes("mta-sts")) {
        return {
          statusCode: 200,
          body: "version: STSv1\nmode: enforce\nmx: mail.example.com\nmax_age: 86400",
        };
      }
      return { statusCode: 404, body: "" };
    });

    const result = await check.run(makeEndpoint(), "example.com");
    expect(result.data.mtaSts).toBe(true);
  });

  it("detects Android assetlinks.json", async () => {
    setupSafeFetch((url) => {
      if (url.includes("assetlinks.json")) {
        return { statusCode: 200, body: "[]" };
      }
      return { statusCode: 404, body: "" };
    });

    const result = await check.run(makeEndpoint(), "example.com");
    expect(result.data.assetlinks).toBe(true);
  });

  it("detects Apple app-site-association", async () => {
    setupSafeFetch((url) => {
      if (url.includes("apple-app-site-association")) {
        return { statusCode: 200, body: '{"applinks":{}}' };
      }
      return { statusCode: 404, body: "" };
    });

    const result = await check.run(makeEndpoint(), "example.com");
    expect(result.data.appleAppSiteAssociation).toBe(true);
  });

  it("detects nodeinfo (Fediverse)", async () => {
    setupSafeFetch((url) => {
      if (url.includes("nodeinfo")) {
        return { statusCode: 200, body: '{"links":[]}' };
      }
      return { statusCode: 404, body: "" };
    });

    const result = await check.run(makeEndpoint(), "example.com");
    expect(result.data.nodeinfo).toBe(true);
  });

  it("detects humans.txt", async () => {
    setupSafeFetch((url) => {
      if (url.includes("humans.txt")) {
        return { statusCode: 200, body: "/* TEAM */\nLead: Example" };
      }
      return { statusCode: 404, body: "" };
    });

    const result = await check.run(makeEndpoint(), "example.com");
    expect(result.data.humansTxt).toBe(true);
  });

  it("parses security.txt with comments and Acknowledgments", async () => {
    const securityTxt = [
      "# This is a comment",
      "Contact: mailto:admin@example.com",
      "# Another comment",
      "Acknowledgments: https://example.com/thanks",
      "",
    ].join("\n");

    setupSafeFetch((url) => {
      if (url.includes("security.txt")) {
        return { statusCode: 200, body: securityTxt };
      }
      return { statusCode: 404, body: "" };
    });

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.data.securityTxt).toEqual({
      present: true,
      contact: "mailto:admin@example.com",
      expires: null,
      encryption: null,
      policy: "https://example.com/thanks",
    });
  });

  it("handles network errors gracefully", async () => {
    mockSafeFetch.mockResolvedValue(null);

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.data.securityTxt).toEqual({
      present: false,
      contact: null,
      expires: null,
      encryption: null,
      policy: null,
    });
    expect(result.data.changePassword).toBe(false);
  });
});
