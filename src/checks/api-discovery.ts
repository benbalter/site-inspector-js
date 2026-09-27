import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { isCatchAll, probeUrl } from "../utils.js";

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

export class ApiDiscoveryCheck implements Check {
  name = "api-discovery";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const origin = new URL(endpoint.url).origin;

    const [catchAll, results] = await Promise.all([
      isCatchAll(origin),
      Promise.all(
        API_ENDPOINTS.map(async (ep) => ({
          name: ep.name,
          path: ep.path,
          found: await probeUrl(`${origin}${ep.path}`),
        })),
      ),
    ]);

    // If every path returns 200, the probes can't tell us anything.
    const found = catchAll ? [] : results.filter((r) => r.found);
    const hasGraphQL = found.some((r) => r.name === "graphql" || r.name === "graphiql");
    const hasOpenAPI = found.some(
      (r) => r.name.startsWith("openapi") || r.name.startsWith("swagger"),
    );
    const hasApi = found.length > 0;

    return {
      name: this.name,
      data: {
        hasApi,
        catchAll,
        hasGraphQL,
        hasOpenAPI,
        endpoints: found.map((r) => r.path),
        probed: API_ENDPOINTS.length,
      },
    };
  }
}
