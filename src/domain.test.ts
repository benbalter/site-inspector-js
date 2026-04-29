import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EndpointData } from "./types.js";

/** Store for mock endpoint instances created during each test. */
let mockInstances: ReturnType<typeof makeMockEndpoint>[] = [];
let mockConfigs: Parameters<typeof makeMockEndpoint>[0][] = [];
let callIndex = 0;

// Mock the endpoint module before importing Domain
vi.mock("./endpoint.js", () => {
  class MockEndpointClass {
    url: string;
    private _mock: ReturnType<typeof makeMockEndpoint>;

    constructor(url: string, _timeoutMs?: number) {
      this.url = url;
      const config = mockConfigs[callIndex] ?? { url, up: false };
      callIndex++;
      this._mock = makeMockEndpoint(config);
      mockInstances.push(this._mock);
      // Copy properties from mock to this instance
      Object.defineProperties(this, {
        isUp: { get: () => this._mock.isUp },
        isRedirect: { get: () => this._mock.isRedirect },
        redirectTarget: { get: () => this._mock.redirectTarget },
        isExternalRedirect: { get: () => this._mock.isExternalRedirect },
        info: { get: () => this._mock.info },
      });
      this.fetch = this._mock.fetch;
    }

    fetch: () => Promise<EndpointData>;
  }

  return { Endpoint: MockEndpointClass };
});

import { Domain } from "./domain.js";

/** Helper to create a mock Endpoint instance with the given behavior. */
function makeMockEndpoint(opts: {
  url: string;
  up: boolean;
  redirect?: boolean;
  redirectTarget?: string;
  externalRedirect?: boolean;
}) {
  const data: EndpointData = {
    url: opts.url,
    statusCode: opts.up ? 200 : 0,
    headers: {},
    body: "",
    redirectChain: opts.redirectTarget ? [opts.redirectTarget] : [],
    error: opts.up ? undefined : "Connection refused",
  };

  return {
    url: opts.url,
    fetch: vi.fn().mockResolvedValue(data),
    get info() {
      return {
        url: opts.url,
        up: opts.up,
        statusCode: opts.up ? 200 : undefined,
        redirect: opts.redirect ?? false,
        redirectTarget: opts.redirectTarget,
        error: opts.up ? undefined : "Connection refused",
      };
    },
    get isUp() { return opts.up; },
    get isRedirect() { return opts.redirect ?? false; },
    get redirectTarget() { return opts.redirectTarget; },
    get isExternalRedirect() { return opts.externalRedirect ?? false; },
  };
}

/**
 * Set up mock configs for the 4 endpoints.
 * Order: httpsRoot, httpsWww, httpRoot, httpWww
 */
function setupEndpoints(configs: Parameters<typeof makeMockEndpoint>[0][]) {
  mockConfigs = configs;
  callIndex = 0;
  mockInstances = [];
}

describe("Domain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("normalizes the domain input", () => {
      setupEndpoints([
        { url: "https://example.com", up: false },
        { url: "https://www.example.com", up: false },
        { url: "http://example.com", up: false },
        { url: "http://www.example.com", up: false },
      ]);

      const domain = new Domain("HTTPS://Example.Com/path");
      expect(domain.domain).toBe("example.com");
    });

    it("creates 4 endpoints with correct URLs", () => {
      setupEndpoints([
        { url: "https://example.com", up: false },
        { url: "https://www.example.com", up: false },
        { url: "http://example.com", up: false },
        { url: "http://www.example.com", up: false },
      ]);

      const domain = new Domain("example.com");
      const urls = domain.endpoints.map((e) => e.url);

      expect(urls).toContain("https://example.com");
      expect(urls).toContain("https://www.example.com");
      expect(urls).toContain("http://example.com");
      expect(urls).toContain("http://www.example.com");
    });
  });

  describe("all endpoints up", () => {
    it("reports domain as fully up with HTTPS", async () => {
      setupEndpoints([
        { url: "https://example.com", up: true },
        { url: "https://www.example.com", up: true },
        { url: "http://example.com", up: true },
        { url: "http://www.example.com", up: true },
      ]);

      const domain = new Domain("example.com");
      await domain.resolve();

      const props = domain.properties;
      expect(props.up).toBe(true);
      expect(props.www).toBe(true);
      expect(props.root).toBe(true);
      expect(props.https).toBe(true);
      expect(props.enforcesHttps).toBe(false);
      expect(props.downgradesHttps).toBe(false);
      expect(props.redirect).toBe(false);
    });

    it("returns info for all 4 endpoints", async () => {
      setupEndpoints([
        { url: "https://example.com", up: true },
        { url: "https://www.example.com", up: true },
        { url: "http://example.com", up: true },
        { url: "http://www.example.com", up: true },
      ]);

      const domain = new Domain("example.com");
      await domain.resolve();

      expect(domain.endpoints).toHaveLength(4);
      expect(domain.endpoints.every((e) => e.up)).toBe(true);
    });
  });

  describe("enforces HTTPS", () => {
    it("detects when HTTP redirects to HTTPS", async () => {
      setupEndpoints([
        { url: "https://example.com", up: true },
        { url: "https://www.example.com", up: true },
        { url: "http://example.com", up: true, redirect: true, redirectTarget: "https://example.com" },
        { url: "http://www.example.com", up: true, redirect: true, redirectTarget: "https://www.example.com" },
      ]);

      const domain = new Domain("example.com");
      await domain.resolve();

      const props = domain.properties;
      expect(props.enforcesHttps).toBe(true);
      expect(props.canonicallyHttps).toBe(true);
      expect(props.https).toBe(true);
    });
  });

  describe("www only", () => {
    it("detects when only www endpoints respond", async () => {
      setupEndpoints([
        { url: "https://example.com", up: false },
        { url: "https://www.example.com", up: true },
        { url: "http://example.com", up: false },
        { url: "http://www.example.com", up: true },
      ]);

      const domain = new Domain("example.com");
      await domain.resolve();

      const props = domain.properties;
      expect(props.up).toBe(true);
      expect(props.www).toBe(true);
      expect(props.root).toBe(false);
      expect(props.canonicallyWww).toBe(true);
    });

    it("selects www endpoint as canonical", async () => {
      setupEndpoints([
        { url: "https://example.com", up: false },
        { url: "https://www.example.com", up: true },
        { url: "http://example.com", up: false },
        { url: "http://www.example.com", up: true },
      ]);

      const domain = new Domain("example.com");
      await domain.resolve();

      expect(domain.canonicalEndpoint.url).toBe("https://www.example.com");
    });
  });

  describe("completely down", () => {
    it("reports domain as down", async () => {
      setupEndpoints([
        { url: "https://example.com", up: false },
        { url: "https://www.example.com", up: false },
        { url: "http://example.com", up: false },
        { url: "http://www.example.com", up: false },
      ]);

      const domain = new Domain("example.com");
      await domain.resolve();

      const props = domain.properties;
      expect(props.up).toBe(false);
      expect(props.www).toBe(false);
      expect(props.root).toBe(false);
      expect(props.https).toBe(false);
      expect(props.enforcesHttps).toBe(false);
      expect(props.redirect).toBe(false);
    });

    it("returns all endpoints as down in endpoints array", async () => {
      setupEndpoints([
        { url: "https://example.com", up: false },
        { url: "https://www.example.com", up: false },
        { url: "http://example.com", up: false },
        { url: "http://www.example.com", up: false },
      ]);

      const domain = new Domain("example.com");
      await domain.resolve();

      expect(domain.endpoints.every((e) => !e.up)).toBe(true);
    });
  });
});
