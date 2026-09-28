import { describe, it, expect, vi } from "vitest";
import type { EndpointData } from "../types.js";

// Controllable run() implementations for the timeout and ordering tests.
const { headersRun, lighthouseRun } = vi.hoisted(() => ({
  headersRun: vi.fn(),
  lighthouseRun: vi.fn(),
}));

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
    run = headersRun.mockResolvedValue({ name: "headers", data: { server: "nginx" } });
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
vi.mock("./sri.js", () => ({
  SriCheck: class {
    name = "sri";
    run = vi.fn().mockResolvedValue({ name: "sri", data: { coverage: 1 } });
  },
}));
vi.mock("./mixed-content.js", () => ({
  MixedContentCheck: class {
    name = "mixed-content";
    run = vi.fn().mockResolvedValue({ name: "mixed-content", data: {} });
  },
}));
vi.mock("./carbon.js", () => ({
  CarbonCheck: class {
    name = "carbon";
    run = vi.fn().mockResolvedValue({ name: "carbon", data: {} });
  },
}));
vi.mock("./whois.js", () => ({
  WhoisCheck: class {
    name = "whois";
    run = vi.fn().mockResolvedValue({ name: "whois", data: {} });
  },
}));
vi.mock("./lighthouse.js", () => ({
  LighthouseCheck: class {
    name = "lighthouse";
    heavy = true;
    run = lighthouseRun.mockResolvedValue({ name: "lighthouse", data: {} });
  },
}));
vi.mock("./csp.js", () => ({
  CspCheck: class {
    name = "csp";
    run = vi.fn().mockResolvedValue({ name: "csp", data: {} });
  },
}));
vi.mock("./robots.js", () => ({
  RobotsCheck: class {
    name = "robots";
    run = vi.fn().mockResolvedValue({ name: "robots", data: {} });
  },
}));
vi.mock("./opengraph.js", () => ({
  OpenGraphCheck: class {
    name = "opengraph";
    run = vi.fn().mockResolvedValue({ name: "opengraph", data: {} });
  },
}));
vi.mock("./dns-security.js", () => ({
  DnsSecurityCheck: class {
    name = "dns-security";
    run = vi.fn().mockResolvedValue({ name: "dns-security", data: {} });
  },
}));
vi.mock("./performance.js", () => ({
  PerformanceCheck: class {
    name = "performance";
    run = vi.fn().mockResolvedValue({ name: "performance", data: {} });
  },
}));
vi.mock("./structured-data.js", () => ({
  StructuredDataCheck: class {
    name = "structured-data";
    run = vi.fn().mockResolvedValue({ name: "structured-data", data: {} });
  },
}));
vi.mock("./hsts-preload.js", () => ({
  HstsPreloadCheck: class {
    name = "hsts-preload";
    run = vi.fn().mockResolvedValue({ name: "hsts-preload", data: {} });
  },
}));
vi.mock("./cors.js", () => ({
  CorsCheck: class {
    name = "cors";
    run = vi.fn().mockResolvedValue({ name: "cors", data: {} });
  },
}));
vi.mock("./referrer-policy.js", () => ({
  ReferrerPolicyCheck: class {
    name = "referrer-policy";
    run = vi.fn().mockResolvedValue({ name: "referrer-policy", data: {} });
  },
}));
vi.mock("./permissions-policy.js", () => ({
  PermissionsPolicyCheck: class {
    name = "permissions-policy";
    run = vi.fn().mockResolvedValue({ name: "permissions-policy", data: {} });
  },
}));
vi.mock("./cache-headers.js", () => ({
  CacheHeadersCheck: class {
    name = "cache-headers";
    run = vi.fn().mockResolvedValue({ name: "cache-headers", data: {} });
  },
}));
vi.mock("./tls-versions.js", () => ({
  TlsVersionsCheck: class {
    name = "tls-versions";
    run = vi.fn().mockResolvedValue({ name: "tls-versions", data: {} });
  },
}));
vi.mock("./email-security.js", () => ({
  EmailSecurityCheck: class {
    name = "email-security";
    run = vi.fn().mockResolvedValue({ name: "email-security", data: {} });
  },
}));
vi.mock("./dnssec.js", () => ({
  DnssecCheck: class {
    name = "dnssec";
    run = vi.fn().mockResolvedValue({ name: "dnssec", data: { enabled: false } });
  },
}));
vi.mock("./ipv6.js", () => ({
  Ipv6Check: class {
    name = "ipv6";
    run = vi.fn().mockResolvedValue({ name: "ipv6", data: { hasIpv6: true } });
  },
}));
vi.mock("./geo.js", () => ({
  GeoCheck: class {
    name = "geo";
    run = vi.fn().mockResolvedValue({ name: "geo", data: {} });
  },
}));
vi.mock("./canonical.js", () => ({
  CanonicalCheck: class {
    name = "canonical";
    run = vi.fn().mockResolvedValue({ name: "canonical", data: {} });
  },
}));
vi.mock("./i18n.js", () => ({
  I18nCheck: class {
    name = "i18n";
    run = vi.fn().mockResolvedValue({ name: "i18n", data: {} });
  },
}));
vi.mock("./mobile.js", () => ({
  MobileCheck: class {
    name = "mobile";
    run = vi.fn().mockResolvedValue({ name: "mobile", data: { isMobile: false } });
  },
}));
vi.mock("./favicon.js", () => ({
  FaviconCheck: class {
    name = "favicon";
    run = vi.fn().mockResolvedValue({ name: "favicon", data: {} });
  },
}));
vi.mock("./privacy.js", () => ({
  PrivacyCheck: class {
    name = "privacy";
    run = vi.fn().mockResolvedValue({ name: "privacy", data: {} });
  },
}));
vi.mock("./a11y-axe.js", () => ({
  A11yAxeCheck: class {
    name = "a11y-axe";
    run = vi.fn().mockResolvedValue({ name: "a11y-axe", data: {} });
  },
}));
vi.mock("./api-discovery.js", () => ({
  ApiDiscoveryCheck: class {
    name = "api-discovery";
    run = vi.fn().mockResolvedValue({ name: "api-discovery", data: { hasApi: false } });
  },
}));
vi.mock("./pwa.js", () => ({
  PwaCheck: class {
    name = "pwa";
    run = vi.fn().mockResolvedValue({ name: "pwa", data: { installable: false } });
  },
}));

