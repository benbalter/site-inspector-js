import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EndpointData } from "../types.js";

const { mockWhois } = vi.hoisted(() => ({
  mockWhois: vi.fn(),
}));

vi.mock("whois-json", () => ({
  default: mockWhois,
}));

import { WhoisCheck } from "./whois.js";

const dummyEndpoint: EndpointData = {
  url: "https://example.com",
  statusCode: 200,
  headers: {},
  body: "",
  redirectChain: [],
};

describe("WhoisCheck", () => {
  const check = new WhoisCheck();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("returns full WHOIS data for a domain", async () => {
    mockWhois.mockResolvedValue({
      domainName: "example.com",
      registrar: "Example Registrar",
      creationDate: "2020-01-01T00:00:00Z",
      expirationDate: "2030-01-01T00:00:00Z",
      updatedDate: "2023-06-15T00:00:00Z",
      nameServer: "ns1.example.com\nns2.example.com",
      registrantOrganization: "Example Inc.",
    });

    vi.useFakeTimers({ now: new Date("2025-01-01T00:00:00Z") });

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.name).toBe("whois");
    expect(result.data.registrar).toBe("Example Registrar");
    expect(result.data.creationDate).toBe("2020-01-01T00:00:00Z");
    expect(result.data.expirationDate).toBe("2030-01-01T00:00:00Z");
    expect(result.data.updatedDate).toBe("2023-06-15T00:00:00Z");
    expect(result.data.nameServers).toEqual(["ns1.example.com", "ns2.example.com"]);
    expect(result.data.registrantOrganization).toBe("Example Inc.");
    expect(result.data.domainAge).toBe(1827); // 5 years (2020-2025, 2 leap years)
    expect(result.data.expiresIn).toBe(1826); // 5 years (2025-2030, 1 leap year)
    expect(result.data.error).toBeNull();
  });

  it("handles minimal WHOIS data with missing fields", async () => {
    mockWhois.mockResolvedValue({
      domainName: "minimal.com",
    });

    const result = await check.run(dummyEndpoint, "minimal.com");

    expect(result.name).toBe("whois");
    expect(result.data.registrar).toBeNull();
    expect(result.data.creationDate).toBeNull();
    expect(result.data.expirationDate).toBeNull();
    expect(result.data.updatedDate).toBeNull();
    expect(result.data.nameServers).toEqual([]);
    expect(result.data.registrantOrganization).toBeNull();
    expect(result.data.domainAge).toBeNull();
    expect(result.data.expiresIn).toBeNull();
    expect(result.data.error).toBeNull();
  });

  it("returns error data when WHOIS lookup fails", async () => {
    mockWhois.mockRejectedValue(new Error("WHOIS lookup timed out"));

    const result = await check.run(dummyEndpoint, "fail.com");

    expect(result.name).toBe("whois");
    expect(result.data.error).toBe("WHOIS lookup timed out");
    expect(result.data.registrar).toBeNull();
    expect(result.data.nameServers).toEqual([]);
    expect(result.data.domainAge).toBeNull();
  });

  it("normalizes array results from some TLDs", async () => {
    mockWhois.mockResolvedValue([
      {
        domainName: "example.co.uk",
        registrar: "UK Registrar",
        nameServer: "ns1.uk.com",
      },
      {
        domainName: "example.co.uk",
        registrar: "Secondary",
      },
    ]);

    const result = await check.run(dummyEndpoint, "example.co.uk");

    expect(result.data.registrar).toBe("UK Registrar");
    expect(result.data.nameServers).toEqual(["ns1.uk.com"]);
  });

  it("computes domainAge and expiresIn correctly", async () => {
    mockWhois.mockResolvedValue({
      domainName: "example.com",
      creationDate: "2024-06-01T00:00:00Z",
      expirationDate: "2025-06-01T00:00:00Z",
    });

    vi.useFakeTimers({ now: new Date("2025-01-01T00:00:00Z") });

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.data.domainAge).toBe(214); // June 1 2024 → Jan 1 2025
    expect(result.data.expiresIn).toBe(151); // Jan 1 2025 → June 1 2025
  });
});
