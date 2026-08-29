# CLAUDE.md — Overhead

MV3 browser extension (Chrome + Firefox) that injects HTTP **request** headers via
`declarativeNetRequest`, plus a static landing site. Fork-turned-standalone under
`dmetzner/overhead`. No build step, no framework, no TypeScript — plain ES modules.

## Layout
- `share.js` — the pure, browser-free core shared with the site: header
  validation (`headerNameError`/`headerValueError`), the share codec
  (`b64url*`, `CONFIG_VERSION`, `decodeConfig`, v2 carries source selections),
  and the credential/scope risk helpers (`isCredentialHeader`/`isBroadScope`).
  No DOM or WebExtension APIs, so the static preview page can import it too.
  **Copied verbatim to `docs/share.js`** (`npm run sync:share`) — the two must
  stay byte-identical (parity test enforces it).
- `rules.js` — the extension core (imported by both `sw.js` and the popup),
  re-exporting `share.js`: state model + `loadState` migrations, `activeProfile`,
  `injectionSig`, `urlRegexError` (RE2, extension-only), the DNR rule builder
  (`applyRules`, fail-closed + status under `RULE_STATUS_KEY`), catalog
  fetch/validate (10 s timeout), and `encodeConfig`.
- `sw.js` — background; rebuilds DNR rules on relevant storage changes.
  `lastSig` is only recorded after a *successful* apply, so failures retry.
- `popup.html` / `popup.css` / `popup/` — the popup UI as ES modules:
  `app.js` (entry/shell), `store.js` (state + persist + render), `dom.js`
  (els + builders), `endpoint.js`, `manual.js`, `profiles.js`, `settings.js`.
- `standard-headers.js` — autocomplete list.
- `docs/` — the `overhead.metzner.uk` site: `index.html` (landing) + `i/index.html`
  (share-link importer/preview). GitHub Pages, source = `main` `/docs`.
- `test/` — `node --test` (no deps).

## Invariants / gotchas
- **Storage split:** the small config (profiles, scope, appearance) is in
  `storage.sync` (~8 KB per-item cap — keep it small); bulky fetched `catalog`
  arrays live in `storage.local` under `CATALOG_KEY`, keyed by source id, and are
  rehydrated in `loadState`. Never put catalogs back in the synced object.
- **`sw.js` watches both stores** (sync `STORAGE_KEY` + local `CATALOG_KEY`) — a
  catalog on/off toggle writes to local, so dropping the local listener silently
  stops endpoint headers from applying. `injectionSig` gates redundant rebuilds.
- **Migration** (`loadState`): pre-profiles flat state → one "Default" profile.
  It rewrites every user's stored state on upgrade — covered by `test/`; don't
  break it.
- **Share decoder is single-source:** both the extension and `docs/i/index.html`
  decode via `share.js`. The site can't import repo-root files, so `docs/share.js`
  is a byte-identical copy — after editing `share.js`, run `npm run sync:share`
  (or `npm run check`, which does it first) or CI's parity test fails. Bump
  `CONFIG_VERSION` in `share.js` when the shape changes; nothing else re-decodes.
- **Validation is centralized in `share.js`** (re-exported by `rules.js`) — `updateDynamicRules` is atomic,
  so one engine-invalid header/pattern would void the whole rule set. Every
  entry point (manual add, inline edit, import, applyRules itself) must go
  through `headerNameError`/`headerValueError`/`urlRegexError`; don't add an
  input path that bypasses them.
- **Ship-list is duplicated in three workflows** (`pack.yml`,
  `sign-firefox.yml`, `publish-chrome.yml`) plus the `ci.yml` syntax loop:
  adding a runtime file/dir means updating all of them (the `popup` directory is
  shipped as a whole). `share.js` is a shipped runtime file — `docs/` is not.
- **Per-browser manifest:** committed `manifest.json` is Chrome (`service_worker`);
  the CI Firefox build swaps in `background.scripts` via a `jq` step. Edit both
  builds in the workflows if the background block changes.
- **Release:** push tag `vX.Y.Z` matching `manifest.json`. `pack.yml` builds the
  two zips; `sign-firefox.yml` signs the unlisted `.xpi` via AMO (needs
  `AMO_JWT_*` secrets). Fork gate is cleared, so tag push auto-runs both.

## Commands
```bash
node --test                              # run the suite
npx @biomejs/biome check .               # lint + format check (CI gate)
npx @biomejs/biome check --write .       # apply fixes
```
Biome lints JS/CSS/JSON only — `.html` and the vendored `docs/count.js` are
excluded (see `biome.json`). CI (`ci.yml`) runs Biome + syntax + tests on every
push/PR; `pack.yml` asserts the tag matches `manifest.json`.

Chrome Web Store publish (`publish-chrome.yml`) is wired but dormant until the
four `CWS_*` secrets exist (see backlog story 34 / CHANGELOG). Firefox signs
automatically via AMO.
Don't commit unless asked — Daniel reviews diffs.
