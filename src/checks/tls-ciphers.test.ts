import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { EndpointData } from "../types.js";

const { mockConnect, mockCreateSecureContext, mockResolvePublic } = vi.hoisted(() => ({
  mockConnect: vi.fn(),
  mockCreateSecureContext: vi.fn(),
  mockResolvePublic: vi.fn(),
}));

vi.mock("node:tls", () => ({
  default: { connect: mockConnect, createSecureContext: mockCreateSecureContext },
}));
vi.mock("../network.js", () => ({ resolvePublic: mockResolvePublic }));

import { TlsCiphersCheck, STATIC_RSA_SUITES, CBC_SUITES } from "./tls-ciphers.js";

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

/** The local OpenSSL "supports" every suite except these. */
function localOpenssl(unsupported: RegExp = /RC4|EXP-|DES-CBC3/) {
  mockCreateSecureContext.mockImplementation((opts: { ciphers: string }) => {
    if (unsupported.test(opts.ciphers)) {
      throw Object.assign(new Error("no cipher match"), { code: "ERR_SSL_NO_CIPHER_MATCH" });
    }
    return {};
  });
}

const HANDSHAKE_FAILURE = Object.assign(
  new Error(
    "error:0A000410:SSL routines:ssl3_read_bytes:ssl/tls alert handshake failure:SSL alert number 40",
  ),
  { code: "ERR_SSL_SSL/TLS_ALERT_HANDSHAKE_FAILURE" },
);
const RESET = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });

type Behaviour = { cipher: string; version?: string } | { error: Error } | "timeout" | "hang";

/**
 * Fake server: `decide` picks a behaviour from the offered cipher string
 * (undefined for the default connection).
 */
function server(decide: (ciphers: string | undefined) => Behaviour) {
  mockConnect.mockImplementation((opts: { ciphers?: string }, cb?: () => void) => {
    const b = decide(opts.ciphers);
    const socket = Object.assign(new EventEmitter(), {
      destroy: vi.fn(),
      getCipher: () => ({ name: typeof b === "object" && "cipher" in b ? b.cipher : "" }),
      getProtocol: () => (typeof b === "object" && "cipher" in b ? (b.version ?? "TLSv1.2") : null),
    });
    setImmediate(() => {
      if (b === "hang") return;
      if (b === "timeout") socket.emit("timeout");
      else if ("error" in b) socket.emit("error", b.error);
      else cb?.();
    });
    return socket;
  });
}

const offered = (ciphers: string | undefined, suite: string) =>
  ciphers?.split(":").includes(suite) ?? false;

