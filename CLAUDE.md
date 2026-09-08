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
- **Ship-list: one declaration, three shell copies.**
  `.github/runtime-paths.txt` is the declared set of shipped runtime paths (a
  trailing `/` marks a directory shipped whole); `ci.yml`'s `release-readiness`
  job and `release.yml`'s gate build their regex from it. The three shipping
  workflows (`pack.yml`, `sign-firefox.yml`, `publish-chrome.yml`) still carry
  their own shell lists, because a word list is not a regex —
  `test/ship-list.test.js` fails if any of them drifts from the declaration.
  Adding a runtime file means editing the declaration *and* the three lists (and
  the `ci.yml` syntax loop, if it's JS). `share.js` is a shipped runtime file —
  `docs/` is not.
- **Per-browser manifest:** committed `manifest.json` is Chrome (`service_worker`);
  the CI Firefox build swaps in `background.scripts` via a `jq` step. Edit both
  builds in the workflows if the background block changes.
- **Release is the merge.** A push to `main` whose `manifest.json` version isn't
  released yet *is* the release: `release.yml` re-runs the CI gate, tags, creates
  the GitHub release (body = the matching `## X.Y.Z` CHANGELOG section, via
  `.github/ensure-release.sh`), then calls `pack.yml`, `sign-firefox.yml` (AMO
  `.xpi` + the deploy record) and `publish-chrome.yml`. A release PR therefore
  bumps `manifest.json` + `package.json` and adds a CHANGELOG section; nothing is
  tagged by hand. `concurrency: release` serialises two quick merges, and secrets
  are *mapped* to the callees, not inherited.
- **Never just push the tag from a workflow.** A `GITHUB_TOKEN` tag push does not
  trigger `on: push: tags` (no-recursive-runs), so auto-tagging alone ships
  *nothing* while going green — hence `workflow_call`, and hence `inputs.tag` on
  all three (in a called workflow `github.ref` is `main`, not the tag).
- **`ci.yml`'s `release-readiness` is what makes "every merge releases" true**: a
  PR into `main` touching a path in `.github/runtime-paths.txt` fails unless
  `manifest.json` moves forward (Chrome-legal 1-4-part version), `package.json`
  matches, and a `## <version>` CHANGELOG section exists. Keep it a job that
  always runs and decides inside the script — a skipped job leaves a required
  check pending forever. **It blocks nothing until it is a required check on
  `main`** (today only `test` is, and `gh pr merge --auto` merges as soon as the
  required ones pass), so `release.yml`'s gate errors from the other side when a
  push changed runtime files the already-released version cannot carry.
- **A release is resumable; every step is idempotent.** "Released" means the tag
  *and* the release *and* both zips — a tag alone isn't, or a run that died after
  tagging turns every retry into a green no-op. The tag step reuses an existing
  ref (`git/refs` answers 422 "already exists"), assets go up via `gh release
  upload --clobber`, and AMO's "version already exists" is a no-op. Because AMO
  will not re-sign a version, the `.xpi` is also kept as a workflow artifact and
  its absence from the release is warned about.
- **A hand-pushed tag still works, but it is the lesser path** — it skips
  `release-readiness`, so nothing checked that the version was releasable. All
  three shipping workflows re-check tag vs `manifest.json`, and all but `pack`
  re-run lint+tests, so it cannot ship mismatched or untested code.

## Commands
```bash
node --test                              # run the suite
npx @biomejs/biome check .               # lint + format check (CI gate)
npx @biomejs/biome check --write .       # apply fixes
actionlint                               # lint the workflows (local only, brew)
```
Biome lints JS/CSS/JSON only — `.html` and the vendored `docs/count.js` are
excluded (see `biome.json`). CI (`ci.yml`) runs Biome + syntax + tests on every
push/PR (and again from `release.yml` before it ships); `pack.yml` asserts the
tag matches `manifest.json`.

Chrome Web Store publish (`publish-chrome.yml`) is wired but dormant until the
four `CWS_*` secrets exist (see backlog story 34 / CHANGELOG). Firefox signs
automatically via AMO.
Don't commit unless asked — Daniel reviews diffs.

## How changes land

**Every change goes through a pull request — no direct pushes to `main`.** Merging needs three
things: this repo's gate green locally (`npm run check`), CI green, and an independent review
with no unresolved high or major finding on the commit that gets merged.

**A CI job that could not START is not a pass.** The Actions billing block dies in about three
seconds with no logs and no steps; that is "could not run", and it is said out loud on the PR
rather than merged past in silence.

**The only exception is a project Daniel has explicitly called prototyping. This is not one.**
