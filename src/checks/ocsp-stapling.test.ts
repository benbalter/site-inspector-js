import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import tls from "node:tls";
import { OcspStaplingCheck } from "./ocsp-stapling.js";
import type { EndpointData } from "../types.js";

vi.mock("node:tls");

const { mockResolvePublic } = vi.hoisted(() => ({ mockResolvePublic: vi.fn() }));
vi.mock("../network.js", () => ({ resolvePublic: mockResolvePublic }));

// A certificate body fragment with / without the TLS Feature extension OID
// (1.3.6.1.5.5.7.1.24), wrapped in unrelated DER bytes.
const CERT_PLAIN = Buffer.from("3082010a0603551d0f0101ff0404030205a0", "hex");
const CERT_MUST_STAPLE = Buffer.concat([
  CERT_PLAIN,
  Buffer.from("301106082b06010505070118040530030201 05".replace(/ /g, ""), "hex"),
]);

type Outcome =
  | { ocsp: Buffer | null | "none"; cert?: Buffer | null }
  | { error: true }
  | { timeout: true }
  | { hang: true };

function mockTls(outcome: Outcome) {
  vi.mocked(tls.connect).mockImplementation(((_opts: unknown, cb?: () => void) => {
    const socket = Object.assign(new EventEmitter(), {
      destroy: vi.fn(),
      getPeerCertificate: vi.fn(() =>
        "ocsp" in outcome && outcome.cert !== null ? { raw: outcome.cert ?? CERT_PLAIN } : {},
      ),
    });
    setImmediate(() => {
      if ("ocsp" in outcome) {
        if (outcome.ocsp !== "none") socket.emit("OCSPResponse", outcome.ocsp);
        cb?.();
      } else if ("error" in outcome) {
        socket.emit("error", new Error("ECONNRESET"));
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

describe("OcspStaplingCheck", () => {
  const check = new OcspStaplingCheck();

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolvePublic.mockResolvedValue(["93.184.216.34"]);
  });

  it("has the correct name", () => {
    expect(check.name).toBe("ocsp-stapling");
  });

  it("reports a stapled response", async () => {
    mockTls({ ocsp: Buffer.alloc(1500, 1) });
    const result = await check.run(endpoint(), "example.com");
    expect(result).toEqual({
      name: "ocsp-stapling",
      data: { stapled: true, responseBytes: 1500, mustStaple: false, skipped: null },
    });
    const [opts] = vi.mocked(tls.connect).mock.calls[0] as unknown as [tls.ConnectionOptions];
    expect(opts.requestOCSP).toBe(true);
    expect(opts.host).toBe("93.184.216.34");
    expect(opts.servername).toBe("example.com");
    expect(opts.port).toBe(443);
  });

  it("reports no staple when Node signals a null response", async () => {
    mockTls({ ocsp: null });
    const result = await check.run(endpoint(), "example.com");
    expect(result.data.stapled).toBe(false);
    expect(result.data.responseBytes).toBe(0);
  });

  it("reports no staple for an empty response buffer", async () => {
    mockTls({ ocsp: Buffer.alloc(0) });
    const result = await check.run(endpoint(), "example.com");
    expect(result.data.stapled).toBe(false);
  });

  it("reports unknown if the handshake completes without an OCSPResponse event", async () => {
    mockTls({ ocsp: "none" });
    const result = await check.run(endpoint(), "example.com");
    expect(result.data.stapled).toBeNull();
    expect(result.data.responseBytes).toBeNull();
    expect(result.data.mustStaple).toBe(false);
  });

  it("detects the must-staple TLS Feature extension", async () => {
    mockTls({ ocsp: Buffer.alloc(900, 1), cert: CERT_MUST_STAPLE });
    const result = await check.run(endpoint(), "example.com");
    expect(result.data.mustStaple).toBe(true);
  });

  it("leaves mustStaple null when the certificate isn't available", async () => {
    mockTls({ ocsp: null, cert: null });
    const result = await check.run(endpoint(), "example.com");
    expect(result.data.mustStaple).toBeNull();
  });

  it.each([{ error: true as const }, { timeout: true as const }])(
    "reports unknown when the handshake fails (%o)",
    async (outcome) => {
      mockTls(outcome);
      const result = await check.run(endpoint(), "example.com");
      expect(result.data).toEqual({
        stapled: null,
        responseBytes: null,
        mustStaple: null,
        skipped: null,
      });
    },
  );

  it("destroys the socket and reports unknown on abort", async () => {
    mockTls({ hang: true });
    const controller = new AbortController();
    const pending = check.run(endpoint(), "example.com", {
      timeoutMs: 5000,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(tls.connect).toHaveBeenCalled());
    controller.abort();
    const result = await pending;
    expect(result.data.stapled).toBeNull();
    const socket = vi.mocked(tls.connect).mock.results[0].value as { destroy: () => void };
    expect(socket.destroy).toHaveBeenCalled();
  });

  it("skips non-public hosts", async () => {
    mockTls({ ocsp: Buffer.alloc(10, 1) });
    mockResolvePublic.mockResolvedValue(null);
    const result = await check.run(endpoint(), "example.com");
    expect(tls.connect).not.toHaveBeenCalled();
    expect(result.data).toEqual({
      stapled: null,
      responseBytes: null,
      mustStaple: null,
      skipped: "non-public address or unresolvable",
    });
  });

  it("skips plain-http endpoints", async () => {
    mockTls({ ocsp: Buffer.alloc(10, 1) });
    const result = await check.run(endpoint({ url: "http://example.com" }), "example.com");
    expect(tls.connect).not.toHaveBeenCalled();
    expect(result.data.stapled).toBeNull();
    expect(result.data.skipped).toBe("not https");
  });
});
