import { describe, it, expect, vi, afterEach } from "vitest";
import { GreenHostingCheck } from "./green-hosting.js";
import type { EndpointData } from "../types.js";
import { stubFetch } from "../testing/fetch-stub.js";

const endpoint: EndpointData = {
  url: "https://example.com",
  finalUrl: "https://example.com",
  statusCode: 200,
  headers: {},
  setCookies: [],
  body: "",
  redirectChain: [],
};

const API = "https://api.thegreenwebfoundation.org/api/v3/greencheck/example.com";

// Real response shapes from the greencheck API (Sep 2026).
const GREEN = {
  url: "example.com",
  hosted_by: "Cloudflare",
  hosted_by_website: "https://www.cloudflare.com",
  listed_provider: true,
  partner: null,
  green: true,
  hosted_by_id: 779,
  modified: "2026-04-27T18:33:55",
  supporting_documents: [
    {
      id: 18,
      title: "Blog post - The Climate and Cloudflare",
      link: "https://blog.cloudflare.com/the-climate-and-cloudflare/",
    },
    {
      id: 1264,
      title: "Cloudflare 2023 Emissions Inventory",
      link: "https://media.greenweb.org/uploads/Cloudflare_2023_Emissions_Inventory.pdf",
    },
  ],
};
const GREY = { green: false, url: "example.com", data: false, modified: "2026-09-27T22:22:05" };

describe("GreenHostingCheck", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const check = new GreenHostingCheck();

  it("has name 'green-hosting'", () => {
    expect(check.name).toBe("green-hosting");
  });

  it("reports a green host", async () => {
    stubFetch({ [API]: { body: JSON.stringify(GREEN) } });

    const { data } = await check.run(endpoint, "example.com");

    expect(data).toEqual({
      available: true,
      green: true,
      hostedBy: "Cloudflare",
      hostedByWebsite: "https://www.cloudflare.com",
      supportingDocuments: 2,
      error: null,
    });
  });

  it("reports a host that isn't known to be green", async () => {
    stubFetch({ [API]: { body: JSON.stringify(GREY) } });

    const { data } = await check.run(endpoint, "example.com");

    expect(data).toEqual({
      available: true,
      green: false,
      hostedBy: null,
      hostedByWebsite: null,
      supportingDocuments: 0,
      error: null,
    });
  });

  it("treats an HTTP error as unavailable, not as grey hosting", async () => {
    stubFetch({ [API]: { status: 503, body: "Service Unavailable" } });

    const { data } = await check.run(endpoint, "example.com");

    expect(data.available).toBe(false);
    expect(data.green).toBeNull();
    expect(data.error).toBe("Green Web Foundation API returned HTTP 503");
  });

  it("treats a network failure as unavailable", async () => {
    stubFetch({});

    const { data } = await check.run(endpoint, "example.com");

    expect(data.available).toBe(false);
    expect(data.green).toBeNull();
    expect(data.error).toBe("fetch failed");
  });

  it("treats an unexpected body as unavailable", async () => {
    stubFetch({ [API]: { body: JSON.stringify({ detail: "Not found" }) } });

    const { data } = await check.run(endpoint, "example.com");

    expect(data.available).toBe(false);
    expect(data.green).toBeNull();
  });

  it("passes the check's signal to fetch", async () => {
    const spy = vi.fn(
      async (_url: string, _init: RequestInit) => new Response(JSON.stringify(GREY)),
    );
    vi.stubGlobal("fetch", spy);
    const controller = new AbortController();

    await check.run(endpoint, "example.com", { timeoutMs: 1000, signal: controller.signal });
    const init = spy.mock.calls[0][1];
    controller.abort();

    expect(init.signal?.aborted).toBe(true);
  });
});
