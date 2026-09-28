---
applyTo: "**"
---

# Site Inspector

A TypeScript CLI tool and library that inspects domains for technology, security, and capabilities, plus a local Astro web UI in `web/`.

## Tech Stack

- **Language:** TypeScript (strict mode, ESM)
- **Runtime:** Node.js ≥ 22.19
- **Module system:** ESM (`"type": "module"` in package.json, Node16 module resolution)
- **Test framework:** Vitest
- **Linter:** ESLint with typescript-eslint (strict config)
- **Formatter:** Prettier (double quotes, semicolons, trailing commas, 100 char width)
- **Build:** `tsc` (outputs to `dist/`)

## Architecture

The project follows a **Domain → Endpoint → Check → Assess** pipeline:

1. **Domain** (`src/domain.ts`) probes 4 endpoint variants (http/https × www/non-www), determines which are up, and identifies the canonical endpoint
2. **Endpoint** (`src/endpoint.ts`) fetches a URL, following redirects by hand so each hop is recorded, and caches the response (status, headers, `setCookies`, body, `finalUrl`, redirect chain, timing)
3. **Checks** (`src/checks/*.ts`) are independent modules that analyze the endpoint data and return structured facts
4. **Assess** (`src/assess.ts`) grades those facts: pass, needs attention, neutral, or not applicable

### Verdicts live in the library

Checks report facts; `src/assess.ts` decides what's good or bad (`POLARITY` for booleans, `VALUE_RULES` for other values, `CONTEXT_RULES` for verdicts that depend on other checks, `INSIGHT_RULES` for conclusions across checks). Front ends read verdicts with `severityOf(assessment, …)`, not `assessField`, so context applies. The CLI (`src/program.ts`) and web UI (`web/`) only render and filter those verdicts. Never hardcode a judgment, label list, or check list in a front end; add it to the library and import it (the web UI imports the dependency-free `site-inspector/assess` subpath).

### Check Interface

Every check implements the `Check` interface from `src/checks/check.ts`:

```typescript
interface Check {
  name: string;
  heavy?: boolean; // launches Chrome or jsdom
  run(endpoint: EndpointData, domain: string, ctx?: CheckContext): Promise<CheckResult>;
}
```

- `EndpointData` provides `url`, `finalUrl`, `statusCode`, `headers`, `setCookies`, `body`, `redirectChain`, and `responseTimeMs`. Resolve relative URLs against `finalUrl`.
- `CheckContext` carries the request `timeoutMs` and an `AbortSignal` that fires when the check exceeds its time budget; stop any work (kill processes, close windows) when it does
- `CheckResult` returns `{ name, data }` where `data` is a `Record<string, unknown>`
- Checks are registered in `src/checks/index.ts` in the `ALL_CHECKS` array
- Light checks run in parallel; heavy ones run one at a time afterwards. Each has a time budget (60s, or 180s if heavy)
- Parse HTML with `parseHtml(endpoint)` from `src/utils.ts` (cached per endpoint; read-only). Look up TXT records with `findTxtRecords()`, which separates "no record" from "lookup failed"
- Load heavy dependencies lazily inside `run()`, not at import

### Adding a New Check

1. Create `src/checks/{name}.ts` exporting a class that implements `Check` (set `heavy = true` if it launches Chrome or jsdom)
2. Create `src/checks/{name}.test.ts` with vitest tests
3. Import and register the class in `src/checks/index.ts` (add to `ALL_CHECKS` array)
4. Update the `src/checks/index.test.ts` registry tests (add vi.mock, update counts)
5. Grade its fields in `src/assess.ts` (`POLARITY` / `VALUE_RULES`) and cover them in `src/assess.test.ts`. Ungraded fields render as neutral facts
6. Add it to a category and give it a label in `src/categories.ts`
7. Update README.md with the check description

### CJS Libraries in ESM

Several dependencies are CJS-only (wappalyzer-core, robots-parser, csp_evaluator). Import them with:

```typescript
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const lib = require("package-name");
```

## Key Files

- `src/index.ts` — Public API: `inspect()` function and re-exports
- `src/cli.ts` — CLI entry point; `src/program.ts` — the commander program (testable)
- `src/assess.ts` — Verdicts, `PROPERTY_LABELS`, and `titleCase` (dependency-free; exported as `site-inspector/assess`)
- `src/types.ts` — All shared interfaces
- `src/utils.ts` — Fetch helpers, `parseHtml`, `findTxtRecords`, `USER_AGENT`
- `src/checks/index.ts` — Check registry: `runChecks()`, `availableChecks({ heavy })`
- `src/testing/fetch-stub.ts` — `stubFetch()` test helper (canned responses by URL)
- `web/` — Astro SSR front end; `web/src/lib/network.ts` holds its SSRF guards
- `data/` — Vendored Wappalyzer and subdomain-takeover fingerprints (do not edit manually; update via `scripts/update-fingerprints.sh` and `scripts/update-takeover-fingerprints.sh`)
- `src/network.ts` — `isPublicAddress` / `resolvePublic`: every raw TLS/TCP socket must connect to an address from `resolvePublic` (SSRF)

## Commands

- `npm test` — Run all tests with vitest
- `npm run build` — Compile TypeScript to `dist/`
- `npm run lint` — Lint with ESLint (`src/` and `web/src/`)
- `npm run typecheck` — Type-check everything, including tests
- `npm run format` — Format with Prettier
- `npm run format:check` — Check formatting
- `npm run test:coverage` — Run tests with v8 coverage
- In `web/`: `npm run dev`, `npm run check` (astro check), `npm test` (node:test), `npm run build`

## Testing Patterns

- Tests are co-located: `src/checks/foo.ts` → `src/checks/foo.test.ts`
- Mock external modules with `vi.mock("module-name", () => ({ ... }))`
- Stub global `fetch` with `stubFetch({ url: { status, headers, body, location } })` from `src/testing/fetch-stub.ts`, or `vi.stubGlobal("fetch", vi.fn(...))`
- Prefer the real library or the real API response shape over invented mocks; several past bugs hid behind mocks that didn't match reality
- Fix bugs test-first: write the failing test, then the fix
- Mock `node:dns/promises` and `node:tls` with `vi.mock`
- The registry test (`index.test.ts`) mocks every check module and uses `vi.resetModules()` + `vi.doMock()` for the error-handling test case
- Tests should cover: happy path, error/failure cases, edge cases, and output shape validation

## Code Style

- Use `double quotes`, semicolons, trailing commas
- Prefer `const` over `let`; never use `var`
- Use `.js` extensions in all relative imports (required by Node16 ESM resolution)
- Only add comments for non-obvious logic; don't comment the obvious
- Prefer open-source libraries over hand-rolled implementations
