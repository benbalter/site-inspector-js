/**
 * Normalize a domain string: strip protocol, path, trailing slashes.
 */
export function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/\/.*$/, "");
  d = d.replace(/:\d+$/, "");
  return d;
}

/**
 * Fetch a URL with timeout support, returning simplified response data.
 */
export async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
): Promise<{
  ok: boolean;
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  redirected: boolean;
  finalUrl: string;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "site-inspector/0.1 (https://github.com/benbalter/site-inspector-js)",
      },
    });

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    const body = await response.text();

    return {
      ok: response.ok,
      statusCode: response.status,
      headers,
      body,
      redirected: response.redirected,
      finalUrl: response.url,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Try to fetch a URL, returning null on any error (timeout, DNS failure, etc.).
 */
export async function safeFetch(
  url: string,
  timeoutMs: number,
): Promise<Awaited<ReturnType<typeof fetchWithTimeout>> | null> {
  try {
    return await fetchWithTimeout(url, timeoutMs);
  } catch {
    return null;
  }
}

/** Fetch JSON from a URL with timeout, returning null on failure. */
export async function fetchJson(
  url: string,
  timeoutMs = 5000,
): Promise<Record<string, unknown> | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Probe a URL with a HEAD (or other method) request, returning true if status is 200. */
export async function probeUrl(
  url: string,
  method: string = "HEAD",
  timeoutMs = 5000,
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { method, signal: controller.signal, redirect: "follow" });
    clearTimeout(timer);
    return res.status === 200;
  } catch {
    return false;
  }
}
