import { describe, it, expect, vi, beforeEach } from "vitest";
import { WellKnownCheck } from "./well-known.js";
import type { EndpointData } from "../types.js";

function makeEndpoint(url = "https://example.com/"): EndpointData {
  return {
    url,
    statusCode: 200,
    headers: {},
    body: "",
    redirectChain: [],
  };
}

function mockFetch(
  handler: (url: string) => { status: number; body: string },
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const { status, body } = handler(url);
      return {
        status,
        ok: status >= 200 && status < 300,
        text: async () => body,
      } as Response;
    }),
  );
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

    mockFetch((url) => {
      if (url.includes("security.txt")) {
        return { status: 200, body: securityTxt };
      }
      return { status: 404, body: "" };
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
  });

  it("reports absent security.txt when not found", async () => {
    mockFetch(() => ({ status: 404, body: "" }));

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
    mockFetch((url) => {
      if (url.includes("change-password")) {
        return { status: 200, body: "" };
      }
      return { status: 404, body: "" };
    });

    const result = await check.run(makeEndpoint(), "example.com");
    expect(result.data.changePassword).toBe(true);
  });

  it("detects change-password support (redirect)", async () => {
    mockFetch((url) => {
      if (url.includes("change-password")) {
        return { status: 302, body: "" };
      }
      return { status: 404, body: "" };
    });

    const result = await check.run(makeEndpoint(), "example.com");
    expect(result.data.changePassword).toBe(true);
  });

  it("parses security.txt with comments and Acknowledgments", async () => {
    const securityTxt = [
      "# This is a comment",
      "Contact: mailto:admin@example.com",
      "# Another comment",
      "Acknowledgments: https://example.com/thanks",
      "",
    ].join("\n");

    mockFetch((url) => {
      if (url.includes("security.txt")) {
        return { status: 200, body: securityTxt };
      }
      return { status: 404, body: "" };
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Network error");
      }),
    );

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
