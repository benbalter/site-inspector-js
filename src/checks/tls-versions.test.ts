import { describe, it, expect, vi, beforeEach } from "vitest";
import tls from "node:tls";
import { TlsVersionsCheck } from "./tls-versions.js";
import type { EndpointData } from "../types.js";

vi.mock("node:tls");
const realTls = await vi.importActual<typeof tls>("node:tls");

describe("TlsVersionsCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Which ciphers this OpenSSL build can offer is a fact about the machine,
    // not something to mock.
    vi.mocked(tls.getCiphers).mockImplementation(realTls.getCiphers);
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

    // Version probes only: the cipher probes pin TLS 1.2 with their own lists.
    const byVersion = Object.fromEntries(
      (vi.mocked(tls.connect).mock.calls as unknown as [tls.ConnectionOptions][])
        .filter(([opts]) => opts.ciphers === undefined || opts.ciphers.includes("SECLEVEL"))
        .map(([opts]) => [opts.maxVersion, opts.ciphers]),
    );
    // OpenSSL 3 refuses legacy handshakes at the default level, which made
    // TLS 1.0/1.1 always look unsupported.
    expect(byVersion["TLSv1"]).toBe("DEFAULT@SECLEVEL=0");
    expect(byVersion["TLSv1.1"]).toBe("DEFAULT@SECLEVEL=0");
    expect(byVersion["TLSv1.2"]).toBeUndefined();
    expect(byVersion["TLSv1.3"]).toBeUndefined();
  });

  it("sends SNI, which CDNs like Cloudflare require to complete a handshake", async () => {
    mockTlsConnect(["TLSv1.3"]);
    await new TlsVersionsCheck().run(
      {
        url: "https://example.com",
        statusCode: 200,
        headers: {},
        body: "",
        finalUrl: "https://example.com",
        setCookies: [],
        redirectChain: [],
      },
      "example.com",
    );

    for (const [opts] of vi.mocked(tls.connect).mock.calls as unknown as [
      tls.ConnectionOptions,
    ][]) {
      expect(opts.servername).toBe("example.com");
    }
  });

  it("omits SNI for IP addresses, which RFC 6066 forbids as server names", async () => {
    mockTlsConnect(["TLSv1.3"]);
    await new TlsVersionsCheck().run(
      {
        url: "https://192.0.2.1",
        statusCode: 200,
        headers: {},
        body: "",
        finalUrl: "https://192.0.2.1",
        setCookies: [],
        redirectChain: [],
      },
      "192.0.2.1",
    );

    for (const [opts] of vi.mocked(tls.connect).mock.calls as unknown as [
      tls.ConnectionOptions,
    ][]) {
      expect(opts.servername).toBeUndefined();
    }
  });

  describe("negotiated extensions", () => {
    const endpoint = (headers: Record<string, string> = {}): EndpointData => ({
      url: "https://example.com",
      statusCode: 200,
      headers,
      body: "",
      finalUrl: "https://example.com",
      setCookies: [],
      redirectChain: [],
    });

    /**
     * Version probes succeed for TLS 1.3 only; the extension probe (no
     * version pinned) negotiates `alpn` and staples `ocsp` if given.
     */
    function mockExtensions(alpn: string | false | null, ocsp?: Buffer) {
      const connectMock = vi.fn((opts: Record<string, unknown>, cb?: () => void) => {
        const handlers: Record<string, Array<(arg?: unknown) => void>> = {};
        const socket = {
          alpnProtocol: undefined as string | false | undefined,
          on: vi.fn((event: string, handler: (arg?: unknown) => void) => {
            (handlers[event] ??= []).push(handler);
            return socket;
          }),
          destroy: vi.fn(),
        };
        const probe = opts.ALPNProtocols !== undefined;
        setImmediate(() => {
          if (probe && alpn === null) {
            handlers.error?.forEach((h) => h(new Error("ECONNRESET")));
          } else if (probe) {
            // Like Node, emit OCSPResponse either way: null when nothing was stapled.
            if (opts.requestOCSP) handlers.OCSPResponse?.forEach((h) => h(ocsp ?? null));
            socket.alpnProtocol = alpn ?? undefined;
            cb?.();
          } else if (opts.maxVersion === "TLSv1.3") {
            cb?.();
          } else {
            handlers.error?.forEach((h) => h());
          }
        });
        return socket;
      });
      vi.mocked(tls.connect).mockImplementation(connectMock as unknown as typeof tls.connect);
    }

    it("reports HTTP/2 when the server picks h2 over ALPN", async () => {
      mockExtensions("h2");
      const result = await new TlsVersionsCheck().run(endpoint(), "example.com");
      expect(result.data.http2).toBe(true);
      expect(result.data.alpnProtocol).toBe("h2");
    });

    it("reports no HTTP/2 when the server picks http/1.1 or skips ALPN", async () => {
      mockExtensions("http/1.1");
      expect((await new TlsVersionsCheck().run(endpoint(), "example.com")).data.http2).toBe(false);
      mockExtensions(false);
      const result = await new TlsVersionsCheck().run(endpoint(), "example.com");
      expect(result.data.http2).toBe(false);
      expect(result.data.alpnProtocol).toBeNull();
    });

    it("reports a stapled OCSP response", async () => {
      mockExtensions("h2", Buffer.from([0x30, 0x82]));
      const result = await new TlsVersionsCheck().run(endpoint(), "example.com");
      expect(result.data.ocspStapling).toBe(true);
    });

    it("reports no stapling when the server sends no OCSP response", async () => {
      mockExtensions("h2");
      const result = await new TlsVersionsCheck().run(endpoint(), "example.com");
      expect(result.data.ocspStapling).toBe(false);
    });

    it("reports unknowns when the extension probe fails", async () => {
      mockExtensions(null);
      const result = await new TlsVersionsCheck().run(endpoint(), "example.com");
      expect(result.data.http2).toBeNull();
      expect(result.data.ocspStapling).toBeNull();
      expect(result.data.tls13).toBe(true);
    });

    it("reads HTTP/3 support from the Alt-Svc header", async () => {
      mockExtensions("h2");
      const check = new TlsVersionsCheck();
      const h3 = await check.run(
        endpoint({ "alt-svc": 'h3=":443"; ma=86400, h3-29=":443"; ma=86400' }),
        "example.com",
      );
      expect(h3.data.http3).toBe(true);
      const none = await check.run(endpoint({ "alt-svc": 'h2=":443"' }), "example.com");
      expect(none.data.http3).toBe(false);
      const missing = await check.run(endpoint(), "example.com");
      expect(missing.data.http3).toBe(false);
    });
  });

  describe("cipher suites", () => {
    const endpoint: EndpointData = {
      url: "https://example.com",
      statusCode: 200,
      headers: {},
      body: "",
      finalUrl: "https://example.com",
      setCookies: [],
      redirectChain: [],
    };

    /**
     * Versions in `versions` handshake. A TLS 1.2 cipher probe succeeds when
     * its list includes any cipher in `accepted`.
     */
    function mockServer(versions: string[], accepted: string[]) {
      const connectMock = vi.fn((opts: tls.ConnectionOptions, cb?: () => void) => {
        const handlers: Record<string, Array<() => void>> = {};
        const socket = {
          on: vi.fn((event: string, handler: () => void) => {
            (handlers[event] ??= []).push(handler);
            return socket;
          }),
          destroy: vi.fn(),
          alpnProtocol: false,
        };
        const cipherProbe = opts.ciphers !== undefined && !opts.ciphers.includes("SECLEVEL");
        const ok = cipherProbe
          ? versions.includes("TLSv1.2") &&
            (opts.ciphers ?? "").split(":").some((c) => accepted.includes(c))
          : opts.maxVersion === undefined || versions.includes(opts.maxVersion);
        setImmediate(() => (ok ? cb?.() : handlers.error?.forEach((h) => h())));
        return socket;
      });
      vi.mocked(tls.connect).mockImplementation(connectMock as unknown as typeof tls.connect);
    }

    it("reports forward secrecy and AEAD, and a server still accepting RSA key exchange", async () => {
      mockServer(["TLSv1.2"], ["ECDHE-RSA-AES128-GCM-SHA256", "AES128-SHA"]);
      const result = await new TlsVersionsCheck().run(endpoint, "example.com");
      expect(result.data.forwardSecrecy).toBe(true);
      expect(result.data.aead).toBe(true);
      expect(result.data.staticRsaKeyExchange).toBe(true);
    });

    it("reports a server without forward secrecy or AEAD", async () => {
      mockServer(["TLSv1.2"], ["AES128-SHA"]);
      const result = await new TlsVersionsCheck().run(endpoint, "example.com");
      expect(result.data.forwardSecrecy).toBe(false);
      expect(result.data.aead).toBe(false);
      expect(result.data.staticRsaKeyExchange).toBe(true);
    });

    it("counts forward-secret CBC suites as forward secrecy without AEAD", async () => {
      mockServer(["TLSv1.2"], ["ECDHE-RSA-AES128-SHA"]);
      const result = await new TlsVersionsCheck().run(endpoint, "example.com");
      expect(result.data.forwardSecrecy).toBe(true);
      expect(result.data.aead).toBe(false);
      expect(result.data.staticRsaKeyExchange).toBe(false);
    });

    it("credits TLS 1.3, whose suites are all forward secret and AEAD", async () => {
      mockServer(["TLSv1.3"], []);
      const result = await new TlsVersionsCheck().run(endpoint, "example.com");
      expect(result.data.forwardSecrecy).toBe(true);
      expect(result.data.aead).toBe(true);
      expect(result.data.staticRsaKeyExchange).toBe(false);
    });

    it("only offers ciphers this OpenSSL build can negotiate", async () => {
      mockServer(["TLSv1.2"], []);
      await new TlsVersionsCheck().run(endpoint, "example.com");
      const available = new Set(tls.getCiphers().map((c) => c.toUpperCase()));
      for (const [opts] of vi.mocked(tls.connect).mock.calls as unknown as [
        tls.ConnectionOptions,
      ][]) {
        if (opts.ciphers === undefined || opts.ciphers.includes("SECLEVEL")) continue;
        expect(opts.maxVersion).toBe("TLSv1.2");
        for (const cipher of opts.ciphers.split(":")) expect(available).toContain(cipher);
      }
    });
  });
});
