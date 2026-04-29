import { describe, it, expect } from "vitest";
import { HeadersCheck } from "./headers.js";
import type { EndpointData } from "../types.js";

function makeEndpoint(headers: Record<string, string>): EndpointData {
  return {
    url: "https://example.com",
    statusCode: 200,
    headers,
    body: "",
    redirectChain: [],
  };
}

describe("HeadersCheck", () => {
  const check = new HeadersCheck();

  it("has the name 'headers'", () => {
    expect(check.name).toBe("headers");
  });

  it("returns all header values when present", async () => {
    const endpoint = makeEndpoint({
      server: "nginx",
      "x-powered-by": "Express",
      "content-security-policy": "default-src 'self'",
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "x-xss-protection": "1; mode=block",
      "referrer-policy": "no-referrer",
      "permissions-policy": "geolocation=()",
      "strict-transport-security": "max-age=31536000; includeSubDomains",
    });

    const result = await check.run(endpoint, "example.com");

    expect(result.name).toBe("headers");
    expect(result.data).toEqual({
      server: "nginx",
      poweredBy: "Express",
      contentSecurityPolicy: "default-src 'self'",
      xFrameOptions: "DENY",
      xContentTypeOptions: "nosniff",
      xXssProtection: "1; mode=block",
      referrerPolicy: "no-referrer",
      permissionsPolicy: "geolocation=()",
      strictTransportSecurity: "max-age=31536000; includeSubDomains",
      clickjackingProtection: true,
      xssProtection: true,
    });
  });

  it("returns nulls and false booleans when no security headers present", async () => {
    const endpoint = makeEndpoint({});

    const result = await check.run(endpoint, "example.com");

    expect(result.data).toEqual({
      server: null,
      poweredBy: null,
      contentSecurityPolicy: null,
      xFrameOptions: null,
      xContentTypeOptions: null,
      xXssProtection: null,
      referrerPolicy: null,
      permissionsPolicy: null,
      strictTransportSecurity: null,
      clickjackingProtection: false,
      xssProtection: false,
    });
  });

  it("handles partial headers correctly", async () => {
    const endpoint = makeEndpoint({
      server: "Apache",
      "x-frame-options": "SAMEORIGIN",
    });

    const result = await check.run(endpoint, "example.com");

    expect(result.data.server).toBe("Apache");
    expect(result.data.xFrameOptions).toBe("SAMEORIGIN");
    expect(result.data.clickjackingProtection).toBe(true);
    expect(result.data.poweredBy).toBeNull();
    expect(result.data.xXssProtection).toBeNull();
    expect(result.data.xssProtection).toBe(false);
  });

  it("derives clickjackingProtection from x-frame-options presence", async () => {
    const withHeader = await check.run(
      makeEndpoint({ "x-frame-options": "DENY" }),
      "example.com",
    );
    expect(withHeader.data.clickjackingProtection).toBe(true);

    const withoutHeader = await check.run(makeEndpoint({}), "example.com");
    expect(withoutHeader.data.clickjackingProtection).toBe(false);
  });

  it('sets xssProtection true for "1"', async () => {
    const result = await check.run(
      makeEndpoint({ "x-xss-protection": "1" }),
      "example.com",
    );
    expect(result.data.xssProtection).toBe(true);
  });

  it('sets xssProtection true for "1; mode=block"', async () => {
    const result = await check.run(
      makeEndpoint({ "x-xss-protection": "1; mode=block" }),
      "example.com",
    );
    expect(result.data.xssProtection).toBe(true);
  });

  it('sets xssProtection false for "0"', async () => {
    const result = await check.run(
      makeEndpoint({ "x-xss-protection": "0" }),
      "example.com",
    );
    expect(result.data.xssProtection).toBe(false);
  });
});
