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
- **Release is the merge.** A push to `main` whose `manifest.json` version has no
  tag yet *is* a release: `release.yml` re-runs the CI gate, creates the tag and
  the GitHub release (body = the matching `## X.Y.Z` CHANGELOG section), then
  calls `pack.yml` (zips), `sign-firefox.yml` (unlisted `.xpi` via AMO, and it
  records the deploy) and `publish-chrome.yml`. So a release PR bumps
  `manifest.json` + `package.json` and adds a CHANGELOG section — nothing is
  pushed or tagged by hand. A hand-pushed tag `vX.Y.Z` still works: all three
  keep their `on: push: tags` trigger.
- **Never just push the tag from a workflow.** A tag pushed with `GITHUB_TOKEN`
  does not trigger `on: push: tags` runs (GitHub's no-recursive-runs rule), so
  auto-tagging alone ships *nothing* while looking green. That is why
  `release.yml` calls the three as reusable workflows (`workflow_call`) — and why
  `pack.yml`/`sign-firefox.yml` take the tag as an `inputs.tag`: in a called
  workflow `github.ref` is `main`, not the tag.
- **`ci.yml`'s `release-readiness` job is what makes that true**: a PR touching a
  shipped runtime file fails unless `manifest.json` moves forward (validated as
  a Chrome-legal 1–4-part version), `package.json` matches, and a
  `## <version>` CHANGELOG section exists. Docs, tests, CI and dependency bumps
  touch no runtime file and release nothing.
  **It only blocks a merge while it is a *required* status check on `main`** —
  today only `test` is required, and `gh pr merge --auto` merges as soon as the
  required ones pass. So `release.yml`'s gate re-checks it from the other side:
  a push that changed runtime files while the version is already released is a
  hard `::error::`, not a quiet no-op.
- **A release is resumable, and every step of it is idempotent.** "Released"
  means the tag *and* the release *and* both store zips exist — a tag alone
  isn't it, or a run that died after tagging would make every retry a green
  no-op. `release.yml`'s gate resumes such a release; the tag step reuses an
  existing ref/release instead of dying on `422 Reference already exists`;
  `sign-firefox.yml` already treats AMO's "version already exists" as a no-op.

## Commands
```bash
node --test                              # run the suite
npx @biomejs/biome check .               # lint + format check (CI gate)
npx @biomejs/biome check --write .       # apply fixes
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
