import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EndpointData } from "../types.js";

vi.mock("node:dns/promises");
vi.mock("node:net");

import dns from "node:dns/promises";
import net from "node:net";
import { Ipv6Check } from "./ipv6.js";

const mockResolve4 = vi.mocked(dns.resolve4);
const mockResolve6 = vi.mocked(dns.resolve6);
const mockCreateConnection = vi.mocked(net.createConnection);

const dummyEndpoint: EndpointData = {
  url: "https://example.com",
  statusCode: 200,
  headers: {},
  body: "",
  redirectChain: [],
};

describe("Ipv6Check", () => {
  const check = new Ipv6Check();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has the correct name", () => {
    expect(check.name).toBe("ipv6");
  });

  it("detects dual-stack domain with reachable IPv6", async () => {
    mockResolve4.mockResolvedValue(["93.184.216.34"]);
    mockResolve6.mockResolvedValue(["2606:2800:220:1:248:1893:25c8:1946"]);

    // Mock successful connection
    const mockSocket = {
      destroy: vi.fn(),
      on: vi.fn().mockReturnValue({ on: vi.fn() }),
    };
    mockCreateConnection.mockReturnValue(mockSocket);
    // Simulate successful connection by calling the callback
    mockCreateConnection.mockImplementation((_options: unknown, callback?: () => void) => {
      setTimeout(() => callback?.(), 0);
      return mockSocket;
    });

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.name).toBe("ipv6");
    expect(result.data.hasIpv6).toBe(true);
    expect(result.data.hasIpv4).toBe(true);
    expect(result.data.dualStack).toBe(true);
    expect(result.data.ipv6Reachable).toBe(true);
    expect(result.data.aaaaRecords).toEqual(["2606:2800:220:1:248:1893:25c8:1946"]);
    expect(result.data.addressCount).toBe(1);
  });

  it("detects IPv4-only domain (no AAAA records)", async () => {
    mockResolve4.mockResolvedValue(["93.184.216.34"]);
    mockResolve6.mockRejectedValue(new Error("NODATA"));

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.name).toBe("ipv6");
    expect(result.data.hasIpv6).toBe(false);
    expect(result.data.hasIpv4).toBe(true);
    expect(result.data.dualStack).toBe(false);
    expect(result.data.ipv6Reachable).toBe(false);
    expect(result.data.aaaaRecords).toEqual([]);
    expect(result.data.addressCount).toBe(0);
  });

  it("detects IPv6 present but unreachable", async () => {
    mockResolve4.mockResolvedValue(["93.184.216.34"]);
    mockResolve6.mockResolvedValue(["2606:2800:220:1:248:1893:25c8:1946"]);

    // Mock connection failure
    const mockSocket = {
      destroy: vi.fn(),
      on: vi.fn().mockImplementation((event: string, callback?: () => void) => {
        if (event === "error") {
          setTimeout(() => callback?.(), 0);
        }
        return mockSocket;
      }),
    };
    mockCreateConnection.mockReturnValue(mockSocket);

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.name).toBe("ipv6");
    expect(result.data.hasIpv6).toBe(true);
    expect(result.data.hasIpv4).toBe(true);
    expect(result.data.dualStack).toBe(true);
    expect(result.data.ipv6Reachable).toBe(false);
  });

  it("handles domain with no A or AAAA records", async () => {
    mockResolve4.mockRejectedValue(new Error("NODATA"));
    mockResolve6.mockRejectedValue(new Error("NODATA"));

    const result = await check.run(dummyEndpoint, "example.com");

    expect(result.name).toBe("ipv6");
    expect(result.data.hasIpv6).toBe(false);
    expect(result.data.hasIpv4).toBe(false);
    expect(result.data.dualStack).toBe(false);
    expect(result.data.ipv6Reachable).toBe(false);
    expect(result.data.aaaaRecords).toEqual([]);
    expect(result.data.addressCount).toBe(0);
  });

  it("uses correct port for HTTP endpoint", async () => {
    const httpEndpoint: EndpointData = {
      url: "http://example.com",
      statusCode: 200,
      headers: {},
      body: "",
      redirectChain: [],
    };

    mockResolve4.mockResolvedValue(["93.184.216.34"]);
    mockResolve6.mockResolvedValue(["2606:2800:220:1:248:1893:25c8:1946"]);

    const mockSocket = {
      destroy: vi.fn(),
      on: vi.fn().mockReturnValue({ on: vi.fn() }),
    };
    mockCreateConnection.mockReturnValue(mockSocket);
    mockCreateConnection.mockImplementation((_options: unknown, callback?: () => void) => {
      setTimeout(() => callback?.(), 0);
      return mockSocket;
    });

    await check.run(httpEndpoint, "example.com");

    // Verify that port 80 was used (http)
    expect(mockCreateConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "2606:2800:220:1:248:1893:25c8:1946",
        port: 80,
        family: 6,
      }),
      expect.any(Function),
    );
  });

  it("uses correct port for HTTPS endpoint", async () => {
    mockResolve4.mockResolvedValue(["93.184.216.34"]);
    mockResolve6.mockResolvedValue(["2606:2800:220:1:248:1893:25c8:1946"]);

    const mockSocket = {
      destroy: vi.fn(),
      on: vi.fn().mockReturnValue({ on: vi.fn() }),
    };
    mockCreateConnection.mockReturnValue(mockSocket);
    mockCreateConnection.mockImplementation((_options: unknown, callback?: () => void) => {
      setTimeout(() => callback?.(), 0);
      return mockSocket;
    });

    await check.run(dummyEndpoint, "example.com");

    // Verify that port 443 was used (https)
    expect(mockCreateConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "2606:2800:220:1:248:1893:25c8:1946",
        port: 443,
        family: 6,
      }),
      expect.any(Function),
    );
  });
});
