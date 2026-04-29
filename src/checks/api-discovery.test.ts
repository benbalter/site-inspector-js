import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiDiscoveryCheck } from "./api-discovery.js";
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
  handler: (url: string) => boolean,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      const found = handler(url);
      return {
        status: found ? 200 : 404,
        ok: found,
      } as Response;
    }),
  );
}

describe("ApiDiscoveryCheck", () => {
  const check = new ApiDiscoveryCheck();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has the correct name", () => {
    expect(check.name).toBe("api-discovery");
  });

  it("finds no API endpoints when all probes fail", async () => {
    mockFetch(() => false);

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.name).toBe("api-discovery");
    expect(result.data.hasApi).toBe(false);
    expect(result.data.hasGraphQL).toBe(false);
    expect(result.data.hasOpenAPI).toBe(false);
    expect(result.data.endpoints).toEqual([]);
    expect(result.data.probed).toBe(10);
  });

  it("detects GraphQL + Swagger endpoints", async () => {
    mockFetch((url) => {
      return url.includes("/graphql") || url.includes("/swagger.json");
    });

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.data.hasApi).toBe(true);
    expect(result.data.hasGraphQL).toBe(true);
    expect(result.data.hasOpenAPI).toBe(true);
    expect(result.data.endpoints).toContain("/graphql");
    expect(result.data.endpoints).toContain("/swagger.json");
    expect(result.data.endpoints.length).toBe(2);
    expect(result.data.probed).toBe(10);
  });

  it("detects only /api endpoint", async () => {
    mockFetch((url) => {
      return url.endsWith("/api");
    });

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.data.hasApi).toBe(true);
    expect(result.data.hasGraphQL).toBe(false);
    expect(result.data.hasOpenAPI).toBe(false);
    expect(result.data.endpoints).toContain("/api");
    expect(result.data.endpoints.length).toBe(1);
  });

  it("handles network errors gracefully", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Network error");
      }),
    );

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.data.hasApi).toBe(false);
    expect(result.data.hasGraphQL).toBe(false);
    expect(result.data.hasOpenAPI).toBe(false);
    expect(result.data.endpoints).toEqual([]);
  });

  it("detects GraphQL via /graphiql endpoint", async () => {
    mockFetch((url) => {
      return url.includes("/graphiql");
    });

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.data.hasGraphQL).toBe(true);
    expect(result.data.endpoints).toContain("/graphiql");
  });

  it("detects OpenAPI via /openapi.yaml endpoint", async () => {
    mockFetch((url) => {
      return url.includes("/openapi.yaml");
    });

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.data.hasOpenAPI).toBe(true);
    expect(result.data.endpoints).toContain("/openapi.yaml");
  });

  it("detects all endpoint types", async () => {
    mockFetch(() => true);

    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.data.hasApi).toBe(true);
    expect(result.data.hasGraphQL).toBe(true);
    expect(result.data.hasOpenAPI).toBe(true);
    expect(result.data.endpoints.length).toBe(10);
    expect(result.data.probed).toBe(10);
  });
});
