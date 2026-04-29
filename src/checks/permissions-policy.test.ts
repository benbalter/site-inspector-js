import { describe, it, expect } from "vitest";
import type { EndpointData } from "../types.js";
import { PermissionsPolicyCheck } from "./permissions-policy.js";

function makeEndpoint(headers: Record<string, string> = {}): EndpointData {
  return {
    url: "https://example.com",
    statusCode: 200,
    headers,
    body: "",
    redirectChain: [],
  };
}

describe("PermissionsPolicyCheck", () => {
  const check = new PermissionsPolicyCheck();

  it("has name 'permissions-policy'", () => {
    expect(check.name).toBe("permissions-policy");
  });

  it("returns present: false when no header exists", async () => {
    const result = await check.run(makeEndpoint(), "example.com");
    expect(result.data).toEqual({
      present: false,
      headerType: null,
      features: {},
      blocked: [],
      allowed: [],
      dangerousGrants: [],
      rawHeader: null,
    });
  });

  it("detects camera and microphone blocked with empty allowlist", async () => {
    const result = await check.run(
      makeEndpoint({
        "permissions-policy": "camera=(), microphone=()",
      }),
      "example.com",
    );
    expect(result.data.present).toBe(true);
    expect(result.data.headerType).toBe("permissions-policy");
    expect(result.data.blocked).toEqual(["camera", "microphone"]);
    expect(result.data.allowed).toEqual([]);
    expect(result.data.dangerousGrants).toEqual([]);
  });

  it("identifies dangerous grants when sensitive features use wildcard", async () => {
    const result = await check.run(
      makeEndpoint({
        "permissions-policy":
          "camera=*, microphone=(self), geolocation=*, payment=()",
      }),
      "example.com",
    );
    expect(result.data.present).toBe(true);
    expect(result.data.dangerousGrants).toEqual(["camera", "geolocation"]);
    expect(result.data.blocked).toEqual(["payment"]);
    expect(result.data.allowed).toEqual(["camera", "microphone", "geolocation"]);
  });

  it("falls back to feature-policy header when permissions-policy is absent", async () => {
    const result = await check.run(
      makeEndpoint({
        "feature-policy": "camera 'none'; microphone 'self'",
      }),
      "example.com",
    );
    expect(result.data.present).toBe(true);
    expect(result.data.headerType).toBe("feature-policy");
    expect(result.data.rawHeader).toBe("camera 'none'; microphone 'self'");
  });

  it("prefers permissions-policy over feature-policy when both exist", async () => {
    const result = await check.run(
      makeEndpoint({
        "permissions-policy": "camera=()",
        "feature-policy": "camera 'none'",
      }),
      "example.com",
    );
    expect(result.data.headerType).toBe("permissions-policy");
    expect(result.data.rawHeader).toBe("camera=()");
  });

  it("parses mixed blocked and allowed features", async () => {
    const result = await check.run(
      makeEndpoint({
        "permissions-policy":
          "camera=(), geolocation=(self), microphone=*",
      }),
      "example.com",
    );
    expect(result.data.present).toBe(true);
    expect(result.data.blocked).toEqual(["camera"]);
    expect(result.data.allowed).toEqual(["geolocation", "microphone"]);
    expect(result.data.dangerousGrants).toEqual(["microphone"]);
    expect(result.data.features).toEqual({
      camera: "()",
      geolocation: "(self)",
      microphone: "*",
    });
  });

  it("handles whitespace and case-insensitivity in feature names", async () => {
    const result = await check.run(
      makeEndpoint({
        "permissions-policy":
          "  Camera = * , MICROPHONE = (self) , GeOlocation = () ",
      }),
      "example.com",
    );
    expect(result.data.features).toEqual({
      camera: "*",
      microphone: "(self)",
      geolocation: "()",
    });
    expect(result.data.blocked).toEqual(["geolocation"]);
  });

  it("identifies all dangerous features correctly", async () => {
    const result = await check.run(
      makeEndpoint({
        "permissions-policy":
          "camera=*, microphone=*, geolocation=*, payment=*, usb=*, bluetooth=*, serial=*, hid=*, display-capture=*, screen-wake-lock=*",
      }),
      "example.com",
    );
    expect(result.data.dangerousGrants).toEqual([
      "camera",
      "microphone",
      "geolocation",
      "payment",
      "usb",
      "bluetooth",
      "serial",
      "hid",
      "display-capture",
      "screen-wake-lock",
    ]);
  });

  it("does not flag non-sensitive features as dangerous even with wildcard", async () => {
    const result = await check.run(
      makeEndpoint({
        "permissions-policy": "accelerometer=*, gyroscope=*, magnetometer=*",
      }),
      "example.com",
    );
    expect(result.data.dangerousGrants).toEqual([]);
    expect(result.data.allowed).toEqual([
      "accelerometer",
      "gyroscope",
      "magnetometer",
    ]);
  });

  it("returns rawHeader with the original header value", async () => {
    const headerValue = "camera=*, microphone=(self)";
    const result = await check.run(
      makeEndpoint({
        "permissions-policy": headerValue,
      }),
      "example.com",
    );
    expect(result.data.rawHeader).toBe(headerValue);
  });
});
