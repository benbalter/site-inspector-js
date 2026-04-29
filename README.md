# Site Inspector

A modern TypeScript tool to inspect a domain's technology, security, and capabilities. Use it from the command line or import it as a library. Inspired by [benbalter/site-inspector](https://github.com/benbalter/site-inspector).

## Features

- **38 built-in checks** covering security, SEO, performance, accessibility, and technology detection
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

Requires **Node.js ≥ 20**. The optional Lighthouse check requires Google Chrome.

## CLI Usage

```bash
# Inspect a domain (colorized terminal output)
site-inspector inspect example.com

# JSON output (pipe to jq, save to file, etc.)
site-inspector inspect example.com --json

# Run only specific checks
site-inspector inspect example.com --checks dns,headers,https,csp

# Show all 4 endpoint variants (http/https × www/non-www)
site-inspector inspect example.com --all-endpoints

# Custom timeout (milliseconds)
site-inspector inspect example.com --timeout 15000

# List all available checks
site-inspector checks
```

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

### Exports

```typescript
import {
  inspect,           // Main inspection function
  availableChecks,   // List all check names
  Domain,            // Domain class (4-endpoint probing)
  Endpoint,          // Single endpoint class
} from "site-inspector";

// Types
import type {
  InspectOptions,
  InspectionResult,
  CheckResult,
  EndpointData,
  EndpointInfo,
  DomainProperties,
} from "site-inspector";
```

## Checks

Site Inspector runs 38 checks organized into six categories. All checks run in parallel and return structured data.

### 🔒 Security

