import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import tls from "node:tls";
import { HttpVersionsCheck, parseAltSvc } from "./http-versions.js";
import type { EndpointData } from "../types.js";

vi.mock("node:tls");

const { mockResolvePublic } = vi.hoisted(() => ({ mockResolvePublic: vi.fn() }));
vi.mock("../network.js", () => ({ resolvePublic: mockResolvePublic }));

type Outcome = { alpn: string | false } | { error: true } | { timeout: true } | { hang: true };

function mockTls(outcome: Outcome) {
  vi.mocked(tls.connect).mockImplementation(((_opts: unknown, cb?: () => void) => {
    const socket = Object.assign(new EventEmitter(), {
      alpnProtocol: false as string | false,
      destroy: vi.fn(),
    });
    setImmediate(() => {
      if ("alpn" in outcome) {
        socket.alpnProtocol = outcome.alpn;
        cb?.();
      } else if ("error" in outcome) {
        socket.emit("error", new Error("ECONNREFUSED"));
      } else if ("timeout" in outcome) {
        socket.emit("timeout");
      }
    });
    return socket;
  }) as unknown as typeof tls.connect);
}

function endpoint(overrides: Partial<EndpointData> = {}): EndpointData {
  return {
    url: "https://example.com",
    finalUrl: "https://example.com/",
    statusCode: 200,
    headers: {},
    setCookies: [],
    body: "",
    redirectChain: [],
    ...overrides,
  };
}

describe("parseAltSvc", () => {
  it("parses multiple entries with max-age", () => {
    expect(parseAltSvc('h3=":443"; ma=86400, h3-29=":443"; ma=3600, h2=":443"')).toEqual([
      { protocol: "h3", authority: ":443", maxAge: 86400 },
      { protocol: "h3-29", authority: ":443", maxAge: 3600 },
      { protocol: "h2", authority: ":443", maxAge: null },
    ]);
  });

  it("treats `clear` as no alternatives", () => {
    expect(parseAltSvc("clear")).toEqual([]);
  });
});

