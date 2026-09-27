import type { APIRoute } from "astro";
import { inspect, availableChecks } from "site-inspector";
import {
  installFetchGuard,
  isValidHostname,
  publicMode,
  resolvesToPublicAddresses,
} from "../../lib/network";
import { acquireInspectionSlot, admitInspection } from "../../lib/rateLimit";
import { defaultChecks } from "../../lib/apiSpec";
import { NDJSON, encodeEvent, type StreamEvent } from "../../lib/stream";

export const prerender = false;

installFetchGuard();

const DEFAULT_TIMEOUT = 15_000;
const MIN_TIMEOUT = 1_000;
const MAX_TIMEOUT = 30_000;
const MAX_BODY_BYTES = 16 * 1024;

// Heavy checks launch headless Chrome or jsdom; run at most one such job at a time.
let heavyJobRunning = false;

interface InspectBody {
  domain?: unknown;
  checks?: unknown;
  timeout?: unknown;
}

class RequestBodyTooLargeError extends Error {}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function readRequestBody(request: Request): Promise<InspectBody> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Request body is required.");

  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RequestBodyTooLargeError();
    }
    chunks.push(value);
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object.");
  }
  return parsed as InspectBody;
}

/** Reduce user input like "https://Example.com/path" to a bare lowercase hostname. */
function toHostname(input: string): string {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `http://${input}`;
  try {
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export const POST: APIRoute = async ({ request }) => {
  let body: InspectBody;
  try {
    body = await readRequestBody(request);
  } catch (err) {
    return json(
      {
        error:
          err instanceof RequestBodyTooLargeError
            ? "Request body is too large."
            : "Invalid JSON body.",
      },
      400,
    );
  }

  const raw = typeof body.domain === "string" ? body.domain.trim() : "";
  if (!raw) {
    return json({ error: "A domain is required." }, 400);
  }
  const unsupportedFields = Object.keys(body).filter(
    (key) => !["domain", "checks", "timeout"].includes(key),
  );
  if (unsupportedFields.length > 0) {
    return json({ error: `Unknown fields: ${unsupportedFields.join(", ")}` }, 400);
  }
  const domain = toHostname(raw);
  if (!isValidHostname(domain)) {
    return json({ error: "Enter a public domain name, like example.com." }, 400);
  }

  if (publicMode()) {
    const admission = admitInspection();
    if (!admission.allowed) {
      return new Response(JSON.stringify({ error: "Too many requests. Try again shortly." }), {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": String(admission.retryAfterSeconds),
        },
      });
    }
  }

  if (!(await resolvesToPublicAddresses(domain))) {
    return json({ error: "That domain resolves to a private or reserved address." }, 400);
  }

  // Validate requested checks against the engine's actual registry.
  const valid = availableChecks();
  const fastChecks = availableChecks({ heavy: false });
  let checks: string[] | undefined;
  if (body.checks !== undefined) {
    if (!Array.isArray(body.checks)) {
      return json({ error: "checks must be an array of check names." }, 400);
    }
    const requestedChecks = body.checks.filter(
      (check): check is string => typeof check === "string",
    );
    if (requestedChecks.length !== body.checks.length) {
      return json({ error: "checks must contain only check names as strings." }, 400);
    }
    checks = requestedChecks;
    if (checks.length === 0) {
      return json({ error: "Select at least one check." }, 400);
    }
    const invalid = checks.filter((c) => !valid.includes(c));
    if (invalid.length > 0) {
      return json({ error: `Unknown checks: ${invalid.join(", ")}` }, 400);
    }
  }

  // Heavy checks drive a browser/jsdom that bypasses the fetch guard, so they
  // are only available when the app is running locally.
  const selectedChecks = defaultChecks(checks, publicMode(), fastChecks);
  const heavyChecks = availableChecks({ heavy: true });
  const heavy = (selectedChecks ?? valid).filter((c) => heavyChecks.includes(c));
  if (heavy.length > 0 && publicMode()) {
    return json({ error: `Unavailable in public mode: ${heavy.join(", ")}` }, 400);
  }
  if (heavy.length > 0 && heavyJobRunning) {
    return json({ error: "A slow inspection is already running. Try again shortly." }, 429);
  }

  const releaseSlot = publicMode() ? acquireInspectionSlot() : null;
  if (publicMode() && !releaseSlot) {
    return json({ error: "The inspection service is busy. Try again shortly." }, 429);
  }

  if (
    body.timeout !== undefined &&
    (typeof body.timeout !== "number" ||
      !Number.isFinite(body.timeout) ||
      !Number.isInteger(body.timeout))
  ) {
    return json({ error: "timeout must be an integer number of milliseconds." }, 400);
  }
  const timeout =
    typeof body.timeout === "number"
      ? Math.min(MAX_TIMEOUT, Math.max(MIN_TIMEOUT, body.timeout))
      : DEFAULT_TIMEOUT;

  if (heavy.length > 0) heavyJobRunning = true;
  const release = () => {
    releaseSlot?.();
    if (heavy.length > 0) heavyJobRunning = false;
  };

  // Clients that accept NDJSON get live progress, then the result.
  if (request.headers.get("accept")?.includes(NDJSON)) {
    return streamInspection(domain, { checks: selectedChecks, timeout }, release);
  }

  try {
    const result = await inspect(domain, { checks: selectedChecks, timeout });
    return json(result);
  } catch (err) {
    return json({ error: errorMessage(err) }, 500);
  } finally {
    release();
  }
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Run the inspection, streaming progress events and then the result as NDJSON. */
function streamInspection(
  domain: string,
  options: { checks?: string[]; timeout: number },
  release: () => void,
): Response {
  const encoder = new TextEncoder();
  let open = true;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        if (open) controller.enqueue(encoder.encode(encodeEvent(event)));
      };
      try {
        const result = await inspect(domain, {
          ...options,
          onProgress: (e) => {
            if (e.type === "resolved") {
              send({
                type: "resolved",
                domain: e.domain,
                properties: e.properties,
                checks: e.checks,
              });
            } else if (e.type === "check-start") {
              send(e);
            } else {
              // The full results arrive with the final event; skip them here.
              send({ type: "check-done", check: e.check, completed: e.completed, total: e.total });
            }
          },
        });
        send({ type: "result", result });
      } catch (err) {
        send({ type: "error", error: errorMessage(err) });
      } finally {
        release();
        if (open) controller.close();
        open = false;
      }
    },
    cancel() {
      // The client went away; stop writing. The inspection finishes on its own.
      open = false;
    },
  });

  return new Response(stream, {
    headers: { "content-type": NDJSON, "cache-control": "no-store" },
  });
}
