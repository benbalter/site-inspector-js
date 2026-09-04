# Site Inspector — web front end

A lightweight, locally-run web UI for the
[`site-inspector`](../) engine, built with [Astro](https://astro.build) and
[Tailwind CSS](https://tailwindcss.com). Type a domain, get its technology,
security, and capability report rendered as grouped cards.

Every graded field carries a verdict — **pass** (green), **needs attention**
(red), or **neutral** (a fact, shown monochrome and never colored). A summary
bar reports how many items need attention, and a **"Only issues"** toggle filters
the whole report down to just those — like the abnormal-results view on a lab
report. The verdicts are **not** decided here: they come from the library's
shared `assess()` (imported via the dependency-free `site-inspector/assess`
subpath), so the web UI and the CLI (`--only-issues`) always agree.

The aesthetic is a "forensic instrument" direction: IBM Plex Sans + Plex Mono
(bundled locally via Fontsource), a faint blueprint grid, and precise hairline
cards with monospaced technical readouts.

It runs in **Node SSR** because the engine spawns headless Chrome (via
Lighthouse) and uses other Node-only dependencies — it is not a static site and
is meant to run on your machine.

## Running locally

The web app consumes `site-inspector` as a local dependency (`file:..`), so the
engine must be built first:

```bash
# from the repo root — builds dist/ that the web app imports
npm install
npm run build

# then start the web app
cd web
npm install
npm run dev
```

Open the URL Astro prints (http://localhost:4321 by default) and inspect a
domain such as `example.com`.

## How it works

- `src/pages/index.astro` — the domain form. It computes the **fast** check set
  (all checks except the slow, Chrome-launching ones) on the server and embeds
  it. A small vanilla-JS `<script>` POSTs to the API, shows a loading state, and
  renders the result. No client framework.
- `src/pages/api/inspect.ts` — a POST endpoint that validates input, calls
  `inspect(domain, { checks, timeout })`, and returns the `InspectionResult` as
  JSON.
- `src/lib/render.ts` — framework-free renderer that turns the result JSON into
  DOM: a domain-property summary strip, grouped check sections, and a graceful
  "site appears to be down" state.
- `src/lib/checkGroups.ts` — the UI-only taxonomy (grouping + labels). This
  grouping is defined here, not in the engine.

### Fast vs. heavy checks

By default the app runs the fast HTTP/DNS/header/security/content checks (a few
seconds). The **Advanced** section exposes opt-in checkboxes for the slow checks
that launch headless Chrome:

- `lighthouse` — Lighthouse performance/SEO/accessibility scores
- `a11y-axe` — automated accessibility testing via axe-core

Enabling these can push a run to 30–60 seconds.

## Building for production

```bash
cd web
npm run build      # SSR build using the @astrojs/node standalone adapter
npm run preview    # serve the built app
```

## Notes

- `astro.config.mjs` externalizes `site-inspector` for SSR (`vite.ssr.external`)
  so Node loads it natively from `node_modules` rather than letting Vite bundle
  Lighthouse/Chrome. It also uses the passthrough image service (no `sharp`
  needed, since the UI has no images).
- Requires Node.js 20+.