vi.mock("./cross-origin-isolation.js", () => ({
  CrossOriginIsolationCheck: class {
    name = "cross-origin-isolation";
    run = vi.fn().mockResolvedValue({ name: "cross-origin-isolation", data: {} });
  },
}));
vi.mock("./reporting.js", () => ({
  ReportingCheck: class {
    name = "reporting";
    run = vi.fn().mockResolvedValue({ name: "reporting", data: {} });
  },
}));
vi.mock("./exposed-files.js", () => ({
  ExposedFilesCheck: class {
    name = "exposed-files";
    run = vi.fn().mockResolvedValue({ name: "exposed-files", data: {} });
  },
}));
vi.mock("./ads-txt.js", () => ({
  AdsTxtCheck: class {
    name = "ads-txt";
    run = vi.fn().mockResolvedValue({ name: "ads-txt", data: {} });
  },
}));
vi.mock("./subdomain-takeover.js", () => ({
  SubdomainTakeoverCheck: class {
    name = "subdomain-takeover";
    run = vi.fn().mockResolvedValue({ name: "subdomain-takeover", data: {} });
  },
}));
vi.mock("./http-versions.js", () => ({
  HttpVersionsCheck: class {
    name = "http-versions";
    run = vi.fn().mockResolvedValue({ name: "http-versions", data: {} });
  },
}));
vi.mock("./caa.js", () => ({
  CaaCheck: class {
    name = "caa";
    run = vi.fn().mockResolvedValue({ name: "caa", data: {} });
  },
}));
vi.mock("./dkim.js", () => ({
  DkimCheck: class {
    name = "dkim";
    run = vi.fn().mockResolvedValue({ name: "dkim", data: {} });
  },
}));
vi.mock("./ocsp-stapling.js", () => ({
  OcspStaplingCheck: class {
    name = "ocsp-stapling";
    run = vi.fn().mockResolvedValue({ name: "ocsp-stapling", data: {} });
  },
}));
vi.mock("./mx-tls.js", () => ({
  MxTlsCheck: class {
    name = "mx-tls";
    run = vi.fn().mockResolvedValue({ name: "mx-tls", data: {} });
  },
}));
vi.mock("./tls-ciphers.js", () => ({
  TlsCiphersCheck: class {
    name = "tls-ciphers";
    run = vi.fn().mockResolvedValue({ name: "tls-ciphers", data: {} });
  },
}));
vi.mock("./certificate-transparency.js", () => ({
  CertificateTransparencyCheck: class {
    name = "certificate-transparency";
    run = vi.fn().mockResolvedValue({ name: "certificate-transparency", data: {} });
  },
}));
vi.mock("./green-hosting.js", () => ({
  GreenHostingCheck: class {
    name = "green-hosting";
    run = vi.fn().mockResolvedValue({ name: "green-hosting", data: {} });
  },
}));
vi.mock("./rpki.js", () => ({
  RpkiCheck: class {
    name = "rpki";
    run = vi.fn().mockResolvedValue({ name: "rpki", data: {} });
  },
}));

