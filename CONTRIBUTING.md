# Contributing

## Setup

Requires Node.js 22.19 or later (see `.nvmrc`).

```bash
npm install
npm run build
npm test
```

Before opening a pull request, run what CI runs:

```bash
npm run format:check && npm run lint && npm run typecheck && npm run build && npm test
```

If you touched `web/`, also run `npm run check && npm test && npm run build` there.

## Fixing a bug

Write a test that fails first, then fix it. Prefer the real library or the real response shape over an invented mock. Several past bugs hid behind mocks that didn't match what the library or API actually returns.

## Adding a check

1. Create `src/checks/{name}.ts` with a class that implements `Check`. Set `heavy = true` if it launches Chrome or jsdom, and load heavy dependencies inside `run()` rather than at import.
2. Add `src/checks/{name}.test.ts`.
3. Register it in `ALL_CHECKS` in `src/checks/index.ts`, and update
   `src/checks/index.test.ts`.
4. Decide what's good or bad in `src/assess.ts` (`POLARITY` for booleans,
   `VALUE_RULES` for other values) and test it in `src/assess.test.ts`. Checks
   report facts; verdicts live here, never in the CLI or web UI.
5. Give it a group and label in `web/src/lib/checkGroups.ts`.
6. Document it in the README's Checks section.

Useful helpers in `src/utils.ts`: `parseHtml(endpoint)` (a shared, read-only cheerio document), `findTxtRecords()` (separates "no record" from "lookup failed"), and `fetchJson`/`probeUrl`/`safeFetch`, which all send `USER_AGENT` and time out.

## Updating technology fingerprints

```bash
./scripts/update-fingerprints.sh
```

This replaces `data/` with the latest from [enthec/webappanalyzer](https://github.com/enthec/webappanalyzer). Don't edit those files by hand.
