import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import net from "node:net";
import { EventEmitter } from "node:events";
import type { EndpointData } from "../types.js";

const { mockResolveMx, mockTlsConnect } = vi.hoisted(() => ({
  mockResolveMx: vi.fn(),
  mockTlsConnect: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({ default: { resolveMx: mockResolveMx } }));
// The TLS upgrade needs a certificate, so only it is faked; the SMTP dialogue
// runs against a real local server.
vi.mock("node:tls", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:tls")>();
  return { default: { ...actual, connect: mockTlsConnect } };
});

const { probeSmtp, SmtpTlsCheck } = await import("./smtp-tls.js");

/**
 * A minimal SMTP server: greets with `greeting`, answers EHLO with
 * `ehloLines`, and answers STARTTLS with 220. Records every command.
 */
async function fakeSmtp(greeting: string, ehloLines: string[]) {
  const commands: string[] = [];
  const server = net.createServer((socket) => {
    socket.write(`${greeting}\r\n`);
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let i: number;
      while ((i = buffer.indexOf("\r\n")) !== -1) {
        const command = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        commands.push(command);
        if (command.startsWith("EHLO")) socket.write(ehloLines.map((l) => `${l}\r\n`).join(""));
        else if (command === "STARTTLS") socket.write("220 2.0.0 Ready to start TLS\r\n");
        else if (command === "QUIT") socket.end("221 Bye\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  return { port, commands, close: () => server.close() };
}

/** A TLS socket that completes its handshake with the given outcome. */
function fakeTlsSocket(protocol: string, authorized: boolean, authorizationError?: string) {
  mockTlsConnect.mockImplementation((_opts: unknown, onSecure: () => void) => {
    const socket = Object.assign(new EventEmitter(), {
      getProtocol: () => protocol,
      authorized,
      authorizationError: authorizationError ? new Error(authorizationError) : null,
      end: vi.fn((_data: string, done?: () => void) => done?.()),
      destroy: vi.fn(),
    });
    setImmediate(onSecure);
    return socket;
  });
}

const EHLO_WITH_STARTTLS = [
  "250-mx.example.com Hello",
  "250-SIZE 35882577",
  "250-8BITMIME",
  "250-STARTTLS",
  "250 SMTPUTF8",
];

describe("probeSmtp", () => {
  let server: Awaited<ReturnType<typeof fakeSmtp>> | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
    vi.clearAllMocks();
  });

  it("upgrades with STARTTLS and reports the TLS version and certificate", async () => {
    server = await fakeSmtp("220 mx.example.com ESMTP", EHLO_WITH_STARTTLS);
    fakeTlsSocket("TLSv1.3", true);

    const result = await probeSmtp("127.0.0.1", server.port, 2000);

    expect(result).toEqual({
      host: "127.0.0.1",
      connected: true,
      starttls: true,
      tlsVersion: "TLSv1.3",
      certificateValid: true,
      error: null,
    });
    expect(server.commands).toEqual(["EHLO site-inspector.invalid", "STARTTLS"]);
  });

  it("reports a certificate that doesn't validate, with the reason", async () => {
    server = await fakeSmtp("220 mx.example.com ESMTP", EHLO_WITH_STARTTLS);
    fakeTlsSocket("TLSv1.2", false, "DEPTH_ZERO_SELF_SIGNED_CERT");

    const result = await probeSmtp("127.0.0.1", server.port, 2000);

    expect(result).toMatchObject({
      starttls: true,
      certificateValid: false,
      error: "Error: DEPTH_ZERO_SELF_SIGNED_CERT",
    });
  });

  it("reports a server that doesn't offer STARTTLS, and quits politely", async () => {
    server = await fakeSmtp("220 mx.example.com ESMTP", ["250-mx.example.com", "250 SIZE 1000"]);

    const result = await probeSmtp("127.0.0.1", server.port, 2000);

    expect(result).toMatchObject({ connected: true, starttls: false, tlsVersion: null });
    const { commands } = server;
    await vi.waitFor(() => expect(commands).toEqual(["EHLO site-inspector.invalid", "QUIT"]));
    expect(mockTlsConnect).not.toHaveBeenCalled();
  });

  it("handles a multi-line greeting", async () => {
    server = await fakeSmtp("220-mx.example.com ESMTP\r\n220 No UCE", EHLO_WITH_STARTTLS);
    fakeTlsSocket("TLSv1.3", true);

    const result = await probeSmtp("127.0.0.1", server.port, 2000);

    expect(result.starttls).toBe(true);
  });

  it("reports a refused connection as not connected, not as missing STARTTLS", async () => {
    const closed = await fakeSmtp("220 x", []);
    closed.close();

    const result = await probeSmtp("127.0.0.1", closed.port, 2000);

    expect(result).toMatchObject({ connected: false, starttls: null, error: "ECONNREFUSED" });
  });

  it("gives up on a server that never greets", async () => {
    const silent = net.createServer(() => {});
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const { port } = silent.address() as net.AddressInfo;
    try {
      const result = await probeSmtp("127.0.0.1", port, 200);
      expect(result).toMatchObject({ connected: false, starttls: null, error: "Timed out" });
    } finally {
      silent.close();
    }
  });
});

describe("SmtpTlsCheck", () => {
  const endpoint: EndpointData = {
    url: "https://example.com",
    finalUrl: "https://example.com",
    statusCode: 200,
    headers: {},
    setCookies: [],
    body: "",
    redirectChain: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is heavy, so the public web UI never opens sockets to MX hosts", () => {
    expect(new SmtpTlsCheck().heavy).toBe(true);
  });

  it("reports nothing to probe for a domain without mail servers", async () => {
    mockResolveMx.mockRejectedValue(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));

    const result = await new SmtpTlsCheck().run(endpoint, "example.com");

    expect(result.data).toEqual({
      mxHosts: [],
      connected: null,
      starttls: null,
      validCertificates: null,
      servers: [],
    });
  });

  it("ignores a null MX, which says the domain accepts no mail", async () => {
    mockResolveMx.mockResolvedValue([{ exchange: "", priority: 0 }]);

    const result = await new SmtpTlsCheck().run(endpoint, "example.com");

    expect(result.data.mxHosts).toEqual([]);
  });
});