vi.mock("./redirect-hygiene.js", () => ({
  RedirectHygieneCheck: class {
    name = "redirect-hygiene";
    run = vi.fn().mockResolvedValue({ name: "redirect-hygiene", data: {} });
  },
}));

const { runChecks, availableChecks } = await import("./index.js");

const mockEndpoint: EndpointData = {
  url: "https://example.com",
  finalUrl: "https://example.com",
  statusCode: 200,
  headers: {},
  setCookies: [],
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
    expect(names).toContain("sri");
    expect(names).toContain("mixed-content");
    expect(names).toContain("carbon");
    expect(names).toContain("whois");
    expect(names).toContain("lighthouse");
    expect(names).toContain("csp");
    expect(names).toContain("robots");
    expect(names).toContain("opengraph");
    expect(names).toContain("dns-security");
    expect(names).toContain("performance");
    expect(names).toContain("structured-data");
    expect(names).toContain("hsts-preload");
    expect(names).toContain("cors");
    expect(names).toContain("referrer-policy");
    expect(names).toContain("permissions-policy");
    expect(names).toContain("cache-headers");
    expect(names).toContain("tls-versions");
    expect(names).toContain("email-security");
    expect(names).toContain("dnssec");
    expect(names).toContain("ipv6");
    expect(names).toContain("geo");
    expect(names).toContain("canonical");
    expect(names).toContain("i18n");
    expect(names).toContain("mobile");
    expect(names).toContain("favicon");
    expect(names).toContain("privacy");
    expect(names).toContain("a11y-axe");
    expect(names).toContain("api-discovery");
    expect(names).toContain("pwa");
    expect(names).toContain("cross-origin-isolation");
    expect(names).toContain("reporting");
    expect(names).toContain("exposed-files");
    expect(names).toContain("ads-txt");
    expect(names).toContain("subdomain-takeover");
    expect(names).toContain("http-versions");
    expect(names).toContain("caa");
    expect(names).toContain("dkim");
    expect(names).toContain("ocsp-stapling");
    expect(names).toContain("mx-tls");
    expect(names).toContain("tls-ciphers");
    expect(names).toContain("certificate-transparency");
    expect(names).toContain("green-hosting");
    expect(names).toContain("rpki");
    expect(names).toContain("redirect-hygiene");
    expect(names).toHaveLength(53);
  });

  it("runs all checks when no filter is specified", async () => {
    const results = await runChecks(mockEndpoint, "example.com");
    expect(Object.keys(results)).toHaveLength(53);
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
      HeadersCheck: class {
        name = "headers";
        run = vi.fn().mockResolvedValue({ name: "headers", data: {} });
      },
    }));
    vi.doMock("./https.js", () => ({
      HttpsCheck: class {
        name = "https";
        run = vi.fn().mockResolvedValue({ name: "https", data: {} });
      },
    }));
    vi.doMock("./hsts.js", () => ({
      HstsCheck: class {
        name = "hsts";
        run = vi.fn().mockResolvedValue({ name: "hsts", data: {} });
      },
    }));
    vi.doMock("./content.js", () => ({
      ContentCheck: class {
        name = "content";
        run = vi.fn().mockResolvedValue({ name: "content", data: {} });
      },
    }));
    vi.doMock("./cookies.js", () => ({
      CookiesCheck: class {
        name = "cookies";
        run = vi.fn().mockResolvedValue({ name: "cookies", data: {} });
      },
    }));
    vi.doMock("./sniffer.js", () => ({
      SnifferCheck: class {
        name = "sniffer";
        run = vi.fn().mockResolvedValue({ name: "sniffer", data: {} });
      },
    }));
    vi.doMock("./accessibility.js", () => ({
      AccessibilityCheck: class {
        name = "accessibility";
        run = vi.fn().mockResolvedValue({ name: "accessibility", data: {} });
      },
    }));
    vi.doMock("./well-known.js", () => ({
      WellKnownCheck: class {
        name = "well-known";
        run = vi.fn().mockResolvedValue({ name: "well-known", data: {} });
      },
    }));
    vi.doMock("./sri.js", () => ({
      SriCheck: class {
        name = "sri";
        run = vi.fn().mockResolvedValue({ name: "sri", data: {} });
      },
    }));
    vi.doMock("./mixed-content.js", () => ({
      MixedContentCheck: class {
        name = "mixed-content";
        run = vi.fn().mockResolvedValue({ name: "mixed-content", data: {} });
      },
    }));
    vi.doMock("./carbon.js", () => ({
      CarbonCheck: class {
        name = "carbon";
        run = vi.fn().mockResolvedValue({ name: "carbon", data: {} });
      },
    }));
    vi.doMock("./whois.js", () => ({
      WhoisCheck: class {
        name = "whois";
        run = vi.fn().mockResolvedValue({ name: "whois", data: {} });
      },
    }));
    vi.doMock("./lighthouse.js", () => ({
      LighthouseCheck: class {
        name = "lighthouse";
        run = vi.fn().mockResolvedValue({ name: "lighthouse", data: {} });
      },
    }));
    vi.doMock("./csp.js", () => ({
      CspCheck: class {
        name = "csp";
        run = vi.fn().mockResolvedValue({ name: "csp", data: {} });
      },
    }));
    vi.doMock("./robots.js", () => ({
      RobotsCheck: class {
        name = "robots";
        run = vi.fn().mockResolvedValue({ name: "robots", data: {} });
      },
    }));
    vi.doMock("./opengraph.js", () => ({
      OpenGraphCheck: class {
        name = "opengraph";
        run = vi.fn().mockResolvedValue({ name: "opengraph", data: {} });
      },
    }));
    vi.doMock("./dns-security.js", () => ({
      DnsSecurityCheck: class {
        name = "dns-security";
        run = vi.fn().mockResolvedValue({ name: "dns-security", data: {} });
      },
    }));
    vi.doMock("./performance.js", () => ({
      PerformanceCheck: class {
        name = "performance";
        run = vi.fn().mockResolvedValue({ name: "performance", data: {} });
      },
    }));
    vi.doMock("./structured-data.js", () => ({
      StructuredDataCheck: class {
        name = "structured-data";
        run = vi.fn().mockResolvedValue({ name: "structured-data", data: {} });
      },
    }));
    vi.doMock("./hsts-preload.js", () => ({
      HstsPreloadCheck: class {
        name = "hsts-preload";
        run = vi.fn().mockResolvedValue({ name: "hsts-preload", data: {} });
      },
    }));
    vi.doMock("./cors.js", () => ({
      CorsCheck: class {
        name = "cors";
        run = vi.fn().mockResolvedValue({ name: "cors", data: {} });
      },
    }));
    vi.doMock("./referrer-policy.js", () => ({
      ReferrerPolicyCheck: class {
        name = "referrer-policy";
        run = vi.fn().mockResolvedValue({ name: "referrer-policy", data: {} });
      },
    }));
    vi.doMock("./permissions-policy.js", () => ({
      PermissionsPolicyCheck: class {
        name = "permissions-policy";
        run = vi.fn().mockResolvedValue({ name: "permissions-policy", data: {} });
      },
    }));
    vi.doMock("./cache-headers.js", () => ({
      CacheHeadersCheck: class {
        name = "cache-headers";
        run = vi.fn().mockResolvedValue({ name: "cache-headers", data: {} });
      },
    }));
    vi.doMock("./tls-versions.js", () => ({
      TlsVersionsCheck: class {
        name = "tls-versions";
        run = vi.fn().mockResolvedValue({ name: "tls-versions", data: {} });
      },
    }));
    vi.doMock("./email-security.js", () => ({
      EmailSecurityCheck: class {
        name = "email-security";
        run = vi.fn().mockResolvedValue({ name: "email-security", data: {} });
      },
    }));
    vi.doMock("./dnssec.js", () => ({
      DnssecCheck: class {
        name = "dnssec";
        run = vi.fn().mockResolvedValue({ name: "dnssec", data: {} });
      },
    }));
    vi.doMock("./ipv6.js", () => ({
      Ipv6Check: class {
        name = "ipv6";
        run = vi.fn().mockResolvedValue({ name: "ipv6", data: {} });
      },
    }));
    vi.doMock("./geo.js", () => ({
      GeoCheck: class {
        name = "geo";
        run = vi.fn().mockResolvedValue({ name: "geo", data: {} });
      },
    }));
    vi.doMock("./canonical.js", () => ({
      CanonicalCheck: class {
        name = "canonical";
        run = vi.fn().mockResolvedValue({ name: "canonical", data: {} });
      },
    }));
    vi.doMock("./i18n.js", () => ({
      I18nCheck: class {
        name = "i18n";
        run = vi.fn().mockResolvedValue({ name: "i18n", data: {} });
      },
    }));
    vi.doMock("./mobile.js", () => ({
      MobileCheck: class {
        name = "mobile";
        run = vi.fn().mockResolvedValue({ name: "mobile", data: {} });
      },
    }));
    vi.doMock("./favicon.js", () => ({
      FaviconCheck: class {
        name = "favicon";
        run = vi.fn().mockResolvedValue({ name: "favicon", data: {} });
      },
    }));
    vi.doMock("./privacy.js", () => ({
      PrivacyCheck: class {
        name = "privacy";
        run = vi.fn().mockResolvedValue({ name: "privacy", data: {} });
      },
    }));
    vi.doMock("./a11y-axe.js", () => ({
      A11yAxeCheck: class {
        name = "a11y-axe";
        run = vi.fn().mockResolvedValue({ name: "a11y-axe", data: {} });
      },
    }));
    vi.doMock("./api-discovery.js", () => ({
      ApiDiscoveryCheck: class {
        name = "api-discovery";
        run = vi.fn().mockResolvedValue({ name: "api-discovery", data: {} });
      },
    }));
    vi.doMock("./pwa.js", () => ({
      PwaCheck: class {
        name = "pwa";
        run = vi.fn().mockResolvedValue({ name: "pwa", data: {} });
      },
    }));

    const freshModule = await import("./index.js");
    const results = await freshModule.runChecks(mockEndpoint, "example.com", ["dns"]);
    expect(results["dns"].data.error).toBe("DNS failed");

    // Restore
    DnsCheck.prototype.run = origRun;
  });
});

