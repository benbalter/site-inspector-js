# Site Inspector — web front end

A lightweight, locally-run web UI for the [`site-inspector`](../) engine, built with [Astro](https://astro.build) and [Tailwind CSS](https://tailwindcss.com). Type a domain, get its technology, security, and capability report rendered as grouped cards.

Every graded field carries a verdict — **pass** (green), **needs attention** (red), or **neutral** (a fact, shown monochrome and never colored). A summary bar reports how many items need attention, and a **"Only issues"** toggle filters the whole report down to just those — like the abnormal-results view on a lab report. The verdicts are **not** decided here: they come from the library's shared `assess()` (imported via the dependency-free `site-inspector/assess` subpath), so the web UI and the CLI (`--only-issues`) always agree.

The aesthetic is a "forensic instrument" direction: IBM Plex Sans + Plex Mono (bundled locally via Fontsource), a faint blueprint grid, and precise hairline cards with monospaced technical readouts.

It runs in **Node SSR** because the engine uses Node-only networking and dependencies; optional checks can also spawn headless Chrome via Lighthouse. It is not a static site, but can be deployed as a Node web service.

## Running locally

The web app consumes `site-inspector` as a local dependency (`file:..`), so the engine must be built first:

```bash
# from the repo root — builds dist/ that the web app imports
npm install
npm run build

# then start the web app
cd web
npm install
npm run dev
```

Open the URL Astro prints (http://localhost:4321 by default) and inspect a domain such as `example.com`.

## How it works

- `src/pages/index.astro` — the domain form. It computes the **fast** check set
  (all checks except the slow, Chrome-launching ones) on the server and embeds
  it. A small vanilla-JS `<script>` POSTs to the API, shows a loading state, and
  renders the result. No client framework.
- `src/pages/api/inspect.ts` — a POST endpoint that validates input, calls
  `inspect(domain, { checks, timeout })`, and returns the `InspectionResult` as
  JSON. With `Accept: application/x-ndjson` it streams progress instead: a
  `resolved` event, `check-start`/`check-done` for each check, then a `result`
  (or `error`) event. The page uses this to show a live progress bar and which
  checks are still running. `src/lib/stream.ts` holds the event types and reader.
- `src/lib/render.ts` — framework-free renderer that turns the result JSON into
  DOM: a domain-property summary strip, grouped check sections, and a graceful
  "site appears to be down" state.
- `src/lib/checkGroups.ts` — the UI-only taxonomy (grouping + labels). This
  grouping is defined here, not in the engine.
- `src/lib/network.ts` and `src/middleware.ts` — the SSRF guards described
  under [Security](#security).
- `src/pages/api/openapi.json.ts` — an OpenAPI 3.1 document for machine clients
  and LLM tool integrations. Its check-name enum is generated from the active
  registry; in public mode it only advertises fast checks.

## JSON API for tools and LLMs

`POST /api/inspect` accepts a JSON object and returns an `InspectionResult` as JSON. The OpenAPI 3.1 description is available at `/api/openapi.json` and can be used to configure an HTTP-capable agent or LLM tool. The endpoint is unauthenticated and accepts public DNS hostnames only.

```sh
curl https://site-inspector.balter.dev/api/inspect \
  -H 'content-type: application/json' \
  -H 'accept: application/json' \
  -d '{"domain":"example.com","checks":["headers","https","csp"]}'
```

The `domain` field is required. `checks` is optional; when omitted on a public deployment, the API runs all fast checks. Provide a smaller subset when a concise response is preferable. `timeout` is optional and clamped to 1–30 seconds. The response contains domain properties and structured facts keyed by check name; check-level failures appear in `checks[name].data.error`.

Public deployments reject heavy Chrome/jsdom checks, cap request bodies at 16 KiB, and enforce process-local request and concurrency limits. These are best-effort safeguards for a demo service, not API-key quotas or durable per-client rate limits. A request over the rate limit returns `429` and a `Retry-After` header. Do not send credentials or private URLs as inspection targets.

### Fast vs. heavy checks

By default the app runs the fast HTTP/DNS/header/security/content checks (a few seconds). The **Advanced** section exposes opt-in checkboxes for the slow checks that launch headless Chrome:

- `lighthouse` — Lighthouse performance/SEO/accessibility scores
- `a11y-axe` — automated accessibility testing via axe-core

Enabling these can push a run to 30–60 seconds. Only one heavy run is allowed at a time.

## Security

The API makes outbound requests to whatever domain it's given, so it guards against being used to reach internal hosts (SSRF):

- **Local-only by default.** `src/middleware.ts` rejects requests that don't
  come from loopback, so binding to `0.0.0.0` by accident doesn't expose the
  API. Set `SITE_INSPECTOR_PUBLIC=1` to serve other clients.
- **Input validation.** The domain must be a public DNS name (no IP literals or
  single-label hosts), and its resolved addresses must all be public. The
  timeout is clamped to 1–30 seconds.
- **Connect-time address check.** `src/lib/network.ts` installs a global
  `fetch` dispatcher that refuses to connect to loopback, private, link-local,
  CGNAT, or other reserved addresses. It applies to every redirect hop and
  isn't fooled by DNS rebinding.
- **No heavy checks in public mode.** Lighthouse drives Chrome, and axe runs in
  jsdom, both outside the fetch guard, so they're disabled when
  `SITE_INSPECTOR_PUBLIC=1`.

## Building for production

```bash
cd web
npm run build      # SSR build using the @astrojs/node standalone adapter
npm run preview    # serve the built app
npm run check      # astro check (type-check .astro and .ts files)
npm test           # unit tests (node:test)
```

## Deploying to Render

The repository includes a root-level `render.yaml` Blueprint for deploying the web app as a Render Node web service. In Render, create a Blueprint instance from the repository and select the free plan. The build installs and builds the library first, then installs the web app from its lockfile and builds Astro. The start command runs Astro's standalone Node server; the adapter reads Render's `PORT` and binds to `0.0.0.0`.

The Blueprint sets `SITE_INSPECTOR_PUBLIC=1`, which makes the service publicly reachable. Heavy Chrome/jsdom checks remain disabled in public mode. The API also limits request bodies to 16 KiB, admits up to 30 inspection requests per minute, and runs at most three inspections concurrently **per process**. These in-memory limits reset on restart and are not shared across instances; they are basic safeguards for a low-volume demo, not durable abuse prevention. Do not enable public mode for a production service without an external rate limiter, monitoring, and a review of Render's current policies for outbound inspection traffic.

Render Free services sleep after inactivity and may take about a minute to wake. Render describes free instances as unsuitable for production and may suspend services that initiate unusually high outbound traffic. The app's local workflow remains unchanged; omit `SITE_INSPECTOR_PUBLIC=1` to keep it loopback-only.

## Notes

- `astro.config.mjs` externalizes `site-inspector` for SSR (`vite.ssr.external`) so Node loads it natively from `node_modules` rather than letting Vite bundle Lighthouse/Chrome. It also uses the passthrough image service (no `sharp` needed, since the UI has no images).
- Requires Node.js 22.19+.
