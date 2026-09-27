import type { APIRoute } from "astro";
import { availableChecks } from "site-inspector";
import { publicMode } from "../../lib/network";
import { createOpenApiSpec, publicOrigin } from "../../lib/apiSpec";

export const prerender = false;

export const GET: APIRoute = ({ request }) => {
  const checks = publicMode() ? availableChecks({ heavy: false }) : availableChecks();
  return new Response(JSON.stringify(createOpenApiSpec(publicOrigin(request), checks)), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
};
