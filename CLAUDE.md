# CLAUDE.md — Overhead

MV3 browser extension (Chrome + Firefox) that injects HTTP **request** headers via
`declarativeNetRequest`, plus a static landing site. Fork-turned-standalone under
`dmetzner/overhead`. No build step, no framework, no TypeScript — plain ES modules.

## Layout
- `rules.js` — the shared core (imported by both `sw.js` and the popup): state
  model + `loadState` migrations, `activeProfile`, `injectionSig`, header/RE2
  validation (`headerNameError`/`headerValueError`/`urlRegexError`), the DNR
  rule builder (`applyRules`, fail-closed + status under `RULE_STATUS_KEY`),
  catalog fetch/validate (10 s timeout), and the share codec
  (`encodeConfig`/`decodeConfig`, v2 carries source selections).
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
- **Share format is a 2-artifact contract:** `rules.js` AND `docs/i/index.html`
  both decode the same base64url fragment. Keep them in parity (there's a parity
  test) and bump/check `CONFIG_VERSION` on both sides when the shape changes.
- **Validation is centralized in `rules.js`** — `updateDynamicRules` is atomic,
  so one engine-invalid header/pattern would void the whole rule set. Every
  entry point (manual add, inline edit, import, applyRules itself) must go
  through `headerNameError`/`headerValueError`/`urlRegexError`; don't add an
  input path that bypasses them.
- **Ship-list is duplicated in three workflows** (`pack.yml`,
  `sign-firefox.yml`, `publish-chrome.yml`): adding a runtime file/dir means
  updating all three (the `popup` directory is shipped as a whole).
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
