import { defineMiddleware } from "astro:middleware";
import { isLoopbackClient, publicMode } from "./lib/network";

const FORBIDDEN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><title>Local only · Site Inspector</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem}
code{font-family:ui-monospace,Menlo,monospace;font-size:.9em}</style></head>
<body><h1>Local only</h1><p>Site Inspector's web app only serves this machine.
To serve other clients, set <code>SITE_INSPECTOR_PUBLIC=1</code>.</p></body></html>`;

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
    return new Response(FORBIDDEN_PAGE, {
      status: 403,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  return next();
});
