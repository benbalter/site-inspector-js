import { describe, it, expect, vi, beforeEach } from "vitest";
import tls from "node:tls";
import { TlsVersionsCheck } from "./tls-versions.js";
import type { EndpointData } from "../types.js";

vi.mock("node:tls");

describe("TlsVersionsCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockTlsConnect(supportedVersions: string[] = []) {
    const connectMock = vi.fn((opts: Record<string, unknown>, cb?: () => void) => {
      const handlers: Record<string, Array<() => void>> = {};
      const socket = {
        on: vi.fn((event: string, handler: () => void) => {
          if (!handlers[event]) {
            handlers[event] = [];
          }
          handlers[event].push(handler);
          return socket;
        }),
        destroy: vi.fn(),
      };

      const version = (opts.minVersion as string) || (opts.maxVersion as string) || "";
      const isSupported = supportedVersions.includes(version);

      // Simulate async behavior
      setImmediate(() => {
        if (isSupported) {
          if (cb) cb();
        } else {
          if (handlers["error"]) {
            handlers["error"].forEach((h) => h());
          }
        }
      });

      return socket;
    });

    vi.mocked(tls.connect).mockImplementation(connectMock as unknown as typeof tls.connect);
  }

  it("should have the correct name", async () => {
    mockTlsConnect(["TLSv1.2", "TLSv1.3"]);
    const check = new TlsVersionsCheck();
    expect(check.name).toBe("tls-versions");
  });

  it("should detect all supported TLS versions", async () => {
    mockTlsConnect(["TLSv1", "TLSv1.1", "TLSv1.2", "TLSv1.3"]);
    const check = new TlsVersionsCheck();

    const endpoint: EndpointData = {
      url: "https://example.com",
      statusCode: 200,
      headers: {},
      body: "",
      finalUrl: "https://example.com",
      setCookies: [],
      redirectChain: [],
    };

    const result = await check.run(endpoint, "example.com");

    expect(result.name).toBe("tls-versions");
    expect((result.data.supported as Record<string, boolean>)["TLSv1"]).toBe(true);
    expect((result.data.supported as Record<string, boolean>)["TLSv1.1"]).toBe(true);
    expect((result.data.supported as Record<string, boolean>)["TLSv1.2"]).toBe(true);
    expect((result.data.supported as Record<string, boolean>)["TLSv1.3"]).toBe(true);
    expect(result.data.hasDeprecated).toBe(true);
    expect(result.data.deprecated).toContain("TLSv1");
    expect(result.data.deprecated).toContain("TLSv1.1");
    expect(result.data.tls13).toBe(true);
    expect(result.data.minimumVersion).toBe("TLSv1");
  });

  it("should detect only modern TLS versions (1.2+1.3)", async () => {
    mockTlsConnect(["TLSv1.2", "TLSv1.3"]);
    const check = new TlsVersionsCheck();

    const endpoint: EndpointData = {
      url: "https://example.com",
      statusCode: 200,
      headers: {},
      body: "",
      finalUrl: "https://example.com",
      setCookies: [],
      redirectChain: [],
    };

    const result = await check.run(endpoint, "example.com");

    expect((result.data.supported as Record<string, boolean>)["TLSv1"]).toBe(false);
    expect((result.data.supported as Record<string, boolean>)["TLSv1.1"]).toBe(false);
    expect((result.data.supported as Record<string, boolean>)["TLSv1.2"]).toBe(true);
    expect((result.data.supported as Record<string, boolean>)["TLSv1.3"]).toBe(true);
    expect(result.data.hasDeprecated).toBe(false);
    expect((result.data.deprecated as string[]).length).toBe(0);
    expect(result.data.tls13).toBe(true);
    expect(result.data.minimumVersion).toBe("TLSv1.2");
  });

  it("should identify when deprecated versions are supported", async () => {
    mockTlsConnect(["TLSv1.1", "TLSv1.2", "TLSv1.3"]);
    const check = new TlsVersionsCheck();

    const endpoint: EndpointData = {
      url: "https://example.com",
      statusCode: 200,
      headers: {},
      body: "",
      finalUrl: "https://example.com",
      setCookies: [],
      redirectChain: [],
    };

    const result = await check.run(endpoint, "example.com");

    expect((result.data.supported as Record<string, boolean>)["TLSv1"]).toBe(false);
    expect((result.data.supported as Record<string, boolean>)["TLSv1.1"]).toBe(true);
    expect(result.data.hasDeprecated).toBe(true);
    expect(result.data.deprecated).toContain("TLSv1.1");
    expect(result.data.deprecated).not.toContain("TLSv1.2");
  });

  it("should handle no TLS support at all", async () => {
    mockTlsConnect([]);
    const check = new TlsVersionsCheck();

    const endpoint: EndpointData = {
      url: "https://example.com",
      statusCode: 200,
      headers: {},
      body: "",
      finalUrl: "https://example.com",
      setCookies: [],
      redirectChain: [],
    };

    const result = await check.run(endpoint, "example.com");

    expect((result.data.supported as Record<string, boolean>)["TLSv1"]).toBe(false);
    expect((result.data.supported as Record<string, boolean>)["TLSv1.1"]).toBe(false);
    expect((result.data.supported as Record<string, boolean>)["TLSv1.2"]).toBe(false);
    expect((result.data.supported as Record<string, boolean>)["TLSv1.3"]).toBe(false);
    expect(result.data.hasDeprecated).toBe(false);
    expect(result.data.tls13).toBe(false);
    expect(result.data.minimumVersion).toBeNull();
  });

  it("should parse hostname and port correctly", async () => {
    mockTlsConnect(["TLSv1.2", "TLSv1.3"]);
    const check = new TlsVersionsCheck();

    const endpoint: EndpointData = {
      url: "https://example.com",
      statusCode: 200,
      headers: {},
      body: "",
      finalUrl: "https://example.com",
      setCookies: [],
      redirectChain: [],
    };

    await check.run(endpoint, "example.com");

    const calls = vi.mocked(tls.connect).mock.calls;
    const call = calls[0] as unknown as [tls.ConnectionOptions]; // First call for TLSv1
    expect(call[0].host).toBe("example.com");
    expect(call[0].port).toBe(443);
  });

  it("should use custom port if provided", async () => {
    mockTlsConnect(["TLSv1.2", "TLSv1.3"]);
    const check = new TlsVersionsCheck();

    const endpoint: EndpointData = {
      url: "https://example.com:8443",
      statusCode: 200,
      headers: {},
      body: "",
      finalUrl: "https://example.com:8443",
      setCookies: [],
      redirectChain: [],
    };

    await check.run(endpoint, "example.com");

    const calls = vi.mocked(tls.connect).mock.calls;
    const call = calls[0] as unknown as [tls.ConnectionOptions]; // First call for TLSv1
    expect(call[0].host).toBe("example.com");
    expect(call[0].port).toBe(8443);
  });

  it("lowers OpenSSL's security level for TLS 1.0/1.1 probes only", async () => {
    mockTlsConnect(["TLSv1.2", "TLSv1.3"]);
    const check = new TlsVersionsCheck();

    await check.run(
      {
        url: "https://example.com",
        finalUrl: "https://example.com",
        statusCode: 200,
        headers: {},
        setCookies: [],
        body: "",
        redirectChain: [],
      },
      "example.com",
    );

    const byVersion = Object.fromEntries(
      (vi.mocked(tls.connect).mock.calls as unknown as [tls.ConnectionOptions][]).map(([opts]) => [
        opts.maxVersion,
        opts.ciphers,
      ]),
    );
    // OpenSSL 3 refuses legacy handshakes at the default level, which made
    // TLS 1.0/1.1 always look unsupported.
    expect(byVersion["TLSv1"]).toBe("DEFAULT@SECLEVEL=0");
    expect(byVersion["TLSv1.1"]).toBe("DEFAULT@SECLEVEL=0");
    expect(byVersion["TLSv1.2"]).toBeUndefined();
    expect(byVersion["TLSv1.3"]).toBeUndefined();
  });
});
