import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { EndpointData } from "../types.js";

const { mockResolveMx, mockResolvePublic, mockNetConnect, mockTlsConnect } = vi.hoisted(() => ({
  mockResolveMx: vi.fn(),
  mockResolvePublic: vi.fn(),
  mockNetConnect: vi.fn(),
  mockTlsConnect: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({ default: { resolveMx: mockResolveMx } }));
vi.mock("../network.js", () => ({ resolvePublic: mockResolvePublic }));
vi.mock("node:net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:net")>();
  return { default: { ...actual, connect: mockNetConnect } };
});
vi.mock("node:tls", () => ({ default: { connect: mockTlsConnect } }));

import { MxTlsCheck } from "./mx-tls.js";

const endpoint: EndpointData = {
  url: "https://example.com",
  finalUrl: "https://example.com/",
  statusCode: 200,
  headers: {},
  setCookies: [],
  body: "",
  redirectChain: [],
};

interface Server {
  /** What happens on connect. */
  connect?: "ok" | "refused" | "hang";
  banner?: string;
  ehlo?: string;
  starttlsReply?: string;
  tls?: "ok" | "fail";
  authorized?: boolean;
  authorizationError?: string;
  protocol?: string;
  validTo?: string;
}

const DEFAULT_EHLO =
  "250-mx.example.com at your service\r\n250-SIZE 157286400\r\n250-8BITMIME\r\n250-STARTTLS\r\n250-ENHANCEDSTATUSCODES\r\n250 SMTPUTF8\r\n";

/** Fake SMTP servers, keyed by the IP the check connects to. */
function servers(byIp: Record<string, Server>) {
  mockNetConnect.mockImplementation((opts: { host: string; port: number }) => {
    const s = byIp[opts.host] ?? { connect: "refused" };
    const socket = Object.assign(new EventEmitter(), {
      written: [] as string[],
      write: vi.fn((data: string) => {
        socket.written.push(data);
        setImmediate(() => {
          if (data.startsWith("EHLO")) socket.emit("data", Buffer.from(s.ehlo ?? DEFAULT_EHLO));
          if (data === "STARTTLS\r\n")
            socket.emit("data", Buffer.from(s.starttlsReply ?? "220 2.0.0 Ready to start TLS\r\n"));
        });
        return true;
      }),
      end: vi.fn((data?: string) => {
        if (data) socket.written.push(data);
      }),
      destroy: vi.fn(),
    });
    setImmediate(() => {
      if (s.connect === "refused") {
        socket.emit(
          "error",
          Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
        );
        socket.emit("close");
        return;
      }
      if (s.connect === "hang") return;
      socket.emit("connect");
      // Real servers often send a multi-line greeting.
      socket.emit("data", Buffer.from(s.banner ?? "220-mx.example.com ESMTP\r\n220 ready\r\n"));
    });

    mockTlsConnect.mockImplementation(() => {
      const secure = Object.assign(new EventEmitter(), {
        authorized: s.authorized ?? true,
        authorizationError: s.authorizationError ?? null,
        getProtocol: () => s.protocol ?? "TLSv1.3",
        getPeerCertificate: () => ({ valid_to: s.validTo ?? "Dec 31 23:59:59 2026 GMT" }),
        end: vi.fn(),
        destroy: vi.fn(),
      });
      setImmediate(() => {
        if (s.tls === "fail") secure.emit("error", new Error("handshake failure"));
        else secure.emit("secureConnect");
      });
      return secure;
    });
    return socket;
  });
}

