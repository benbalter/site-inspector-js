import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EndpointData } from "../types.js";

// Mock all check modules to avoid real implementations
vi.mock("./dns.js", () => ({
  DnsCheck: class {
    name = "dns";
    run = vi.fn().mockResolvedValue({ name: "dns", data: { ipv6: true } });
  },
}));
vi.mock("./headers.js", () => ({
  HeadersCheck: class {
    name = "headers";
    run = vi.fn().mockResolvedValue({ name: "headers", data: { server: "nginx" } });
  },
}));
vi.mock("./https.js", () => ({
  HttpsCheck: class {
    name = "https";
    run = vi.fn().mockResolvedValue({ name: "https", data: { valid: true } });
  },
}));
vi.mock("./hsts.js", () => ({
  HstsCheck: class {
    name = "hsts";
    run = vi.fn().mockResolvedValue({ name: "hsts", data: { enabled: true } });
  },
}));
vi.mock("./content.js", () => ({
  ContentCheck: class {
    name = "content";
    run = vi.fn().mockResolvedValue({ name: "content", data: { title: "Test" } });
  },
}));
vi.mock("./cookies.js", () => ({
  CookiesCheck: class {
    name = "cookies";
    run = vi.fn().mockResolvedValue({ name: "cookies", data: { hasCookies: false } });
  },
}));
vi.mock("./sniffer.js", () => ({
  SnifferCheck: class {
    name = "sniffer";
    run = vi.fn().mockResolvedValue({ name: "sniffer", data: { cms: null } });
  },
}));
vi.mock("./accessibility.js", () => ({
  AccessibilityCheck: class {
    name = "accessibility";
    run = vi.fn().mockResolvedValue({ name: "accessibility", data: { htmlLang: true } });
  },
}));
vi.mock("./well-known.js", () => ({
  WellKnownCheck: class {
    name = "well-known";
    run = vi.fn().mockResolvedValue({ name: "well-known", data: {} });
  },
}));

const { runChecks, availableChecks } = await import("./index.js");

const mockEndpoint: EndpointData = {
  url: "https://example.com",
  statusCode: 200,
  headers: {},
  body: "<html></html>",
  redirectChain: [],
};

describe("Check Registry", () => {
  it("lists all available checks", () => {
    const names = availableChecks();
    expect(names).toContain("dns");
    expect(names).toContain("headers");
    expect(names).toContain("https");
    expect(names).toContain("hsts");
    expect(names).toContain("content");
    expect(names).toContain("cookies");
    expect(names).toContain("sniffer");
    expect(names).toContain("accessibility");
    expect(names).toContain("well-known");
    expect(names).toHaveLength(9);
  });

  it("runs all checks when no filter is specified", async () => {
    const results = await runChecks(mockEndpoint, "example.com");
    expect(Object.keys(results)).toHaveLength(9);
    expect(results["dns"].data.ipv6).toBe(true);
    expect(results["headers"].data.server).toBe("nginx");
  });

  it("runs only filtered checks", async () => {
    const results = await runChecks(mockEndpoint, "example.com", ["dns", "headers"]);
    expect(Object.keys(results)).toHaveLength(2);
    expect(results["dns"]).toBeDefined();
    expect(results["headers"]).toBeDefined();
    expect(results["content"]).toBeUndefined();
  });

  it("handles check failures gracefully", async () => {
    // Directly verify error handling by creating a check result with the error shape
    // The registry wraps rejected checks in { name, data: { error: message } }
    // We test this by temporarily breaking the mock's run method on the already-imported module
    const { DnsCheck } = await import("./dns.js");
    const origRun = DnsCheck.prototype.run;
    DnsCheck.prototype.run = vi.fn().mockRejectedValue(new Error("DNS failed"));

    // Need fresh ALL_CHECKS - reimport with cache bust
    vi.resetModules();

    // Re-apply all mocks
    vi.doMock("./dns.js", () => ({
      DnsCheck: class {
        name = "dns";
        run = vi.fn().mockRejectedValue(new Error("DNS failed"));
      },
    }));
    vi.doMock("./headers.js", () => ({
      HeadersCheck: class { name = "headers"; run = vi.fn().mockResolvedValue({ name: "headers", data: {} }); },
    }));
    vi.doMock("./https.js", () => ({
      HttpsCheck: class { name = "https"; run = vi.fn().mockResolvedValue({ name: "https", data: {} }); },
    }));
    vi.doMock("./hsts.js", () => ({
      HstsCheck: class { name = "hsts"; run = vi.fn().mockResolvedValue({ name: "hsts", data: {} }); },
    }));
    vi.doMock("./content.js", () => ({
      ContentCheck: class { name = "content"; run = vi.fn().mockResolvedValue({ name: "content", data: {} }); },
    }));
    vi.doMock("./cookies.js", () => ({
      CookiesCheck: class { name = "cookies"; run = vi.fn().mockResolvedValue({ name: "cookies", data: {} }); },
    }));
    vi.doMock("./sniffer.js", () => ({
      SnifferCheck: class { name = "sniffer"; run = vi.fn().mockResolvedValue({ name: "sniffer", data: {} }); },
    }));
    vi.doMock("./accessibility.js", () => ({
      AccessibilityCheck: class { name = "accessibility"; run = vi.fn().mockResolvedValue({ name: "accessibility", data: {} }); },
    }));
    vi.doMock("./well-known.js", () => ({
      WellKnownCheck: class { name = "well-known"; run = vi.fn().mockResolvedValue({ name: "well-known", data: {} }); },
    }));

    const freshModule = await import("./index.js");
    const results = await freshModule.runChecks(mockEndpoint, "example.com", ["dns"]);
    expect(results["dns"].data.error).toBe("DNS failed");

    // Restore
    DnsCheck.prototype.run = origRun;
  });
});