describe("HttpVersionsCheck", () => {
  const check = new HttpVersionsCheck();

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolvePublic.mockResolvedValue(["2606:4700::1", "93.184.216.34"]);
  });

  it("has the correct name and is light", () => {
    expect(check.name).toBe("http-versions");
    expect("heavy" in check).toBe(false);
  });

  it("detects HTTP/2 via ALPN and HTTP/3 via Alt-Svc", async () => {
    mockTls({ alpn: "h2" });
    const result = await check.run(
      endpoint({ headers: { "alt-svc": 'h3=":443"; ma=86400, h3-29=":443"; ma=86400' } }),
      "example.com",
    );
    expect(result).toEqual({
      name: "http-versions",
      data: {
        http2: true,
        alpnProtocol: "h2",
        http3Advertised: true,
        http3Protocols: ["h3", "h3-29"],
        http3MaxAge: 86400,
        altSvc: 'h3=":443"; ma=86400, h3-29=":443"; ma=86400',
        skipped: null,
      },
    });
    const [opts] = vi.mocked(tls.connect).mock.calls[0] as unknown as [tls.ConnectionOptions];
    expect(opts.ALPNProtocols).toEqual(["h2", "http/1.1"]);
    // Connects to the resolved public (IPv4-preferred) address, with SNI.
    expect(mockResolvePublic).toHaveBeenCalledWith("example.com");
    expect(opts.host).toBe("93.184.216.34");
    expect(opts.port).toBe(443);
    expect(opts.servername).toBe("example.com");
    expect(result.data.skipped).toBeNull();
  });

  it("skips the ALPN probe when the host isn't public", async () => {
    mockTls({ alpn: "h2" });
    mockResolvePublic.mockResolvedValue(null);
    const result = await check.run(
      endpoint({ headers: { "alt-svc": 'h3=":443"' } }),
      "example.com",
    );
    expect(tls.connect).not.toHaveBeenCalled();
    expect(result.data.http2).toBeNull();
    expect(result.data.alpnProtocol).toBeNull();
    expect(result.data.skipped).toBe("non-public address or unresolvable");
    expect(result.data.http3Advertised).toBe(true);
  });

  it("omits SNI for IP-literal endpoints", async () => {
    mockTls({ alpn: "h2" });
    mockResolvePublic.mockResolvedValue(["93.184.216.34"]);
    await check.run(endpoint({ url: "https://93.184.216.34" }), "93.184.216.34");
    const [opts] = vi.mocked(tls.connect).mock.calls[0] as unknown as [tls.ConnectionOptions];
    expect(opts.servername).toBeUndefined();
  });

  it("reports http2 false when the server picks http/1.1", async () => {
    mockTls({ alpn: "http/1.1" });
    const result = await check.run(endpoint(), "example.com");
    expect(result.data.http2).toBe(false);
    expect(result.data.alpnProtocol).toBe("http/1.1");
    expect(result.data.http3Advertised).toBe(false);
    expect(result.data.http3MaxAge).toBeNull();
    expect(result.data.altSvc).toBeNull();
  });

  it("reports http2 false when the server negotiates no ALPN protocol", async () => {
    mockTls({ alpn: false });
    const result = await check.run(endpoint(), "example.com");
    expect(result.data.http2).toBe(false);
    expect(result.data.alpnProtocol).toBeNull();
  });

  it("reports http2 null (unknown) when the handshake fails", async () => {
    mockTls({ error: true });
    const result = await check.run(endpoint(), "example.com");
    expect(result.data.http2).toBeNull();
    expect(result.data.alpnProtocol).toBeNull();
  });

  it("reports http2 null when the handshake times out", async () => {
    mockTls({ timeout: true });
    const result = await check.run(endpoint(), "example.com");
    expect(result.data.http2).toBeNull();
  });

  it("stops and reports null when the check is aborted", async () => {
    mockTls({ hang: true });
    const controller = new AbortController();
    const pending = check.run(endpoint(), "example.com", {
      timeoutMs: 5000,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(tls.connect).toHaveBeenCalled());
    controller.abort();
    const result = await pending;
    expect(result.data.http2).toBeNull();
    const socket = vi.mocked(tls.connect).mock.results[0].value as { destroy: () => void };
    expect(socket.destroy).toHaveBeenCalled();
  });

  it("skips ALPN for plain-http endpoints", async () => {
    mockTls({ alpn: "h2" });
    const result = await check.run(
      endpoint({ url: "http://example.com", finalUrl: "http://example.com/" }),
      "example.com",
    );
    expect(tls.connect).not.toHaveBeenCalled();
    expect(result.data.http2).toBeNull();
    expect(result.data.skipped).toBe("not https");
  });

  it("uses a custom port and caps the timeout", async () => {
    mockTls({ alpn: "h2" });
    await check.run(endpoint({ url: "https://example.com:8443" }), "example.com", {
      timeoutMs: 60_000,
      signal: new AbortController().signal,
    });
    const [opts] = vi.mocked(tls.connect).mock.calls[0] as unknown as [tls.ConnectionOptions];
    expect(opts.port).toBe(8443);
    expect(opts.timeout).toBe(10_000);
  });

  it("doesn't count non-h3 Alt-Svc entries as HTTP/3", async () => {
    mockTls({ alpn: "h2" });
    const result = await check.run(
      endpoint({ headers: { "alt-svc": 'h2="alt.example.com:443"' } }),
      "example.com",
    );
    expect(result.data.http3Advertised).toBe(false);
    expect(result.data.http3Protocols).toEqual([]);
  });

  it("defaults the HTTP/3 max-age to 24 hours when ma is omitted", async () => {
    mockTls({ alpn: "h2" });
    const result = await check.run(endpoint({ headers: { "alt-svc": 'h3=":443"' } }), "x");
    expect(result.data.http3MaxAge).toBe(86400);
  });
});
