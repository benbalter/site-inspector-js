import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

const API_ENDPOINTS = [
  { name: "graphql", path: "/graphql" },
  { name: "swagger-ui", path: "/swagger-ui" },
  { name: "swagger-json", path: "/swagger.json" },
  { name: "openapi-json", path: "/openapi.json" },
  { name: "openapi-yaml", path: "/openapi.yaml" },
  { name: "api-docs", path: "/api-docs" },
  { name: "api", path: "/api" },
  { name: "api-v1", path: "/api/v1" },
  { name: "graphiql", path: "/graphiql" },
  { name: "api-explorer", path: "/explorer" },
];

async function probeEndpoint(
  origin: string,
  path: string,
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${origin}${path}`, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

export class ApiDiscoveryCheck implements Check {
  name = "api-discovery";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const origin = new URL(endpoint.url).origin;

    const results = await Promise.all(
      API_ENDPOINTS.map(async (ep) => ({
        name: ep.name,
        path: ep.path,
        found: await probeEndpoint(origin, ep.path),
      })),
    );

    const found = results.filter((r) => r.found);
    const hasGraphQL = found.some(
      (r) => r.name === "graphql" || r.name === "graphiql",
    );
    const hasOpenAPI = found.some(
      (r) => r.name.startsWith("openapi") || r.name.startsWith("swagger"),
    );
    const hasApi = found.length > 0;

    return {
      name: this.name,
      data: {
        hasApi,
        hasGraphQL,
        hasOpenAPI,
        endpoints: found.map((r) => r.path),
        probed: API_ENDPOINTS.length,
      },
    };
  }
}