| Check | Description | Library |
|-------|-------------|---------|
| **headers** | Security headers — CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, and more | — |
| **https** | TLS certificate validity, issuer, expiry, protocol, cipher, chain completeness | [ssl-checker](https://www.npmjs.com/package/ssl-checker) |
| **hsts** | Strict-Transport-Security header — max-age, includeSubDomains, preload readiness | — |
| **csp** | Content Security Policy evaluation — detects unsafe-inline, unsafe-eval, missing directives, bypasses | [csp_evaluator](https://www.npmjs.com/package/csp_evaluator) |
| **cookies** | Cookie inventory — Secure, HttpOnly, SameSite flag coverage | — |
| **sri** | Subresource Integrity — coverage for external scripts and stylesheets | — |
| **mixed-content** | Detects `http://` resources loaded on HTTPS pages (active vs. passive) | — |
| **dns-security** | Email authentication — SPF and DMARC record parsing, policy strength assessment | — |
| **cors** | CORS header analysis — Access-Control-Allow-Origin, methods, headers, credentials | — |
| **referrer-policy** | Referrer-Policy header evaluation and strictness assessment | — |
| **permissions-policy** | Permissions-Policy header parsing — blocked/allowed features, dangerous grants | — |
| **tls-versions** | TLS version support testing — TLS 1.0, 1.1, 1.2, 1.3 handshake verification | — |
| **email-security** | Extended email security — BIMI, MTA-STS, TLS-RPT DNS record detection | — |
| **hsts-preload** | HSTS preload list status and eligibility via hstspreload.org API | — |
| **privacy** | Privacy indicators — consent banners, privacy/cookie policies, tracker detection | — |

### 🌐 DNS & Infrastructure

| Check | Description | Library |
|-------|-------------|---------|
| **dns** | A, AAAA, MX, CAA records; IPv6 support; CDN detection via CNAME; reverse DNS | — |
| **whois** | Domain registration — registrar, creation/expiry dates, nameservers, domain age | [whois-json](https://www.npmjs.com/package/whois-json) |
| **dnssec** | DNSSEC validation via DNS-over-HTTPS — DNSKEY, DS, RRSIG record presence and AD flag | — |
| **ipv6** | IPv6 support — AAAA record resolution and TCP connectivity testing | — |
| **geo** | IP geolocation — country, region, city, timezone, coordinates via IP lookup | [geoip-lite](https://www.npmjs.com/package/geoip-lite) |

### 📄 Content & SEO

| Check | Description | Library |
|-------|-------------|---------|
| **content** | DOCTYPE, page title, meta description/generator, robots.txt and sitemap.xml existence | — |
| **robots** | robots.txt parsing — sitemap references, crawl-delay, Googlebot and wildcard blocking | [robots-parser](https://www.npmjs.com/package/robots-parser) |
| **opengraph** | Open Graph and Twitter Card meta tags — social sharing readiness | [open-graph-scraper](https://www.npmjs.com/package/open-graph-scraper) |
| **structured-data** | JSON-LD / schema.org blocks, OpenSearch description, microdata detection | — |
| **accessibility** | `lang` attribute, heading hierarchy, image alt text coverage, viewport meta | — |
| **well-known** | `security.txt` (RFC 9116), `change-password`, OpenID Connect, WebFinger, MTA-STS, Android asset links, Apple app-site-association, NodeInfo (Fediverse), `humans.txt` | — |
| **canonical** | Canonical URL detection — HTML link tag, HTTP Link header, self-referential check, noindex conflict detection | [cheerio](https://www.npmjs.com/package/cheerio) |
| **i18n** | Internationalization — HTML lang, charset, hreflang tags, Content-Language header, RTL support | [cheerio](https://www.npmjs.com/package/cheerio) |
| **a11y-axe** | Automated accessibility testing — axe-core rule violations with impact levels and WCAG criteria | [axe-core](https://www.npmjs.com/package/axe-core) |

### ⚡ Performance

| Check | Description | Library |
|-------|-------------|---------|
| **performance** | Response time, page size, compression, Server-Timing header, size category | — |
| **carbon** | Page weight analysis — HTML size, external resource counts, inline script/style sizes | — |
| **lighthouse** | Performance, accessibility, best-practices, SEO scores and Web Vitals (requires Chrome) | [Lighthouse](https://github.com/GoogleChrome/lighthouse) |
| **cache-headers** | HTTP caching analysis — Cache-Control directives, ETag, Last-Modified, Vary, caching quality score | [cache-control-parser](https://www.npmjs.com/package/cache-control-parser) |

### 🔍 Technology

| Check | Description | Library |
|-------|-------------|---------|
| **sniffer** | Technology detection — CMS, frameworks, analytics, CDNs, and thousands more via Wappalyzer engine | [wappalyzer-core](https://www.npmjs.com/package/wappalyzer-core) + [webappanalyzer](https://github.com/AliasIO/wappalyzer) |

### 📱 Mobile & PWA

| Check | Description | Library |
|-------|-------------|---------|
| **mobile** | Mobile readiness — viewport meta, theme-color, apple-touch-icon, manifest link, web-app-capable, readiness score | [cheerio](https://www.npmjs.com/package/cheerio) |
| **favicon** | Favicon detection — /favicon.ico probe, icon link tags, Apple touch icons, SVG icons, size variants | [cheerio](https://www.npmjs.com/package/cheerio) |
| **pwa** | Progressive Web App analysis — service worker detection, manifest parsing, installability assessment | [cheerio](https://www.npmjs.com/package/cheerio) |
| **api-discovery** | API endpoint discovery — probes for GraphQL, OpenAPI/Swagger, REST conventions | — |

## Domain Properties

Before running checks, Site Inspector probes four endpoint variants of the domain (`http://` and `https://`, with and without `www.`) to determine canonical behavior:

| Property | Description |
|----------|-------------|
| `up` | Whether any endpoint responds |
| `https` | Whether HTTPS is supported |
| `enforcesHttps` | Whether HTTP redirects to HTTPS |
| `downgradesHttps` | Whether HTTPS redirects to HTTP |
| `www` | Whether `www.` endpoints respond |
| `root` | Whether non-`www.` endpoints respond |
| `canonicallyWww` | Whether non-`www.` redirects to `www.` |
| `canonicallyHttps` | Whether HTTP redirects to HTTPS |
| `redirect` | Whether the domain redirects to an external site |

## Updating Wappalyzer Fingerprints

The technology detection fingerprints are vendored in the `data/` directory from the [AliasIO/wappalyzer](https://github.com/AliasIO/wappalyzer) project. To update them:

```bash
./scripts/update-fingerprints.sh
```

## Development

```bash
npm install          # Install dependencies
npm test             # Run tests (vitest)
npm run build        # Compile TypeScript
npx tsc --noEmit     # Type-check without emitting
npm run lint         # Lint (eslint)
npm run format       # Format (prettier)
npm run test:coverage # Run tests with coverage
```

### Project Structure

```
src/
├── index.ts           # Public API — inspect(), re-exports
├── cli.ts             # CLI entry point (commander)
├── domain.ts          # Domain class — 4-endpoint probing
├── endpoint.ts        # Endpoint class — fetch, cache, redirect detection
├── types.ts           # Shared TypeScript interfaces
├── utils.ts           # Helpers — normalizeDomain, fetchWithTimeout
└── checks/
    ├── check.ts       # Check interface
    ├── index.ts       # Registry — runChecks(), availableChecks()
    └── *.ts           # Individual check implementations + tests
data/
├── categories.json    # Wappalyzer technology categories
└── technologies/      # Wappalyzer fingerprint files (a-z)
```

## License

MIT
