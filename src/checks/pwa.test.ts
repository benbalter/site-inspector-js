import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EndpointData } from "../types.js";

const { PwaCheck } = await import("./pwa.js");

function makeEndpoint(
  url = "https://example.com/page",
  body = "<html></html>",
): EndpointData {
  return {
    url,
    statusCode: 200,
    headers: {},
    body,
    redirectChain: [],
  };
}

describe("PwaCheck", () => {
  const check = new PwaCheck();
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detects full PWA with service worker and manifest", async () => {
    const htmlBody = `
      <html>
        <link rel="manifest" href="/manifest.json">
        <script>
          navigator.serviceWorker.register('/sw.js');
        </script>
      </html>
    `;

    fetchSpy.mockImplementation((url: string) => {
      if (url.includes("manifest.json")) {
        return Promise.resolve({
          status: 200,
          json: async () => ({
            name: "My App",
            short_name: "App",
            start_url: "/",
            display: "standalone",
            icons: [{ src: "/icon.png", sizes: "192x192" }],
          }),
        });
      }
      return Promise.resolve({ status: 200 });
    });

    const result = await check.run(makeEndpoint("https://example.com", htmlBody), "example.com");

    expect(result.name).toBe("pwa");
    expect(result.data.swRegistrationInHtml).toBe(true);
    expect(result.data.hasServiceWorker).toBe(true);
    expect(result.data.hasManifest).toBe(true);
    expect(result.data.manifestName).toBe("My App");
    expect(result.data.manifestDisplay).toBe("standalone");
    expect(result.data.manifestStartUrl).toBe("/");
    expect(result.data.manifestIcons).toBe(1);
    expect(result.data.installable).toBe(true);
  });

  it("detects no PWA signals", async () => {
    fetchSpy.mockResolvedValue({ status: 404 });

    const result = await check.run(
      makeEndpoint("https://example.com", "<html></html>"),
      "example.com",
    );

    expect(result.data.swRegistrationInHtml).toBe(false);
    expect(result.data.hasServiceWorker).toBe(false);
    expect(result.data.hasManifest).toBe(false);
    expect(result.data.manifestName).toBeNull();
    expect(result.data.manifestDisplay).toBeNull();
    expect(result.data.manifestStartUrl).toBeNull();
    expect(result.data.manifestIcons).toBe(0);
    expect(result.data.installable).toBe(false);
  });

  it("detects service worker without manifest", async () => {
    const htmlBody = `
      <html>
        <script>
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/service-worker.js');
          }
        </script>
      </html>
    `;

    fetchSpy.mockResolvedValue({ status: 404 });

    const result = await check.run(makeEndpoint("https://example.com", htmlBody), "example.com");

    expect(result.data.swRegistrationInHtml).toBe(true);
    expect(result.data.hasServiceWorker).toBe(true);
    expect(result.data.hasManifest).toBe(false);
    expect(result.data.installable).toBe(false);
  });

  it("detects manifest without service worker", async () => {
    const htmlBody =
      '<html><link rel="manifest" href="/manifest.webmanifest"></html>';

    fetchSpy.mockImplementation((url: string) => {
      if (url.includes("manifest")) {
        return Promise.resolve({
          status: 200,
          json: async () => ({
            name: "App",
            start_url: "/",
            display: "standalone",
            icons: [{ src: "/icon.png" }],
          }),
        });
      }
      return Promise.resolve({ status: 404 });
    });

    const result = await check.run(makeEndpoint("https://example.com", htmlBody), "example.com");

    expect(result.data.hasServiceWorker).toBe(false);
    expect(result.data.hasManifest).toBe(true);
    expect(result.data.installable).toBe(false);
  });

  it("requires manifest name for installability", async () => {
    const htmlBody = `
      <html>
        <link rel="manifest" href="/manifest.json">
        <script>navigator.serviceWorker.register('/sw.js');</script>
      </html>
    `;

    fetchSpy.mockImplementation((url: string) => {
      if (url.includes("manifest.json")) {
        return Promise.resolve({
          status: 200,
          json: async () => ({
            start_url: "/",
            display: "standalone",
            icons: [{ src: "/icon.png" }],
          }),
        });
      }
      return Promise.resolve({ status: 200 });
    });

    const result = await check.run(makeEndpoint("https://example.com", htmlBody), "example.com");

    expect(result.data.hasServiceWorker).toBe(true);
    expect(result.data.hasManifest).toBe(true);
    expect(result.data.manifestName).toBeNull();
    expect(result.data.installable).toBe(false);
  });

  it("uses short_name as fallback for name", async () => {
    const htmlBody = `
      <html>
        <link rel="manifest" href="/manifest.json">
        <script>navigator.serviceWorker.register('/sw.js');</script>
      </html>
    `;

    fetchSpy.mockImplementation((url: string) => {
      if (url.includes("manifest.json")) {
        return Promise.resolve({
          status: 200,
          json: async () => ({
            short_name: "App",
            start_url: "/",
            display: "standalone",
            icons: [{ src: "/icon.png" }],
          }),
        });
      }
      return Promise.resolve({ status: 200 });
    });

    const result = await check.run(makeEndpoint("https://example.com", htmlBody), "example.com");

    expect(result.data.manifestName).toBe("App");
    expect(result.data.installable).toBe(true);
  });

  it("requires start_url for installability", async () => {
    const htmlBody = `
      <html>
        <link rel="manifest" href="/manifest.json">
        <script>navigator.serviceWorker.register('/sw.js');</script>
      </html>
    `;

    fetchSpy.mockImplementation((url: string) => {
      if (url.includes("manifest.json")) {
        return Promise.resolve({
          status: 200,
          json: async () => ({
            name: "App",
            display: "standalone",
            icons: [{ src: "/icon.png" }],
          }),
        });
      }
      return Promise.resolve({ status: 200 });
    });

    const result = await check.run(makeEndpoint("https://example.com", htmlBody), "example.com");

    expect(result.data.manifestStartUrl).toBeNull();
    expect(result.data.installable).toBe(false);
  });

  it("requires at least one icon for installability", async () => {
    const htmlBody = `
      <html>
        <link rel="manifest" href="/manifest.json">
        <script>navigator.serviceWorker.register('/sw.js');</script>
      </html>
    `;

    fetchSpy.mockImplementation((url: string) => {
      if (url.includes("manifest.json")) {
        return Promise.resolve({
          status: 200,
          json: async () => ({
            name: "App",
            start_url: "/",
            display: "standalone",
            icons: [],
          }),
        });
      }
      return Promise.resolve({ status: 200 });
    });

    const result = await check.run(makeEndpoint("https://example.com", htmlBody), "example.com");

    expect(result.data.manifestIcons).toBe(0);
    expect(result.data.installable).toBe(false);
  });

  it("requires display=standalone or fullscreen for installability", async () => {
    const htmlBody = `
      <html>
        <link rel="manifest" href="/manifest.json">
        <script>navigator.serviceWorker.register('/sw.js');</script>
      </html>
    `;

    fetchSpy.mockImplementation((url: string) => {
      if (url.includes("manifest.json")) {
        return Promise.resolve({
          status: 200,
          json: async () => ({
            name: "App",
            start_url: "/",
            display: "browser",
            icons: [{ src: "/icon.png" }],
          }),
        });
      }
      return Promise.resolve({ status: 200 });
    });

    const result = await check.run(makeEndpoint("https://example.com", htmlBody), "example.com");

    expect(result.data.manifestDisplay).toBe("browser");
    expect(result.data.installable).toBe(false);
  });

  it("probes common service worker paths", async () => {
    fetchSpy.mockImplementation((url: string, options?: Record<string, unknown>) => {
      // Track method
      const method = (options?.method as string) || "GET";
      if (method === "HEAD" && url.includes("sw.js")) {
        return Promise.resolve({ status: 200 });
      }
      return Promise.resolve({ status: 404 });
    });

    const result = await check.run(
      makeEndpoint("https://example.com", "<html></html>"),
      "example.com",
    );

    expect(result.data.hasServiceWorker).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("sw.js"),
      expect.objectContaining({ method: "HEAD" }),
    );
  });

  it("falls back to manifest.json if href is not specified", async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes("manifest.json")) {
        return Promise.resolve({
          status: 200,
          json: async () => ({
            name: "App",
            start_url: "/",
            display: "standalone",
            icons: [{ src: "/icon.png" }],
          }),
        });
      }
      return Promise.resolve({ status: 404 });
    });

    const result = await check.run(
      makeEndpoint("https://example.com", "<html></html>"),
      "example.com",
    );

    expect(result.data.hasManifest).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/manifest.json", expect.any(Object));
  });

  it("resolves relative manifest URLs correctly", async () => {
    const htmlBody =
      '<html><link rel="manifest" href="./manifest.json"></html>';

    fetchSpy.mockImplementation((url: string) => {
      if (url === "https://example.com/manifest.json") {
        return Promise.resolve({
          status: 200,
          json: async () => ({
            name: "App",
            start_url: "/",
            display: "standalone",
            icons: [{ src: "/icon.png" }],
          }),
        });
      }
      return Promise.resolve({ status: 404 });
    });

    const result = await check.run(
      makeEndpoint("https://example.com/page", htmlBody),
      "example.com",
    );

    expect(result.data.hasManifest).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/manifest.json", expect.any(Object));
  });

  it("handles fetch timeouts gracefully", async () => {
    const htmlBody = `
      <html>
        <link rel="manifest" href="/manifest.json">
        <script>navigator.serviceWorker.register('/sw.js');</script>
      </html>
    `;

    fetchSpy.mockImplementation((url: string) => {
      // For manifest requests, abort immediately
      return Promise.reject(new Error("Abort"));
    });

    const result = await check.run(makeEndpoint("https://example.com", htmlBody), "example.com");

    // Should detect sw registration in HTML even if probes fail
    expect(result.data.swRegistrationInHtml).toBe(true);
    expect(result.data.hasManifest).toBe(false);
  });
});
