import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EndpointData } from "../types.js";

// Mock node:tls before importing the check
vi.mock("node:tls", () => {
  return { default: { connect: vi.fn() } };
});

import tls from "node:tls";
import { HttpsCheck } from "./https.js";

const mockedConnect = vi.mocked(tls.connect);

const dummyEndpoint: EndpointData = {
  url: "https://example.com",
  statusCode: 200,
  headers: {},
  body: "",
  redirectChain: [],
};

function createMockSocket(overrides: {
  authorized?: boolean;
  cert?: Record<string, unknown>;
  protocol?: string | null;
  error?: Error;
  timeout?: boolean;
}) {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const socket = {
    authorized: overrides.authorized ?? true,
    getPeerCertificate: vi.fn(() => overrides.cert ?? {}),
    getProtocol: vi.fn(() => overrides.protocol ?? "TLSv1.3"),
    end: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(cb);
      return socket;
    }),
    emit: (event: string, ...args: unknown[]) => {
      for (const cb of handlers[event] ?? []) cb(...args);
    },
  };
  return socket;
}

describe("HttpsCheck", () => {
  let check: HttpsCheck;

  beforeEach(() => {
    vi.clearAllMocks();
    check = new HttpsCheck();
  });

  it("has name 'https'", () => {
    expect(check.name).toBe("https");
  });

  it("reports a valid TLS certificate", async () => {
    const futureDateMs = Date.now() + 90 * 24 * 60 * 60 * 1000;
    const futureDate = new Date(futureDateMs);
    futureDate.setMilliseconds(0); // toUTCString drops ms
    const cert = {
      issuer: { CN: "Let's Encrypt Authority X3", O: "Let's Encrypt" },
      valid_to: futureDate.toUTCString(),
    };
    const socket = createMockSocket({ authorized: true, cert, protocol: "TLSv1.3" });

    mockedConnect.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as () => void;
      if (typeof cb === "function") process.nextTick(cb);
      return socket as unknown as tls.TLSSocket;
    });

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.name).toBe("https");
    expect(result.data.valid).toBe(true);
    expect(result.data.certIssuer).toBe("Let's Encrypt Authority X3");
    expect(result.data.certExpiry).toBe(futureDate.toISOString());
    expect(result.data.certDaysRemaining).toBeGreaterThanOrEqual(89);
    expect(result.data.certDaysRemaining).toBeLessThanOrEqual(90);
    expect(result.data.protocol).toBe("TLSv1.3");
    expect(result.data.error).toBeNull();
  });

  it("reports an expired certificate", async () => {
    const pastDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const cert = {
      issuer: { O: "DigiCert Inc" },
      valid_to: pastDate.toUTCString(),
    };
    const socket = createMockSocket({ authorized: true, cert, protocol: "TLSv1.2" });

    mockedConnect.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as () => void;
      if (typeof cb === "function") process.nextTick(cb);
      return socket as unknown as tls.TLSSocket;
    });

    const result = await check.run(dummyEndpoint, "expired.example.com");

    expect(result.data.valid).toBe(true);
    expect(result.data.certIssuer).toBe("DigiCert Inc");
    expect(result.data.certDaysRemaining).toBeLessThan(0);
    expect(result.data.protocol).toBe("TLSv1.2");
    expect(result.data.error).toBeNull();
  });

  it("handles a connection error", async () => {
    const socket = createMockSocket({ error: new Error("ECONNREFUSED") });

    mockedConnect.mockImplementation((..._args: unknown[]) => {
      process.nextTick(() => socket.emit("error", new Error("ECONNREFUSED")));
      return socket as unknown as tls.TLSSocket;
    });

    const result = await check.run(dummyEndpoint, "down.example.com");

    expect(result.data.valid).toBe(false);
    expect(result.data.certIssuer).toBeNull();
    expect(result.data.certExpiry).toBeNull();
    expect(result.data.certDaysRemaining).toBeNull();
    expect(result.data.protocol).toBeNull();
    expect(result.data.error).toBe("ECONNREFUSED");
  });

  it("calculates days remaining correctly", async () => {
    const daysFromNow = 42;
    const futureDate = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
    const cert = {
      issuer: { CN: "Test CA" },
      valid_to: futureDate.toUTCString(),
    };
    const socket = createMockSocket({ authorized: true, cert, protocol: "TLSv1.3" });

    mockedConnect.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as () => void;
      if (typeof cb === "function") process.nextTick(cb);
      return socket as unknown as tls.TLSSocket;
    });

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.data.certDaysRemaining).toBeGreaterThanOrEqual(41);
    expect(result.data.certDaysRemaining).toBeLessThanOrEqual(42);
  });
});
