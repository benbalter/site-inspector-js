export function defaultChecks(
  requested: string[] | undefined,
  isPublic: boolean,
  fastChecks: string[],
): string[] | undefined {
  return requested ?? (isPublic ? fastChecks : undefined);
}

export function publicOrigin(request: Request): string {
  const fallback = new URL(request.url).origin;
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host");
  if (!host) return fallback;

  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol || new URL(request.url).protocol.slice(0, -1);
  if (protocol !== "http" && protocol !== "https") return fallback;

  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return fallback;
  }
}

export function createOpenApiSpec(origin: string, checks: string[]): Record<string, unknown> {
  const errorResponse = {
    description: "The request could not be processed.",
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/Error" },
      },
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "Site Inspector API",
      version: "1.0.0",
      description:
        "Inspect a public domain and return structured technology, security, and capability facts. " +
        "No authentication is required. Public deployments run only fast checks by default; " +
        "heavy browser checks are unavailable. Public requests are limited to 30 per minute and " +
        "three concurrent inspections per process.",
    },
    servers: [{ url: origin }],
    paths: {
      "/api/inspect": {
        post: {
          operationId: "inspectDomain",
          summary: "Inspect a public domain",
          description:
            "Use this operation to retrieve a machine-readable site inspection. " +
            "Omit checks to run all available fast checks, or pass a smaller list to reduce " +
            "work and response size. Check-level errors appear in each check's data.error; " +
            "request-level errors use the Error response schema.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/InspectRequest" },
                example: { domain: "example.com", checks: ["headers", "https", "csp"] },
              },
            },
          },
          responses: {
            "200": {
              description: "Inspection completed.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/InspectionResult" },
                },
              },
            },
            "400": errorResponse,
            "429": {
              ...errorResponse,
              description:
                "Rate limit or concurrent inspection limit exceeded. A Retry-After header is " +
                "included when the request-rate limit is exceeded.",
              headers: {
                "Retry-After": {
                  schema: { type: "integer" },
                  description: "Seconds to wait before retrying when request rate is exceeded.",
                },
              },
            },
            "500": errorResponse,
          },
        },
      },
    },
    components: {
      schemas: {
        InspectRequest: {
          type: "object",
          additionalProperties: false,
          required: ["domain"],
          properties: {
            domain: {
              type: "string",
              description: "A public DNS hostname; schemes and paths are not needed.",
              example: "example.com",
            },
            checks: {
              type: "array",
              description:
                "Optional subset of checks. If omitted, public deployments run every fast check.",
              minItems: 1,
              items: { type: "string", enum: checks },
            },
            timeout: {
              type: "integer",
              description: "Network timeout in milliseconds; values are clamped to 1,000–30,000.",
              default: 15_000,
            },
          },
        },
        InspectionResult: {
          type: "object",
          required: ["domain", "canonicalUrl", "properties", "checks", "inspectedAt"],
          properties: {
            domain: { type: "string" },
            canonicalUrl: { type: "string", format: "uri" },
            properties: { $ref: "#/components/schemas/DomainProperties" },
            checks: {
              type: "object",
              description:
                "Check results keyed by check name. A check may contain an error in its data.",
              additionalProperties: { $ref: "#/components/schemas/CheckResult" },
            },
            endpoints: {
              type: "array",
              items: { $ref: "#/components/schemas/EndpointInfo" },
            },
            inspectedAt: { type: "string", format: "date-time" },
          },
        },
        DomainProperties: {
          type: "object",
          required: [
            "up",
            "www",
            "root",
            "https",
            "enforcesHttps",
            "downgradesHttps",
            "canonicallyWww",
            "canonicallyHttps",
            "serverError",
            "redirect",
          ],
          properties: {
            up: { type: "boolean" },
            www: { type: "boolean" },
            root: { type: "boolean" },
            https: { type: "boolean" },
            enforcesHttps: { type: "boolean" },
            downgradesHttps: { type: "boolean" },
            canonicallyWww: { type: "boolean" },
            canonicallyHttps: { type: "boolean" },
            serverError: { type: "boolean" },
            redirect: { type: "boolean" },
            redirectTarget: { type: "string", format: "uri" },
          },
        },
        CheckResult: {
          type: "object",
          required: ["name", "data"],
          properties: {
            name: { type: "string" },
            data: { type: "object", additionalProperties: true },
          },
        },
        EndpointInfo: {
          type: "object",
          required: ["url", "up", "redirect"],
          properties: {
            url: { type: "string", format: "uri" },
            up: { type: "boolean" },
            statusCode: { type: "integer" },
            redirect: { type: "boolean" },
            redirectTarget: { type: "string", format: "uri" },
            error: { type: "string" },
          },
        },
        Error: {
          type: "object",
          required: ["error"],
          properties: { error: { type: "string" } },
        },
      },
    },
  };
}
