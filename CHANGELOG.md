# Changelog

All notable changes to Overhead. Versions match `manifest.json` / release tags.

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
