import { defineMiddleware } from "astro:middleware";
import { isLoopbackClient, publicMode } from "./lib/network";

// The app is meant to run on your own machine. Unless public mode is explicitly
// enabled, refuse requests that don't come from loopback, so binding to
// 0.0.0.0 by accident doesn't expose an open outbound-request endpoint.
export const onRequest = defineMiddleware((context, next) => {
  if (context.isPrerendered || publicMode()) return next();

  let client: string | undefined;
  try {
    client = context.clientAddress;
  } catch {
    // Adapter can't tell us — fail closed.
  }
  if (!isLoopbackClient(client)) {
    return new Response(
      "site-inspector web is local-only. Set SITE_INSPECTOR_PUBLIC=1 to serve other clients.",
      { status: 403 },
    );
  }
  return next();
});