describe("runChecks timeouts, ordering, and validation", () => {
  it("throws on unknown check names", async () => {
    await expect(runChecks(mockEndpoint, "example.com", ["dns", "bogus"])).rejects.toThrow(
      "Unknown checks: bogus",
    );
  });

  it("fails a hung check with a timeout error and aborts its signal", async () => {
    let signal: AbortSignal | undefined;
    headersRun.mockImplementationOnce((_ep, _domain, ctx) => {
      signal = ctx.signal;
      return new Promise(() => {});
    });

    const results = await runChecks(mockEndpoint, "example.com", ["headers", "dns"], {
      checkTimeoutMs: 20,
    });

    expect(results.headers.data.error).toBe("Timed out after 20ms");
    expect(results.dns.data).toEqual({ ipv6: true });
    expect(signal?.aborted).toBe(true);
  });

  it("passes the request timeout to checks", async () => {
    await runChecks(mockEndpoint, "example.com", ["headers"], { timeoutMs: 1234 });
    expect(headersRun).toHaveBeenLastCalledWith(
      mockEndpoint,
      "example.com",
      expect.objectContaining({ timeoutMs: 1234 }),
    );
  });

  it("runs heavy checks after light ones, keeping registry order in the output", async () => {
    const order: string[] = [];
    lighthouseRun.mockImplementationOnce(async () => {
      order.push("lighthouse");
      return { name: "lighthouse", data: {} };
    });
    headersRun.mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push("headers");
      return { name: "headers", data: {} };
    });

    const results = await runChecks(mockEndpoint, "example.com", ["lighthouse", "headers"]);

    expect(order).toEqual(["headers", "lighthouse"]);
    expect(Object.keys(results)).toEqual(["headers", "lighthouse"]);
  });
});

describe("availableChecks filters", () => {
  it("separates heavy checks from fast ones", () => {
    const heavy = availableChecks({ heavy: true });
    const fast = availableChecks({ heavy: false });

    expect(heavy).toContain("lighthouse");
    expect(fast).not.toContain("lighthouse");
    expect([...fast, ...heavy].sort()).toEqual(availableChecks().sort());
  });
});
