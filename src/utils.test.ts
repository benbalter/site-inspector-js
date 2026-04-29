import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchJson, probeUrl } from "./utils.js";

describe("fetchJson", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed JSON on success", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ key: "value" }),
    });

    const result = await fetchJson("https://example.com/data.json");

    expect(result).toEqual({ key: "value" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/data.json",
      expect.objectContaining({ signal: expect.any(AbortSignal), redirect: "follow" }),
    );
  });

  it("returns null on non-ok response", async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 404 });

    const result = await fetchJson("https://example.com/missing.json");

    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    fetchSpy.mockRejectedValue(new Error("Network error"));

    const result = await fetchJson("https://example.com/fail.json");

    expect(result).toBeNull();
  });

  it("returns null on abort", async () => {
    fetchSpy.mockImplementation(() => {
      throw new DOMException("Aborted", "AbortError");
    });

    const result = await fetchJson("https://example.com/slow.json");

    expect(result).toBeNull();
  });

  it("passes custom timeout", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ data: true }),
    });

    const result = await fetchJson("https://example.com/data.json", 10000);

    expect(result).toEqual({ data: true });
  });
});

describe("probeUrl", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true when status is 200", async () => {
    fetchSpy.mockResolvedValue({ status: 200 });

    const result = await probeUrl("https://example.com/test");

    expect(result).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/test",
      expect.objectContaining({ method: "HEAD", signal: expect.any(AbortSignal), redirect: "follow" }),
    );
  });

  it("returns false when status is not 200", async () => {
    fetchSpy.mockResolvedValue({ status: 404 });

    const result = await probeUrl("https://example.com/missing");

    expect(result).toBe(false);
  });

  it("returns false on network error", async () => {
    fetchSpy.mockRejectedValue(new Error("Network error"));

    const result = await probeUrl("https://example.com/fail");

    expect(result).toBe(false);
  });

  it("uses custom method", async () => {
    fetchSpy.mockResolvedValue({ status: 200 });

    const result = await probeUrl("https://example.com/test", "GET");

    expect(result).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/test",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns false for 301 redirect status", async () => {
    fetchSpy.mockResolvedValue({ status: 301 });

    const result = await probeUrl("https://example.com/redir");

    expect(result).toBe(false);
  });

  it("returns false on abort", async () => {
    fetchSpy.mockImplementation(() => {
      throw new DOMException("Aborted", "AbortError");
    });

    const result = await probeUrl("https://example.com/slow");

    expect(result).toBe(false);
  });
});
