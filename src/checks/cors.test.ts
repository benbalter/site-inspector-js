import { describe, it, expect } from "vitest";
import type { EndpointData } from "../types.js";
import { CorsCheck } from "./cors.js";

function makeEndpoint(headers: Record<string, string> = {}): EndpointData {
  return {
    url: "https://example.com",
    statusCode: 200,
    headers,
    body: "",
    redirectChain: [],
  };
}

describe("CorsCheck", () => {
  const check = new CorsCheck();

  it("has name 'cors'", () => {
    expect(check.name).toBe("cors");
  });

  it("returns enabled: false with all defaults when no CORS headers exist", async () => {
    const result = await check.run(makeEndpoint(), "example.com");
    expect(result.data).toEqual({
      enabled: false,
      allowOrigin: null,
      allowCredentials: false,
      allowMethods: [],
      allowHeaders: [],
      exposeHeaders: [],
      maxAge: null,
      wildcard: false,
      misconfigured: false,
    });
  });

  it("detects wildcard origin with enabled: true and wildcard: true", async () => {
    const result = await check.run(
      makeEndpoint({
        "access-control-allow-origin": "*",
      }),
      "example.com",
    );
    expect(result.data.enabled).toBe(true);
    expect(result.data.wildcard).toBe(true);
    expect(result.data.allowOrigin).toBe("*");
  });

  it("detects specific origin with wildcard: false", async () => {
    const result = await check.run(
      makeEndpoint({
        "access-control-allow-origin": "https://example.com",
      }),
      "example.com",
    );
    expect(result.data.enabled).toBe(true);
    expect(result.data.wildcard).toBe(false);
    expect(result.data.allowOrigin).toBe("https://example.com");
  });

  it("marks misconfigured: true when wildcard origin is combined with credentials", async () => {
    const result = await check.run(
      makeEndpoint({
        "access-control-allow-origin": "*",
        "access-control-allow-credentials": "true",
      }),
      "example.com",
    );
    expect(result.data.wildcard).toBe(true);
    expect(result.data.allowCredentials).toBe(true);
    expect(result.data.misconfigured).toBe(true);
  });

  it("parses full CORS config with methods, headers, and max-age", async () => {
    const result = await check.run(
      makeEndpoint({
        "access-control-allow-origin": "https://api.example.com",
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers":
          "Content-Type, Authorization, X-Custom-Header",
        "access-control-expose-headers": "X-Total-Count",
        "access-control-max-age": "86400",
      }),
      "example.com",
    );
    expect(result.data.enabled).toBe(true);
    expect(result.data.allowOrigin).toBe("https://api.example.com");
    expect(result.data.allowCredentials).toBe(true);
    expect(result.data.allowMethods).toEqual(["GET", "POST", "OPTIONS"]);
    expect(result.data.allowHeaders).toEqual([
      "Content-Type",
      "Authorization",
      "X-Custom-Header",
    ]);
    expect(result.data.exposeHeaders).toEqual(["X-Total-Count"]);
    expect(result.data.maxAge).toBe(86400);
    expect(result.data.misconfigured).toBe(false);
  });
});
