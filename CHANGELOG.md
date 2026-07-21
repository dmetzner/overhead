# Changelog

All notable changes to Overhead. Versions match `manifest.json` / release tags.

## 2.4.0

Trust release — every finding of the 2026-07 external audit fixed.

- **Fixed catalog corruption on profile duplication:** duplicated sources now get
  fresh ids (catalogs are stored globally by source id, so copies used to
  overwrite each other); already-duplicated ids are split by a migration.
- **No more silent rule failures:** header names/values and URL patterns are
  validated centrally against what the engine accepts (RE2 via
  `isRegexSupported`, RFC 9110 tokens, no control chars — manual entry, inline
  edits, and imports included). `updateDynamicRules` failures fail *closed*
  (stale rules removed), are retried, and surface in a popup banner + a `!`
  badge instead of pretending to be active.
- **No stale header injection:** editing a source URL clears its catalog;
  a failed refresh flags kept rows as stale and counts as a failure.
- **Robust persistence:** saves are queued (no interleaved writes), `storage.sync`
  is written before catalogs, and every save failure lands on one global banner.
- **Refresh can't hang:** endpoint fetches time out after 10 s and the button is
  disabled while a refresh runs.
- **Share format v2:** endpoint selections travel with the link, so a
  source-driven profile round-trips as a working setup (plain shares still
  encode as v1 for older installs). The `/i` preview shows them and no longer
  blanks on malformed fragments — and is now covered by a real parity test that
  executes the page's script.
- **Site honesty:** the landing page now scopes the no-telemetry claim to the
  extension and discloses the site's cookieless GoatCounter analytics.
- **A11y:** Escape closes Settings with focus restore, arrow keys move between
  tabs, unlabeled fields/delete buttons got names, statuses are live regions,
  small controls have ≥24 px hit areas.
- **Release safety:** CI also runs on tags; the Firefox signing workflow checks
  tag↔manifest consistency and runs lint+tests before signing anything.
- `popup.js` (736 lines) split into focused ES modules under `popup/`.

## 2.3.0
- **Fixed silent data loss:** fetched catalogs now live in `storage.local`, so the
  synced config stays under the ~8 KB `storage.sync` per-item cap; saves report
  failures instead of dropping them.
- **Safer import:** a shared config lands as an *inactive* profile (you switch to it
  deliberately) and warns on credential headers or an `.*` scope.
- **Accessibility:** accessible names on every control, visible keyboard focus, and
  tab↔panel wiring.
- Profile delete now takes a confirm; DNR rules rebuild only on injection-relevant
  changes; the URL-regex input is debounced.
- Docs corrected (import semantics, `resourceTypes` scope, RE2 caveat); LICENSE
  holder fixed. Added a `node --test` suite, CI, `CHANGELOG.md`, and `CLAUDE.md`.

## 2.2.0
- **Named profiles** — separate header sets (staging / prod / canary), each with
  its own scope and sources; only the active profile is injected. Existing
  single-set installs migrate automatically into a "Default" profile.

## 2.1.0
- **Standard-header autocomplete** — the Manual field completes ~60 standard and
  `X-` request headers and hints a typical value.
- **Shareable configs** — copy a link that packs a profile into its URL fragment
  (client-side only); the `/i` page previews it, Import adds it as a new profile.
- Landing site at `overhead.metzner.uk` (GitHub Pages).

## 2.0.1
- Fixed the Chrome MV3 `background.scripts` warning by shipping a per-browser
  manifest (Chrome `service_worker` / Firefox event-page `scripts`); releases now
  produce separate `overhead-chrome-*` and `overhead-firefox-*` zips.

## 2.0.0
- Rebrand from the niceshops "NiceHeader" fork to **Overhead**: neutral theming
  (light/dark + accent presets), new icon, MIT, standalone under `dmetzner/overhead`.
