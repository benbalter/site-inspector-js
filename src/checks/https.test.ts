import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EndpointData } from "../types.js";

vi.mock("ssl-checker", () => {
  return { sslChecker: vi.fn() };
});

import { sslChecker } from "ssl-checker";
import { HttpsCheck } from "./https.js";

const mockedSslChecker = vi.mocked(sslChecker);

const dummyEndpoint: EndpointData = {
  url: "https://example.com",
  statusCode: 200,
  headers: {},
  body: "",
  redirectChain: [],
};

function makeSslResult(overrides: Record<string, unknown> = {}) {
  return {
    valid: true,
    validationError: null,
    validFrom: "2024-01-01T00:00:00.000Z",
    validTo: "2025-06-01T00:00:00.000Z",
    daysRemaining: 90,
    issuer: { CN: "Let's Encrypt Authority X3", O: "Let's Encrypt", C: "US" },
    subject: { CN: "example.com", O: "Example Inc", C: "US" },
    fingerprint256: "AB:CD:EF:12:34:56:78:90",
    serialNumber: "0123456789ABCDEF",
    protocol: "TLSv1.3",
    cipher: "TLS_AES_256_GCM_SHA384",
    bits: 256,
    chain: [
      { subject: { CN: "example.com" }, issuer: { CN: "Let's Encrypt Authority X3" } },
      { subject: { CN: "Let's Encrypt Authority X3" }, issuer: { CN: "DST Root CA X3" } },
    ],
    chainComplete: true,
    ...overrides,
  };
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
    mockedSslChecker.mockResolvedValue(makeSslResult() as never);

    const result = await check.run(dummyEndpoint, "example.com");

    expect(mockedSslChecker).toHaveBeenCalledWith("example.com", { timeout: 10_000 });
    expect(result.name).toBe("https");
    expect(result.data.valid).toBe(true);
    expect(result.data.validationError).toBeNull();
    expect(result.data.certIssuer).toBe("Let's Encrypt Authority X3");
    expect(result.data.certSubject).toBe("example.com");
    expect(result.data.validFrom).toBe("2024-01-01T00:00:00.000Z");
    expect(result.data.validTo).toBe("2025-06-01T00:00:00.000Z");
    expect(result.data.certDaysRemaining).toBe(90);
    expect(result.data.expiringSoon).toBe(false);
    expect(result.data.protocol).toBe("TLSv1.3");
    expect(result.data.cipher).toBe("TLS_AES_256_GCM_SHA384");
    expect(result.data.bits).toBe(256);
    expect(result.data.fingerprint256).toBe("AB:CD:EF:12:34:56:78:90");
    expect(result.data.chainComplete).toBe(true);
    expect(result.data.chainLength).toBe(2);
    expect(result.data.error).toBeNull();
  });

  it("reports an invalid/expired certificate", async () => {
    mockedSslChecker.mockResolvedValue(
      makeSslResult({
        valid: false,
        validationError: "CERT_HAS_EXPIRED",
        daysRemaining: -10,
        validTo: "2023-01-01T00:00:00.000Z",
      }) as never,
    );

    const result = await check.run(dummyEndpoint, "expired.example.com");

    expect(result.data.valid).toBe(false);
    expect(result.data.validationError).toBe("CERT_HAS_EXPIRED");
    expect(result.data.certDaysRemaining).toBe(-10);
    expect(result.data.expiringSoon).toBe(true);
    expect(result.data.error).toBeNull();
  });

  it("handles a connection error", async () => {
    mockedSslChecker.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await check.run(dummyEndpoint, "down.example.com");

    expect(result.data.valid).toBe(false);
    expect(result.data.certIssuer).toBeNull();
    expect(result.data.certSubject).toBeNull();
    expect(result.data.validFrom).toBeNull();
    expect(result.data.validTo).toBeNull();
    expect(result.data.certDaysRemaining).toBeNull();
    expect(result.data.expiringSoon).toBeNull();
    expect(result.data.protocol).toBeNull();
    expect(result.data.cipher).toBeNull();
    expect(result.data.bits).toBeNull();
    expect(result.data.fingerprint256).toBeNull();
    expect(result.data.chainComplete).toBeNull();
    expect(result.data.chainLength).toBeNull();
    expect(result.data.error).toBe("ECONNREFUSED");
  });

  it("populates all output fields", async () => {
    mockedSslChecker.mockResolvedValue(makeSslResult() as never);

    const result = await check.run(dummyEndpoint, "example.com");
    const expectedKeys = [
      "valid",
      "validationError",
      "certIssuer",
      "certSubject",
      "validFrom",
      "validTo",
      "certDaysRemaining",
      "expiringSoon",
      "protocol",
      "cipher",
      "bits",
      "fingerprint256",
      "chainComplete",
      "chainLength",
      "error",
    ];

    for (const key of expectedKeys) {
      expect(result.data).toHaveProperty(key);
      expect(result.data[key]).not.toBeUndefined();
    }
  });
});