describe("TlsCiphersCheck", () => {
  const check = new TlsCiphersCheck();

  beforeEach(() => {
    vi.clearAllMocks();
    localOpenssl();
    mockResolvePublic.mockResolvedValue(["2001:db8::1", "93.184.216.34"]);
  });

  it("has the correct name", () => {
    expect(check.name).toBe("tls-ciphers");
  });

  it("reports a modern server that refuses static RSA and CBC", async () => {
    server((ciphers) =>
      ciphers === undefined
        ? { cipher: "TLS_AES_128_GCM_SHA256", version: "TLSv1.3" }
        : { error: HANDSHAKE_FAILURE },
    );
    const result = await check.run(endpoint(), "example.com");
    expect(result).toEqual({
      name: "tls-ciphers",
      data: {
        negotiatedCipher: "TLS_AES_128_GCM_SHA256",
        negotiatedVersion: "TLSv1.3",
        staticRsaAccepted: false,
        cbcAccepted: false,
        tripleDesAccepted: null,
        forwardSecrecyOnly: true,
        untestable: ["3DES", "RC4", "EXPORT"],
        skipped: null,
      },
    });
  });

  it("restricts probes to TLS 1.2 at security level 0 against the public address", async () => {
    server(() => ({ cipher: "ECDHE-RSA-AES128-GCM-SHA256" }));
    await check.run(endpoint(), "example.com");
    const calls = mockConnect.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(calls).toHaveLength(3); // default + static RSA + CBC (3DES untestable)
    for (const opts of calls) {
      expect(opts.host).toBe("93.184.216.34");
      expect(opts.servername).toBe("example.com");
      expect(opts.port).toBe(443);
    }
    expect(calls[0].ciphers).toBeUndefined();
    expect(calls[1]).toMatchObject({
      minVersion: "TLSv1.2",
      maxVersion: "TLSv1.2",
      ciphers: `${STATIC_RSA_SUITES.join(":")}:@SECLEVEL=0`,
    });
    expect(calls[2].ciphers).toBe(`${CBC_SUITES.join(":")}:@SECLEVEL=0`);
    expect(calls[2].ciphers).toContain("ECDHE-ECDSA-AES128-SHA");
  });

  it("reports a legacy server that accepts static RSA and CBC", async () => {
    server((ciphers) =>
      ciphers === undefined || offered(ciphers, "AES128-SHA")
        ? { cipher: "AES128-SHA" }
        : { error: HANDSHAKE_FAILURE },
    );
    const result = await check.run(endpoint(), "example.com");
    expect(result.data.staticRsaAccepted).toBe(true);
    expect(result.data.cbcAccepted).toBe(true);
    expect(result.data.forwardSecrecyOnly).toBe(false);
  });

  it("tests 3DES when the local OpenSSL can offer it", async () => {
    localOpenssl(/RC4|EXP-/);
    server((ciphers) =>
      ciphers === undefined || offered(ciphers, "DES-CBC3-SHA")
        ? { cipher: "DES-CBC3-SHA" }
        : { error: HANDSHAKE_FAILURE },
    );
    const result = await check.run(endpoint(), "example.com");
    expect(result.data.tripleDesAccepted).toBe(true);
    expect(result.data.untestable).toEqual(["RC4", "EXPORT"]);
    const threeDes = mockConnect.mock.calls.find((c) =>
      offered((c[0] as { ciphers?: string }).ciphers, "DES-CBC3-SHA"),
    );
    expect((threeDes?.[0] as { ciphers: string }).ciphers).toBe(
      "DES-CBC3-SHA:ECDHE-RSA-DES-CBC3-SHA:@SECLEVEL=0",
    );
  });

  it("reports a refused 3DES probe as not accepted", async () => {
    localOpenssl(/RC4|EXP-/);
    server((ciphers) =>
      ciphers === undefined ? { cipher: "TLS_AES_256_GCM_SHA384" } : { error: HANDSHAKE_FAILURE },
    );
    const result = await check.run(endpoint(), "example.com");
    expect(result.data.tripleDesAccepted).toBe(false);
  });

  it("treats a TLS 1.3-only server's protocol_version alert as refusal", async () => {
    const protocolVersion = Object.assign(new Error("tlsv1 alert protocol version"), {
      code: "ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION",
    });
    server((ciphers) =>
      ciphers === undefined
        ? { cipher: "TLS_AES_128_GCM_SHA256", version: "TLSv1.3" }
        : { error: protocolVersion },
    );
    const result = await check.run(endpoint(), "example.com");
    expect(result.data.staticRsaAccepted).toBe(false);
    expect(result.data.forwardSecrecyOnly).toBe(true);
  });

  it("reports unknown, not refused, when a probe is reset or times out", async () => {
    server((ciphers) =>
      ciphers === undefined
        ? { cipher: "ECDHE-RSA-AES128-GCM-SHA256" }
        : offered(ciphers, "ECDHE-RSA-AES128-SHA")
          ? "timeout"
          : { error: RESET },
    );
    const result = await check.run(endpoint(), "example.com");
    expect(result.data.staticRsaAccepted).toBeNull();
    expect(result.data.cbcAccepted).toBeNull();
    expect(result.data.forwardSecrecyOnly).toBeNull();
  });

  it("reports everything unknown when the default handshake fails", async () => {
    server(() => ({ error: RESET }));
    const result = await check.run(endpoint(), "example.com");
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(result.data).toMatchObject({
      negotiatedCipher: null,
      negotiatedVersion: null,
      staticRsaAccepted: null,
      cbcAccepted: null,
      tripleDesAccepted: null,
      forwardSecrecyOnly: null,
    });
  });

  it("destroys the socket and stops on abort", async () => {
    server(() => "hang");
    const controller = new AbortController();
    const pending = check.run(endpoint(), "example.com", {
      timeoutMs: 5000,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(mockConnect).toHaveBeenCalled());
    controller.abort();
    const result = await pending;
    expect(result.data.negotiatedCipher).toBeNull();
    expect(mockConnect).toHaveBeenCalledTimes(1);
    const socket = mockConnect.mock.results[0].value as { destroy: () => void };
    expect(socket.destroy).toHaveBeenCalled();
  });

  it("skips non-public hosts", async () => {
    mockResolvePublic.mockResolvedValue(null);
    server(() => ({ cipher: "AES128-SHA" }));
    const result = await check.run(endpoint(), "example.com");
    expect(mockConnect).not.toHaveBeenCalled();
    expect(result.data.skipped).toBe("non-public address or unresolvable");
    expect(result.data.staticRsaAccepted).toBeNull();
  });

  it("skips plain-http endpoints", async () => {
    server(() => ({ cipher: "AES128-SHA" }));
    const result = await check.run(endpoint({ url: "http://example.com" }), "example.com");
    expect(mockConnect).not.toHaveBeenCalled();
    expect(result.data.skipped).toBe("not https");
  });
});
