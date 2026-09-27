# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub's private vulnerability reporting](https://github.com/benbalter/site-inspector-js/security/advisories/new)
rather than in a public issue.

## Scope

Site Inspector makes network requests to whatever domain it's given. The CLI
and library run with your own privileges, so point them only at domains you
mean to inspect.

The web UI in `web/` makes those requests from the server. It's meant to run
locally: it only answers loopback clients unless `SITE_INSPECTOR_PUBLIC=1` is
set, and it blocks requests to private, loopback, and link-local addresses.
Bypasses of those protections are in scope. See
[web/README.md](web/README.md#security).
