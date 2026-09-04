import type { APIRoute } from "astro";
import { inspect, availableChecks } from "site-inspector";

export const prerender = false;

interface InspectBody {
  domain?: unknown;
  checks?: unknown;
  timeout?: unknown;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  let body: InspectBody;
  try {
    body = (await request.json()) as InspectBody;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const domain = typeof body.domain === "string" ? body.domain.trim() : "";
  if (!domain) {
    return json({ error: "A domain is required." }, 400);
  }

  // Validate requested checks against the engine's actual registry.
  const valid = availableChecks();
  let checks: string[] | undefined;
  if (Array.isArray(body.checks)) {
    checks = body.checks.filter((c): c is string => typeof c === "string");
    const invalid = checks.filter((c) => !valid.includes(c));
    if (invalid.length > 0) {
      return json({ error: `Unknown checks: ${invalid.join(", ")}` }, 400);
    }
  }

  const timeout =
    typeof body.timeout === "number" && body.timeout > 0 ? body.timeout : 15_000;

  try {
    const result = await inspect(domain, { checks, timeout });
    return json(result);
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
};
