# Site Inspector

A modern TypeScript tool to inspect a domain's technology, security, and capabilities. Inspired by [benbalter/site-inspector](https://github.com/benbalter/site-inspector).

## Features

- **20 built-in checks**: DNS, Headers, HTTPS/TLS, HSTS, Content, Cookies, Technology Sniffer (Wappalyzer), Accessibility, Well-Known, SRI, Mixed Content, Carbon, WHOIS, Lighthouse, CSP Evaluator, robots.txt, Open Graph, DNS Security (SPF/DMARC), Performance, Structured Data
- **CLI and library**: Use from the command line or import as a module
- **TypeScript-first**: Full type definitions, strict mode
- **Open-source powered**: Uses [wappalyzer-core](https://www.npmjs.com/package/wappalyzer-core) + [webappanalyzer](https://github.com/AliasIO/wappalyzer) fingerprints, [ssl-checker](https://www.npmjs.com/package/ssl-checker), [whois-json](https://www.npmjs.com/package/whois-json), [Lighthouse](https://github.com/GoogleChrome/lighthouse), [csp_evaluator](https://www.npmjs.com/package/csp_evaluator), [robots-parser](https://www.npmjs.com/package/robots-parser), and [open-graph-scraper](https://www.npmjs.com/package/open-graph-scraper)
- **Parallel execution**: All checks run concurrently for fast results

## Installation

```bash
npm install site-inspector
```

Or run directly:

```bash
npx site-inspector inspect example.com
```

## CLI Usage

```bash
# Inspect a domain (colorized summary)
site-inspector inspect example.com

# JSON output
site-inspector inspect example.com --json

# Run specific checks only
site-inspector inspect example.com --checks dns,headers,https

# Show all 4 endpoint variants (http/https × www/non-www)
site-inspector inspect example.com --all-endpoints

# Custom timeout (ms)
site-inspector inspect example.com --timeout 15000

# List available checks
site-inspector checks
```

## Library Usage

```typescript
import { inspect } from "site-inspector";

const result = await inspect("example.com");

// Domain properties
console.log(result.properties.https);        // true
console.log(result.properties.enforcesHttps); // true

// Check results
console.log(result.checks.headers.data.server);            // "nginx"
console.log(result.checks.dns.data.ipv6);                  // true
console.log(result.checks.sniffer.data.cms);                // "WordPress"
console.log(result.checks.hsts.data.preloadReady);          // true
console.log(result.checks.accessibility.data.htmlLang);     // true

// Run only specific checks
const partial = await inspect("example.com", {
  checks: ["dns", "headers"],
  timeout: 5000,
});
```

## What's Checked

### Domain Properties

| Property | Description |
|---|---|
| `up` | Whether any endpoint responds |
| `https` | Whether HTTPS is supported |
| `enforcesHttps` | Whether HTTP redirects to HTTPS |
| `downgradesHttps` | Whether HTTPS redirects to HTTP |
| `www` | Whether www endpoints respond |
| `root` | Whether non-www endpoints respond |
| `canonicallyWww` | Whether non-www redirects to www |
| `canonicallyHttps` | Whether HTTP redirects to HTTPS |
| `redirect` | Whether the domain redirects externally |

### Checks

| Check | What it inspects |
|---|---|
| **dns** | A/AAAA/MX/CAA records, IPv6 support, CDN detection, reverse DNS |
| **headers** | Security headers (CSP, X-Frame-Options, XCTO, XSS-Protection, Referrer-Policy, Permissions-Policy) |
| **https** | TLS certificate validity, issuer, expiry, protocol version |
| **hsts** | Strict-Transport-Security parsing, preload readiness |
| **content** | DOCTYPE, title, meta tags, robots.txt, sitemap.xml |
| **cookies** | Cookie inventory, Secure/HttpOnly/SameSite flags |
| **sniffer** | Technology detection via Wappalyzer engine — CMS, frameworks, analytics, CDNs, and thousands more |
| **accessibility** | `lang` attribute, heading hierarchy, image alt coverage, viewport |
| **well-known** | `security.txt` parsing, `change-password` support |
| **sri** | Subresource Integrity coverage for external scripts and stylesheets |
| **mixed-content** | Detects `http://` resources on HTTPS pages (active & passive) |
| **carbon** | Page weight analysis — HTML size, resource counts, inline content |
| **whois** | Domain registration info — registrar, creation/expiry dates, nameservers |
| **lighthouse** | Performance, accessibility, SEO, best-practices scores via Google Lighthouse (requires Chrome) |
| **csp** | CSP header evaluation — detects unsafe-inline, unsafe-eval, bypasses, missing directives |
| **robots** | robots.txt parsing — sitemaps, crawl-delay, Googlebot/all-bot blocking |
| **opengraph** | Open Graph & Twitter Card meta tags — social sharing readiness |
| **dns-security** | Email security — SPF and DMARC record parsing, policy strength |
| **performance** | Response timing, page size, compression, server-timing, size category |
| **structured-data** | JSON-LD / schema.org detection, OpenSearch, microdata |

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build

# Type-check
npx tsc --noEmit

# Lint
npm run lint
```

## License

MIT
