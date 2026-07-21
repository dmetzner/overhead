# CLAUDE.md — Overhead

MV3 browser extension (Chrome + Firefox) that injects HTTP **request** headers via
`declarativeNetRequest`, plus a static landing site. Fork-turned-standalone under
`dmetzner/overhead`. No build step, no framework, no TypeScript — plain ES modules.

## Layout
- `rules.js` — the shared core (imported by both `sw.js` and `popup.js`): state
  model + `loadState` migration, `activeProfile`, `injectionSig`, the DNR rule
  builder (`applyRules`), catalog fetch/validate, and the share codec
  (`encodeConfig`/`decodeConfig`).
- `sw.js` — background; rebuilds DNR rules on relevant storage changes.
- `popup.{html,js,css}` — the popup UI (endpoint / manual / profiles / settings).
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
- **Per-browser manifest:** committed `manifest.json` is Chrome (`service_worker`);
  the CI Firefox build swaps in `background.scripts` via a `jq` step. Edit both
  builds in the workflows if the background block changes.
- **Release:** push tag `vX.Y.Z` matching `manifest.json`. `pack.yml` builds the
  two zips; `sign-firefox.yml` signs the unlisted `.xpi` via AMO (needs
  `AMO_JWT_*` secrets). Fork gate is cleared, so tag push auto-runs both.

## Commands
```bash
node --test           # run the suite
node --check *.js      # syntax
```
Don't commit unless asked — Daniel reviews diffs.
