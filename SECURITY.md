# Security

## Reporting a vulnerability

Please report security issues privately by email to
**[contact@metzner.uk](mailto:contact@metzner.uk)** with "overhead security" in the
subject. Do not open a public issue for them.

Only the latest release, the version in `manifest.json` on `main`, gets fixes.

## Scope

Overhead injects the HTTP request headers you configure, through
`declarativeNetRequest`, into the URL scope you choose. Two things deserve
particular attention in a report:

- anything that injects a header outside the configured scope, or that injects
  one the validators in `share.js` / `rules.js` should have rejected;
- the share-link importer (`docs/i/`) and the endpoint catalog fetch, which both
  handle data from someone else.
