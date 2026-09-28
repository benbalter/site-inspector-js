# Site Inspector

A modern TypeScript tool to inspect a domain's technology, security, and capabilities. Use it from the command line or import it as a library. Inspired by [benbalter/site-inspector](https://github.com/benbalter/site-inspector).

## Features

- **53 built-in checks** covering security, SEO, performance, accessibility, and technology detection
- **CLI and library** — use from the terminal or `import` as an ES module
- **TypeScript-first** — strict mode, full type definitions, ESM
- **Open-source powered** — leverages best-in-class libraries like [wappalyzer-core](https://www.npmjs.com/package/wappalyzer-core), [ssl-checker](https://www.npmjs.com/package/ssl-checker), [csp_evaluator](https://www.npmjs.com/package/csp_evaluator), [Lighthouse](https://github.com/GoogleChrome/lighthouse), and more
- **Fast** — all checks run concurrently via `Promise.allSettled`

## Installation

```bash
npm install site-inspector
```

Or run directly with npx:

```bash
npx site-inspector inspect example.com
```

Requires **Node.js ≥ 22.19**. The optional Lighthouse check requires Google Chrome.

## Running Locally (from source)

To run from a clone of this repository — before it's published, or while developing — build the TypeScript first, then invoke the compiled CLI:

```bash
git clone https://github.com/benbalter/site-inspector-js.git
cd site-inspector-js
npm install          # Install dependencies
npm run build        # Compile TypeScript to dist/

# Run the CLI directly
node dist/cli.js inspect example.com
```

The `site-inspector` command isn't on your `PATH` after a build alone. To make it globally available from your clone, symlink it with `npm link`:

```bash
npm link                              # Links dist/cli.js into your global bin
site-inspector inspect example.com    # Now works anywhere
npm unlink -g site-inspector          # Undo when done
```

Since the `site-inspector` bin points at `dist/`, rebuild after changing source (`npm run build`), or run `npm run dev` to recompile on save.

## CLI Usage

```bash
# Inspect a domain (colorized terminal output)
site-inspector inspect example.com

# JSON output (pipe to jq, save to file, etc.)
site-inspector inspect example.com --json

# Run only specific checks
site-inspector inspect example.com --checks dns,headers,https,csp

# Show only what needs attention (like a lab report's abnormal-results view)
site-inspector inspect example.com --only-issues

# Show all 4 endpoint variants (http/https × www/non-www)
site-inspector inspect example.com --all-endpoints

# Custom timeout (milliseconds)
site-inspector inspect example.com --timeout 15000

# Fail (exit 1) if anything needs attention — handy in CI
site-inspector inspect example.com --fail-on-issues

# List all available checks
site-inspector checks
```

With `--json`, the output includes an `assessment` with the items that need
attention; add `--only-issues` to output just those.

Exit status: `0` on success, `1` on bad input or an error (or when
`--fail-on-issues` finds something), and `2` when the domain doesn't respond on
any endpoint.

## Library Usage

```typescript
import { inspect } from "site-inspector";

const result = await inspect("example.com");

// Domain properties
console.log(result.properties.https);         // true
console.log(result.properties.enforcesHttps); // true
console.log(result.properties.canonicallyWww); // false

// Check results
console.log(result.checks.dns.data.ipv6);                 // true
console.log(result.checks.headers.data.server);            // "nginx"
console.log(result.checks.https.data.valid);               // true
console.log(result.checks.hsts.data.preloadReady);         // true
console.log(result.checks.sniffer.data.technologies);      // [{ name: "WordPress", ... }]
console.log(result.checks.csp.data.highSeverityCount);     // 0
console.log(result.checks["dns-security"].data.dmarc.policy); // "reject"

// Run only specific checks with a custom timeout
const partial = await inspect("example.com", {
  checks: ["dns", "headers", "https"],
  timeout: 5000,
});
```

### Assessment (what's good / what needs attention)

The raw `data` is the readout; `assess()` layers the engine's opinion on top —
a per-field verdict of `pass`, `attention`, `neutral`, or `not-applicable`.
Verdicts come from a curated table (never guessed from field names), so a
`neutral` fact like "no IPv6" or "no tracker present" is never mistaken for a
failing. This is the single source of truth shared by the CLI (`--only-issues`)
and the web UI.

Verdicts also take the rest of the result into account:

- **Applicability:** findings that can't apply are `not-applicable`, such as HSTS
  on a site without HTTPS, cookie flags when no cookies are set, or MTA-STS for
  a domain with no (or a null) MX record. If the prerequisite is unknown, say
  because the DNS check failed, the verdict is left alone.
- **One signal, one count:** a signal reported by two checks (the viewport, for
  example) is graded once; `DUPLICATE_OF` names the owner.
- **Insights:** conclusions that span fields or checks, like "email from this
  domain can be spoofed" (SPF plus DMARC) or "HSTS preload requested but
  blocked". Each lists the fields it rests on in `because`, and those that need
  attention count toward `attentionCount`.

```typescript
import { inspect, assess, assessField, severityOf } from "site-inspector";

const result = await inspect("example.com");
const assessment = assess(result);
const { attentionCount, attention, insights } = assessment;

console.log(`${attentionCount} items need attention`);
for (const insight of insights) console.log(`- ${insight.title}`);
for (const finding of attention) {
  console.log(`- ${finding.check}: ${finding.label}`);
}

// A field's verdict in context (e.g. "not-applicable" without HTTPS)
severityOf(assessment, "hsts", "enabled", false);

// Context-free verdict for a single field
assessField("hsts", "enabled", false);          // "attention"
assessField("ipv6", "hasIpv6", false);           // "neutral" (absence isn't bad)
assessField("mixed-content", "hasMixedContent", true); // "attention"
```

### Exports

```typescript
import {
  inspect,           // Main inspection function
  availableChecks,   // List check names; { heavy: true/false } filters by speed
  runChecks,         // Run checks against EndpointData you already have
  assess,            // Verdicts + "needs attention" rollup for a result
  assessField,       // Context-free verdict for a single field
  severityOf,        // A field's verdict in the context of an assessment
  CHECK_CATEGORIES,  // Checks grouped into display categories
  checkLabel,        // "dns-security" -> "SPF & DMARC"
  PROPERTY_LABELS,   // Display labels for the domain properties
  titleCase,         // "dns-security" -> "Dns Security"
  Domain,            // Domain class (4-endpoint probing)
  Endpoint,          // Single endpoint class
  normalizeDomain,   // "https://www.Example.com/x" -> "example.com"
  USER_AGENT,        // The User-Agent sent with every request
} from "site-inspector";

// The assessment logic is also available on its own dependency-free subpath,
// handy for client bundles that shouldn't pull in the full engine:
import { assess, assessField, PROPERTY_LABELS, titleCase } from "site-inspector/assess";

// Types
import type {
  InspectOptions,
  InspectionResult,
  CheckResult,
  EndpointData,
  EndpointInfo,
  DomainProperties,
  Check,             // Interface for writing your own checks
  CheckContext,      // { timeoutMs, signal } passed to each check
  Severity,          // "pass" | "attention" | "neutral" | "not-applicable"
  Finding,
  Insight,           // A conclusion drawn across fields or checks
  Assessment,
} from "site-inspector";
```

## Checks

Site Inspector runs 53 checks in 8 categories (the same grouping the web UI uses, from `CHECK_CATEGORIES`). Checks run in parallel and return structured data; `lighthouse` and `a11y-axe` are heavy and opt-in.

### 🔒 Transport Security

| Check | Description | Library / source |
|-------|-------------|---------|
| **https** | TLS certificate validity, issuer, expiry, protocol, cipher, chain completeness | [ssl-checker](https://www.npmjs.com/package/ssl-checker) |
| **tls-versions** | TLS version support testing — TLS 1.0, 1.1, 1.2, 1.3 handshake verification | — |
| **tls-ciphers** | Weak TLS 1.2 cipher suites the server accepts (static RSA without forward secrecy, CBC, 3DES), within what the local OpenSSL can offer | — |
| **ocsp-stapling** | Whether the server staples an OCSP response, and whether the certificate requires it (must-staple) | — |
| **hsts** | Strict-Transport-Security header — max-age, includeSubDomains, preload readiness | — |
| **redirect-hygiene** | Walks the HTTP entry points' redirects: whether the first hop upgrades to HTTPS on the same host (an HSTS preload requirement) and every HTTPS hop on the domain sends HSTS | — |
| **hsts-preload** | HSTS preload list status and eligibility via hstspreload.org API | — |
| **mixed-content** | Detects `http://` resources loaded on HTTPS pages (active vs. passive) | — |

### 🛡️ Browser Hardening & Privacy

| Check | Description | Library / source |
|-------|-------------|---------|
| **headers** | Security headers — CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, and more | — |
| **csp** | Content Security Policy evaluation — detects unsafe-inline, unsafe-eval, missing directives, bypasses | [csp_evaluator](https://www.npmjs.com/package/csp_evaluator) |
| **cross-origin-isolation** | Cross-Origin-Opener/Embedder/Resource-Policy headers (and report-only variants), and whether the page is cross-origin isolated | [structured-headers](https://www.npmjs.com/package/structured-headers) |
| **cookies** | Cookie inventory — Secure, HttpOnly, SameSite flag coverage | — |
| **sri** | Subresource Integrity — coverage for external scripts and stylesheets | — |
| **cors** | CORS header analysis — Access-Control-Allow-Origin, methods, headers, credentials | — |
| **referrer-policy** | Referrer-Policy header evaluation and strictness assessment | — |
| **permissions-policy** | Permissions-Policy header parsing — blocked/allowed features, dangerous grants | — |
| **reporting** | Report-To, Reporting-Endpoints, and NEL headers, and whether CSP sends violation reports | [structured-headers](https://www.npmjs.com/package/structured-headers) |
| **privacy** | Privacy indicators — consent banners, privacy/cookie policies, tracker detection | — |

### 🎯 Attack Surface

| Check | Description | Library / source |
|-------|-------------|---------|
| **exposed-files** | Probes for exposed sensitive files (`.git`, `.env`, `.DS_Store`, server-status, `.svn`, wp-config backups) by content signature, and directory listings. File contents are never reported | — |
| **subdomain-takeover** | Follows CNAME chains for the apex and `www.` and flags dangling records pointing at takeover-prone services | [can-i-take-over-xyz](https://github.com/EdOverflow/can-i-take-over-xyz) fingerprints |
| **certificate-transparency** | Unexpired certificates logged for the domain via crt.sh: issuers, wildcards, and the subdomains they reveal | [crt.sh](https://crt.sh) |
| **api-discovery** | API endpoint discovery — probes for GraphQL, OpenAPI/Swagger, REST conventions | — |

### ✉️ Email & Domain Trust

| Check | Description | Library / source |
|-------|-------------|---------|
| **dns-security** | Email authentication — SPF and DMARC record parsing, policy strength assessment | — |
| **dkim** | Probes common DKIM selectors and reports each key's type and size. A domain may use a selector not in the list | — |
| **email-security** | Extended email security — BIMI, MTA-STS, TLS-RPT DNS record detection | — |
| **mx-tls** | Connects to MX hosts on port 25: STARTTLS, TLS version, certificate validity. Unreachable hosts (port 25 is often blocked) are reported as unknown | — |
| **caa** | CAA records (walking up to the parent domain per RFC 8659): which CAs may issue certificates | — |
| **dnssec** | DNSSEC validation via DNS-over-HTTPS — DNSKEY, DS, RRSIG record presence and AD flag | — |
| **whois** | Domain registration — registrar, creation/expiry dates, nameservers, domain age | [whois-json](https://www.npmjs.com/package/whois-json) |

### 🌐 Infrastructure

| Check | Description | Library / source |
|-------|-------------|---------|
| **dns** | A, AAAA, MX, CAA records; IPv6 support; CDN detection via CNAME; reverse DNS | — |
| **ipv6** | IPv6 support — AAAA record resolution and TCP connectivity testing | — |
| **rpki** | BGP prefix and origin AS for the site's addresses, and whether the route is RPKI-valid | [RIPEstat](https://stat.ripe.net/) |
| **geo** | IP geolocation — country, region, city, timezone, coordinates via IP lookup | [geoip-lite](https://www.npmjs.com/package/geoip-lite) |
| **green-hosting** | Whether the site runs on a host that uses or offsets renewable energy | [Green Web Foundation](https://www.thegreenwebfoundation.org/) |
| **sniffer** | Technology detection — CMS, frameworks, analytics, CDNs, and thousands more via Wappalyzer engine | [wappalyzer-core](https://www.npmjs.com/package/wappalyzer-core) + [webappanalyzer](https://github.com/enthec/webappanalyzer) |

### 📄 Discoverability

| Check | Description | Library / source |
|-------|-------------|---------|
| **content** | DOCTYPE, page title, meta description/generator, robots.txt and sitemap.xml existence | — |
| **canonical** | Canonical URL detection — HTML link tag, HTTP Link header, self-referential check, noindex conflict detection | [cheerio](https://www.npmjs.com/package/cheerio) |
| **robots** | robots.txt parsing — sitemap references, crawl-delay, Googlebot and wildcard blocking | [robots-parser](https://www.npmjs.com/package/robots-parser) |
| **opengraph** | Open Graph and Twitter Card meta tags — social sharing readiness | [open-graph-scraper](https://www.npmjs.com/package/open-graph-scraper) |
| **structured-data** | JSON-LD / schema.org blocks, OpenSearch description, microdata detection | — |
| **i18n** | Internationalization — HTML lang, charset, hreflang tags, Content-Language header, RTL support | [cheerio](https://www.npmjs.com/package/cheerio) |
| **well-known** | `security.txt` (RFC 9116), `change-password`, OpenID Connect, WebFinger, MTA-STS, Android asset links, Apple app-site-association, NodeInfo (Fediverse), `humans.txt` | — |
| **ads-txt** | Parses ads.txt and app-ads.txt (IAB authorized sellers): DIRECT/RESELLER records and invalid lines | — |

### ⚡ Performance

| Check | Description | Library / source |
|-------|-------------|---------|
| **lighthouse** | Performance, accessibility, best-practices, SEO scores and Web Vitals (requires Chrome); also plain-HTTP requests seen at runtime and the heaviest third parties | [Lighthouse](https://github.com/GoogleChrome/lighthouse) |
| **performance** | Response time, page size, compression, Server-Timing header, size category | — |
| **http-versions** | HTTP/2 via TLS ALPN, and HTTP/3 advertised in Alt-Svc | — |
| **cache-headers** | HTTP caching analysis — Cache-Control directives, ETag, Last-Modified, Vary, caching quality score | [cache-control-parser](https://www.npmjs.com/package/cache-control-parser) |
| **carbon** | Page weight analysis — HTML size, external resource counts, inline script/style sizes; estimated grams of CO₂ per view of the HTML document (Sustainable Web Design model, excludes subresources) | [CO2.js](https://www.npmjs.com/package/@tgwf/co2) |

### ♿ Accessibility & Mobile

| Check | Description | Library / source |
|-------|-------------|---------|
| **accessibility** | `lang` attribute, heading hierarchy, image alt text coverage, viewport meta | — |
| **a11y-axe** | Automated accessibility testing — axe-core rule violations with impact levels and WCAG criteria | [axe-core](https://www.npmjs.com/package/axe-core) |
| **mobile** | Mobile readiness — viewport meta, theme-color, apple-touch-icon, manifest link, web-app-capable, readiness score | [cheerio](https://www.npmjs.com/package/cheerio) |
| **pwa** | Progressive Web App analysis — service worker detection, manifest parsing, installability assessment | [cheerio](https://www.npmjs.com/package/cheerio) |
| **favicon** | Favicon detection — /favicon.ico probe, icon link tags, Apple touch icons, SVG icons, size variants | [cheerio](https://www.npmjs.com/package/cheerio) |

## Domain Properties

Before running checks, Site Inspector probes four endpoint variants of the domain (`http://` and `https://`, with and without `www.`) to determine canonical behavior:

| Property | Description |
|----------|-------------|
| `up` | Whether any endpoint returns an HTTP response |
| `https` | Whether HTTPS is supported |
| `enforcesHttps` | Whether HTTP redirects to HTTPS |
| `downgradesHttps` | Whether HTTPS redirects to HTTP |
| `www` | Whether `www.` endpoints respond |
| `root` | Whether non-`www.` endpoints respond |
| `canonicallyWww` | Whether non-`www.` redirects to `www.` |
| `canonicallyHttps` | Whether HTTP redirects to HTTPS |
| `serverError` | Whether the canonical endpoint returns a 5xx error |
| `redirect` | Whether the domain redirects to an external site (apex ↔ `www.` doesn't count) |

Input like `www.example.com` or `https://example.com/path` is normalized to `example.com` first.

## Updating Wappalyzer Fingerprints

The technology detection fingerprints are vendored in the `data/` directory from the [enthec/webappanalyzer](https://github.com/enthec/webappanalyzer) project. To update them:

```bash
./scripts/update-fingerprints.sh
```

The subdomain-takeover fingerprints in `data/takeover-fingerprints.json` come from [EdOverflow/can-i-take-over-xyz](https://github.com/EdOverflow/can-i-take-over-xyz) (by EdOverflow and contributors, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); see `data/takeover-fingerprints.NOTICE.md`):

```bash
./scripts/update-takeover-fingerprints.sh
```

## Development

```bash
npm install           # Install dependencies
npm test              # Run tests (vitest)
npm run build         # Compile TypeScript
npm run typecheck     # Type-check everything, including tests
npm run lint          # Lint (eslint)
npm run format        # Format (prettier)
npm run format:check  # Check formatting
npm run test:coverage # Run tests with coverage
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add a check.

## Web UI

`web/` holds a small Astro app that renders a report in the browser, with the
same verdicts as the CLI. It's meant to run on your own machine:

```bash
npm run build          # the web app imports the built library
cd web && npm install && npm run dev
```

See [web/README.md](web/README.md) for details, including its SSRF protections.

### Project Structure

```
src/
├── index.ts           # Public API — inspect(), re-exports
├── cli.ts             # CLI entry point
├── program.ts         # CLI commands and output (commander)
├── assess.ts          # Verdicts: what's good, bad, or neutral
├── domain.ts          # Domain class — 4-endpoint probing
├── endpoint.ts        # Endpoint class — fetch, follow redirects, cache
├── types.ts           # Shared TypeScript interfaces
├── utils.ts           # Helpers — fetching, HTML parsing, DNS TXT lookups
├── testing/           # Test helpers (not published)
└── checks/
    ├── check.ts       # Check interface
    ├── index.ts       # Registry — runChecks(), availableChecks()
    └── *.ts           # Individual check implementations + tests
web/                   # Astro web UI (see web/README.md)
data/
├── categories.json    # Wappalyzer technology categories
└── technologies/      # Wappalyzer fingerprint files (a-z)
```

## License

MIT
