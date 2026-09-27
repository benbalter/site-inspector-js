import { vi } from "vitest";

/** A canned response for {@link stubFetch}. */
export interface FakeResponse {
  status?: number;
  /** Shortcut for a redirect: sets status 301 and the Location header. */
  location?: string;
  headers?: Record<string, string> | [string, string][];
  body?: string;
}

/**
 * Replace global fetch with a router over canned responses, keyed by exact
 * URL. Unknown URLs fail like an unreachable host.
 */
export function stubFetch(routes: Record<string, FakeResponse>) {
  const spy = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const route = routes[url];
    if (!route) {
      throw new TypeError("fetch failed", { cause: new Error(`getaddrinfo ENOTFOUND ${url}`) });
    }
    const headers = new Headers(route.headers);
    if (route.location) headers.set("location", route.location);
    const status = route.status ?? (route.location ? 301 : 200);
    const body = status === 204 || status === 304 ? null : (route.body ?? "");
    return new Response(body, { status, headers });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}