describe("MxTlsCheck", () => {
  const check = new MxTlsCheck();

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolvePublic.mockImplementation(async (host: string) => {
      if (host === "mx1.example.com") return ["2001:db8::1", "198.51.100.1"];
      if (host === "mx2.example.com") return ["198.51.100.2"];
      if (host === "mx3.example.com") return ["198.51.100.3"];
      return null;
    });
  });

  it("has the correct name and is light", () => {
    expect(check.name).toBe("mx-tls");
    expect("heavy" in check).toBe(false);
  });

  it("negotiates STARTTLS and reports the certificate", async () => {
    mockResolveMx.mockResolvedValue([{ exchange: "mx1.example.com", priority: 10 }]);
    servers({ "198.51.100.1": {} });

    const result = await check.run(endpoint, "example.com");

    expect(result).toEqual({
      name: "mx-tls",
      data: {
        hasMx: true,
        nullMx: false,
        hosts: [
          {
            host: "mx1.example.com",
            priority: 10,
            reachable: true,
            starttls: true,
            tlsVersion: "TLSv1.3",
            certValid: true,
            certError: null,
            certExpires: "2026-12-31T23:59:59.000Z",
            skipped: null,
            error: null,
          },
        ],
        allStarttls: true,
        allCertsValid: true,
        earliestCertExpiry: "2026-12-31T23:59:59.000Z",
        anyReachable: true,
        error: null,
      },
    });
    // Connected to the resolved IPv4 address on port 25, SNI to the MX name.
    expect(mockNetConnect).toHaveBeenCalledWith({ host: "198.51.100.1", port: 25 });
    expect(mockTlsConnect.mock.calls[0][0]).toMatchObject({
      servername: "mx1.example.com",
      rejectUnauthorized: false,
    });
    const socket = mockNetConnect.mock.results[0].value as { written: string[] };
    expect(socket.written).toEqual(["EHLO site-inspector.local\r\n", "STARTTLS\r\n"]);
  });

  it("reports an invalid certificate", async () => {
    mockResolveMx.mockResolvedValue([{ exchange: "mx1.example.com", priority: 10 }]);
    servers({
      "198.51.100.1": {
        authorized: false,
        authorizationError: "ERR_TLS_CERT_ALTNAME_INVALID",
        protocol: "TLSv1.2",
      },
    });
    const result = await check.run(endpoint, "example.com");
    const [host] = result.data.hosts as Array<Record<string, unknown>>;
    expect(host.certValid).toBe(false);
    expect(host.certError).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
    expect(host.tlsVersion).toBe("TLSv1.2");
    expect(result.data.allCertsValid).toBe(false);
  });

  it("reports hosts that don't advertise STARTTLS", async () => {
    mockResolveMx.mockResolvedValue([{ exchange: "mx1.example.com", priority: 10 }]);
    servers({ "198.51.100.1": { ehlo: "250-mx.example.com\r\n250 8BITMIME\r\n" } });
    const result = await check.run(endpoint, "example.com");
    const [host] = result.data.hosts as Array<Record<string, unknown>>;
    expect(host.reachable).toBe(true);
    expect(host.starttls).toBe(false);
    expect(host.tlsVersion).toBeNull();
    expect(mockTlsConnect).not.toHaveBeenCalled();
    expect(result.data.allStarttls).toBe(false);
    const socket = mockNetConnect.mock.results[0].value as { written: string[] };
    expect(socket.written).toContain("QUIT\r\n");
  });

  it("treats a refused port 25 as unknown, never as no STARTTLS", async () => {
    mockResolveMx.mockResolvedValue([{ exchange: "mx1.example.com", priority: 10 }]);
    servers({ "198.51.100.1": { connect: "refused" } });
    const result = await check.run(endpoint, "example.com");
    const [host] = result.data.hosts as Array<Record<string, unknown>>;
    expect(host.reachable).toBe(false);
    expect(host.starttls).toBeNull();
    expect(host.error).toMatch(/ECONNREFUSED/);
    expect(result.data.allStarttls).toBeNull();
    expect(result.data.allCertsValid).toBeNull();
    expect(result.data.anyReachable).toBe(false);
  });

  it("times out a silent host as unknown", async () => {
    mockResolveMx.mockResolvedValue([{ exchange: "mx1.example.com", priority: 10 }]);
    servers({ "198.51.100.1": { connect: "hang" } });
    const result = await check.run(endpoint, "example.com", {
      timeoutMs: 50,
      signal: new AbortController().signal,
    });
    const [host] = result.data.hosts as Array<Record<string, unknown>>;
    expect(host.reachable).toBe(false);
    expect(host.starttls).toBeNull();
    expect(host.error).toBe("timed out");
    const socket = mockNetConnect.mock.results[0].value as { destroy: () => void };
    expect(socket.destroy).toHaveBeenCalled();
  });

  it("doesn't connect at all when already aborted", async () => {
    mockResolveMx.mockResolvedValue([{ exchange: "mx1.example.com", priority: 10 }]);
    servers({ "198.51.100.1": {} });
    const controller = new AbortController();
    controller.abort();
    const result = await check.run(endpoint, "example.com", {
      timeoutMs: 5000,
      signal: controller.signal,
    });
    expect(mockNetConnect).not.toHaveBeenCalled();
    const [host] = result.data.hosts as Array<Record<string, unknown>>;
    expect(host.starttls).toBeNull();
    expect(host.error).toBe("aborted");
  });

  it("stops and destroys sockets when aborted", async () => {
    mockResolveMx.mockResolvedValue([{ exchange: "mx1.example.com", priority: 10 }]);
    servers({ "198.51.100.1": { connect: "hang" } });
    const controller = new AbortController();
    const pending = check.run(endpoint, "example.com", {
      timeoutMs: 60_000,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(mockNetConnect).toHaveBeenCalled());
    controller.abort();
    const result = await pending;
    const [host] = result.data.hosts as Array<Record<string, unknown>>;
    expect(host.starttls).toBeNull();
    expect(host.error).toBe("aborted");
    const socket = mockNetConnect.mock.results[0].value as { destroy: () => void };
    expect(socket.destroy).toHaveBeenCalled();
  });

  it("keeps starttls advertised but records the error when the TLS handshake fails", async () => {
    mockResolveMx.mockResolvedValue([{ exchange: "mx1.example.com", priority: 10 }]);
    servers({ "198.51.100.1": { tls: "fail" } });
    const result = await check.run(endpoint, "example.com");
    const [host] = result.data.hosts as Array<Record<string, unknown>>;
    expect(host.starttls).toBe(true);
    expect(host.tlsVersion).toBeNull();
    expect(host.certValid).toBeNull();
    expect(host.error).toBe("handshake failure");
  });

  it("leaves starttls unknown when the server rejects the connection", async () => {
    mockResolveMx.mockResolvedValue([{ exchange: "mx1.example.com", priority: 10 }]);
    servers({ "198.51.100.1": { banner: "554 5.7.1 No SMTP service here\r\n" } });
    const result = await check.run(endpoint, "example.com");
    const [host] = result.data.hosts as Array<Record<string, unknown>>;
    expect(host.reachable).toBe(true);
    expect(host.starttls).toBeNull();
    expect(host.error).toBe("greeting was 554");
    expect(result.data.allStarttls).toBeNull();
  });

  it("skips hosts that don't resolve to public addresses", async () => {
    mockResolveMx.mockResolvedValue([
      { exchange: "internal.example.com", priority: 5 },
      { exchange: "mx2.example.com", priority: 10 },
    ]);
    servers({ "198.51.100.2": {} });
    const result = await check.run(endpoint, "example.com");
    const hosts = result.data.hosts as Array<Record<string, unknown>>;
    expect(hosts[0]).toMatchObject({
      host: "internal.example.com",
      reachable: false,
      starttls: null,
      skipped: "non-public address or unresolvable",
    });
    expect(mockNetConnect).toHaveBeenCalledTimes(1);
    expect(result.data.allStarttls).toBe(true);
  });

  it("sorts by priority, probes at most 5 hosts, and ignores unreachable ones for allStarttls", async () => {
    mockResolveMx.mockResolvedValue([
      { exchange: "mx3.example.com.", priority: 30 },
      { exchange: "mx2.example.com", priority: 20 },
      { exchange: "mx1.example.com", priority: 10 },
      { exchange: "a.example.com", priority: 40 },
      { exchange: "b.example.com", priority: 50 },
      { exchange: "c.example.com", priority: 60 },
    ]);
    servers({ "198.51.100.1": {}, "198.51.100.2": { connect: "refused" }, "198.51.100.3": {} });
    const result = await check.run(endpoint, "example.com");
    const hosts = result.data.hosts as Array<Record<string, unknown>>;
    expect(hosts.map((h) => h.host)).toEqual([
      "mx1.example.com",
      "mx2.example.com",
      "mx3.example.com",
      "a.example.com",
      "b.example.com",
    ]);
    expect(result.data.allStarttls).toBe(true);
    expect(result.data.anyReachable).toBe(true);
  });

  it("recognises a null MX", async () => {
    mockResolveMx.mockResolvedValue([{ exchange: "", priority: 0 }]);
    const result = await check.run(endpoint, "example.com");
    expect(result.data).toEqual({
      hasMx: false,
      nullMx: true,
      hosts: [],
      allStarttls: null,
      allCertsValid: null,
      earliestCertExpiry: null,
      anyReachable: null,
      error: null,
    });
    expect(mockNetConnect).not.toHaveBeenCalled();
  });

  it("reports no MX when the domain has none", async () => {
    mockResolveMx.mockRejectedValue(
      Object.assign(new Error("queryMx ENODATA"), { code: "ENODATA" }),
    );
    const result = await check.run(endpoint, "example.com");
    expect(result.data.hasMx).toBe(false);
    expect(result.data.nullMx).toBe(false);
    expect(result.data.error).toBeNull();
  });

  it("reports a failed MX lookup as unknown", async () => {
    mockResolveMx.mockRejectedValue(
      Object.assign(new Error("queryMx ETIMEOUT"), { code: "ETIMEOUT" }),
    );
    const result = await check.run(endpoint, "example.com");
    expect(result.data.hasMx).toBeNull();
    expect(result.data.error).toBe("ETIMEOUT");
  });
});
