import { describe, it, expect } from "vitest";
import { A11yAxeCheck } from "./a11y-axe.js";
import type { EndpointData } from "../types.js";

function makeEndpoint(body: string): EndpointData {
  return { url: "https://example.com", statusCode: 200, headers: {}, body, redirectChain: [] };
}

describe("A11yAxeCheck", () => {
  const check = new A11yAxeCheck();

  it("has correct name", () => {
    expect(check.name).toBe("a11y-axe");
  });

  it("detects accessibility violations in bad HTML", async () => {
    const body = `<!DOCTYPE html><html><head><title>Test</title></head><body>
      <img src="test.jpg">
      <button></button>
    </body></html>`;
    const result = await check.run(makeEndpoint(body), "example.com");
    expect(result.data.violations).toBeGreaterThan(0);
  }, 15000);

  it("reports passes for good HTML", async () => {
    const body = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body>
      <main><h1>Hello</h1><p>World</p></main>
    </body></html>`;
    const result = await check.run(makeEndpoint(body), "example.com");
    expect(result.data.passes).toBeGreaterThan(0);
  }, 15000);

  it("handles empty body", async () => {
    const result = await check.run(makeEndpoint(""), "example.com");
    expect(result.data.violations).toBe(0);
  });
});
