applyTo: "**"
---

# Site Inspector

A TypeScript CLI tool and library that inspects domains for technology, security, and capabilities.

## Tech Stack

- **Language:** TypeScript (strict mode, ESM)
- **Runtime:** Node.js ≥ 20
- **Module system:** ESM (`"type": "module"` in package.json, Node16 module resolution)
- **Test framework:** Vitest
- **Linter:** ESLint with typescript-eslint (strict config)
- **Formatter:** Prettier (double quotes, semicolons, trailing commas, 100 char width)
- **Build:** `tsc` (outputs to `dist/`)

## Architecture

The project follows a **Domain → Endpoint → Check** pipeline:

1. **Domain** (`src/domain.ts`) probes 4 endpoint variants (http/https × www/non-www), determines which are up, and identifies the canonical endpoint
2. **Endpoint** (`src/endpoint.ts`) fetches a URL and caches the response (status, headers, body, redirect chain)
3. **Checks** (`src/checks/*.ts`) are independent modules that analyze the endpoint data and return structured results

### Check Interface

Every check implements the `Check` interface from `src/checks/check.ts`:

```typescript
interface Check {
  name: string;
  run(endpoint: EndpointData, domain: string): Promise<CheckResult>;
}
```

- `EndpointData` provides `url`, `statusCode`, `headers`, `body`, and `redirectChain`
- `CheckResult` returns `{ name, data }` where `data` is a `Record<string, unknown>`
- Checks are registered in `src/checks/index.ts` in the `ALL_CHECKS` array
- All checks run in parallel via `Promise.allSettled`

### Adding a New Check

1. Create `src/checks/{name}.ts` exporting a class that implements `Check`
2. Create `src/checks/{name}.test.ts` with vitest tests
3. Import and register the class in `src/checks/index.ts` (add to `ALL_CHECKS` array)
4. Update the `src/checks/index.test.ts` registry tests (add vi.mock, update counts)
5. Update README.md with the check description

### CJS Libraries in ESM

Several dependencies are CJS-only (wappalyzer-core, robots-parser, csp_evaluator). Import them with:

```typescript
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const lib = require("package-name");
```

## Key Files

- `src/index.ts` — Public API: `inspect()` function and type re-exports
- `src/cli.ts` — CLI entry point (commander + chalk)
- `src/types.ts` — All shared interfaces
- `src/checks/index.ts` — Check registry: `runChecks()`, `availableChecks()`
- `data/` — Vendored Wappalyzer fingerprints (do not edit manually; update via `scripts/update-fingerprints.sh`)

## Commands

- `npm test` — Run all tests with vitest
- `npm run build` — Compile TypeScript to `dist/`
- `npm run lint` — Lint with ESLint
- `npm run format` — Format with Prettier
- `npm run format:check` — Check formatting
- `npx tsc --noEmit` — Type-check without emitting
- `npm run test:coverage` — Run tests with v8 coverage

## Testing Patterns

- Tests are co-located: `src/checks/foo.ts` → `src/checks/foo.test.ts`
- Mock external modules with `vi.mock("module-name", () => ({ ... }))`
- Mock global `fetch` with `vi.stubGlobal("fetch", vi.fn(...))`
- Mock `node:dns/promises` and `node:tls` with `vi.mock`
- The registry test (`index.test.ts`) mocks every check module and uses `vi.resetModules()` + `vi.doMock()` for the error-handling test case
- Tests should cover: happy path, error/failure cases, edge cases, and output shape validation

## Code Style

- Use `double quotes`, semicolons, trailing commas
- Prefer `const` over `let`; never use `var`
- Use `.js` extensions in all relative imports (required by Node16 ESM resolution)
- Only add comments for non-obvious logic; don't comment the obvious
- Prefer open-source libraries over hand-rolled implementations
