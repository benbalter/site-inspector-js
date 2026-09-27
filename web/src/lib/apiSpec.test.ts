import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createOpenApiSpec, defaultChecks, publicOrigin } from "./apiSpec.ts";

describe("defaultChecks", () => {
  it("uses only fast checks for public requests without a selected subset", () => {
    assert.deepEqual(defaultChecks(undefined, true, ["headers", "https"]), ["headers", "https"]);
  });

  it("preserves an explicitly selected subset", () => {
    assert.deepEqual(defaultChecks(["headers"], true, ["headers", "https"]), ["headers"]);
  });

  it("preserves the local full-check default", () => {
    assert.equal(defaultChecks(undefined, false, ["headers", "https"]), undefined);
  });
});

describe("createOpenApiSpec", () => {
  it("publishes the runtime check list and machine-readable response schemas", () => {
    const spec = createOpenApiSpec("https://site-inspector.example", ["headers", "https"]);
    const request = (
      spec.components as {
        schemas: {
          InspectRequest: {
            properties: { checks: { items: { enum: string[] } } };
          };
        };
      }
    ).schemas.InspectRequest;
    const operation = (spec.paths as Record<string, { post: { responses: object } }>)[
      "/api/inspect"
    ].post;

    assert.deepEqual(request.properties.checks.items.enum, ["headers", "https"]);
    assert.ok("200" in operation.responses);
    assert.ok("429" in operation.responses);
  });
});

describe("publicOrigin", () => {
  it("uses forwarded host and protocol from a reverse proxy", () => {
    const request = new Request("http://localhost:10000/api/openapi.json", {
      headers: {
        host: "localhost:10000",
        "x-forwarded-host": "site-inspector.balter.dev",
        "x-forwarded-proto": "https",
      },
    });
    assert.equal(publicOrigin(request), "https://site-inspector.balter.dev");
  });

  it("falls back to the request origin for invalid forwarded protocols", () => {
    const request = new Request("http://localhost:10000/api/openapi.json", {
      headers: { host: "localhost:10000", "x-forwarded-proto": "javascript" },
    });
    assert.equal(publicOrigin(request), "http://localhost:10000");
  });
});
