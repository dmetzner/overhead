# Overhead

A tiny browser extension (Manifest V3, Chrome + Firefox) that injects
**arbitrary request headers** into outgoing requests. Type them by hand, or pull
a known set from any JSON source (a dev backend, a local file) — either way they
arrive verbatim.

Toggle each header on/off, scope them to a URL regex. Multiple headers active
at once, one click each. Light/dark theme and a pickable accent. No ads, no bloat.

Two ways to pick headers:

- **Endpoint** — add one or more URLs or local files that return known headers
  as fixed-format JSON (refresh for URLs, re-import for files), then toggle
  which ones to inject. No more guessing names or their casing.
- **Manual** — type any header by hand.

## Endpoint sources

Each source is independent — just a URL or a local JSON file, same schema
(see below). Add as many as you need (e.g. a `shop` and an `admin` endpoint);
there's no "active" one to switch between — **Refresh all** fetches every URL
source in parallel and their headers all show up merged into one list, each
tagged with its origin when more than one source is configured. A row's on/off
selection persists across a refresh, matched by key; the value is editable
in place and each row can be removed.

File sources aren't auto-refreshed (browsers don't let a page silently re-read
an arbitrary local path) — hit **Re-import** on that row to pick the file again.

The response/file content must match this shape:

```json
{
  "headers": [
    { "name": "x-example-header", "value": "1" }
  ]
}
```

`name` string (required) · `value` string (optional, defaults to `"1"` — e.g.
`"1;context=de"`). Extra fields are ignored; malformed rows (missing/blank
`name`) are dropped and the count reported. Toggling a row **on** injects
`<name>: <value>` — sent exactly as the source spells it, no prefix or rewriting.
A backend can hand out whatever header names it wants and they arrive verbatim.

Try it without a real backend: **File…** → pick [`examples/headers.sample.json`](examples/headers.sample.json).

## Manual source

Type any header name + value and it's sent as-is — no prefixing, no magic. Use
it for one-off headers or ones the endpoint doesn't list. Each row's name and
value are editable in place; re-adding an existing name updates its value
instead of duplicating. The per-row toggle enables/disables one header; the
master switch in the header bar disables all headers (endpoint + manual) at
once.

## URL regex filter

Scopes which requests get the headers — a
[`declarativeNetRequest` regexFilter](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#property-RuleCondition-regexFilter)
(RE2 syntax) matched against the request URL. Use an alternation to cover
multiple hosts: `(shop|admin)\.example\.dev`. Empty or `.*` = everything. An
invalid pattern is flagged inline and never applied, so a typo can't silently
disable header injection.

## Theming

The gear in the top bar opens appearance settings: **theme** (System / Light /
Dark) and an **accent** swatch (indigo, blue, teal, green, amber, rose). System
follows your OS light/dark preference; the accent recolors the UI and the
toolbar badge. Both persist in `storage.sync`, so they follow you across
browsers signed into the same profile. Palettes are plain CSS custom properties
in `popup.css` (`--bg`, `--panel`, `--accent`, …) — add or retint a theme by
editing those, and add an accent by extending the `ACCENTS` map in `rules.js`.

## Install

Grab the latest `overhead-v*.zip` from the [Releases](../../releases) page
and unzip it (or `git clone` this repo) — the same folder installs on either
browser.

**Chrome / Chromium:**

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. **Load unpacked** → select the folder.
4. Pin the Overhead icon; the badge shows how many headers are active.

**Firefox (temporary, for development):**

Firefox only runs unsigned add-ons as *temporary* installs — they're removed
when Firefox restarts, so reload after each restart.

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and pick `manifest.json` inside the folder.
3. The first time you toggle a header on, Firefox may prompt for the
   `<all_urls>` permission (needed to modify requests) — allow it, or grant it
   up front via the add-on's **Permissions** tab in `about:addons`.

**Firefox (permanent, signed):**

For an install that survives restarts, use the signed `.xpi` attached to each
[Release](../../releases) — open it in Firefox, or drag it onto `about:addons`.
Firefox add-ons distributed this way are *unlisted* (not on the public AMO
gallery); Mozilla signs them automatically. Signing is done in CI by the
[Sign Firefox add-on](.github/workflows/sign-firefox.yml) workflow — see below.
(The signed `.xpi` installs permanently but doesn't self-update yet; that needs
the `update_url` + `updates.json` layer, not set up here.)

## Releasing

Pushing a tag `vX.Y.Z` (matching `manifest.json`) cuts a GitHub Release and runs
two workflows against it:

- [Pack extension](.github/workflows/pack.yml) — builds and attaches the
  unpacked `overhead-v*.zip` (Chrome/Firefox dev installs). Can also be run
  manually to get the zip as a build artifact without a release.
- [Sign Firefox add-on](.github/workflows/sign-firefox.yml) — signs the add-on
  as an unlisted `.xpi` via Mozilla's AMO API and attaches it to the release.
  It authenticates with the `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` repo secrets
  (from [AMO → API keys](https://addons.mozilla.org/developers/addon/api/key/));
  rotate them there if they ever need refreshing.

## How it works

Manifest V3 removed blocking `webRequest`, so headers are set declaratively via
[`declarativeNetRequest.updateDynamicRules`](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest).
One dynamic rule holds a `modifyHeaders` action with one `set` entry per active
header. State lives in `storage.sync`; the background script rebuilds the rule
whenever state changes.

The same source runs on both browsers: every API call goes through
`globalThis.browser ?? globalThis.chrome`, picking the promise-based
WebExtension namespace on whichever browser is running it. `manifest.json`
declares the background script under both `service_worker` (what Chromium
reads) and `scripts` (what Firefox reads, as a non-persistent background page)
— each browser ignores the key it doesn't understand. `browser_specific_settings.gecko.id`
is set because Firefox requires an explicit add-on ID for `storage.sync` to work.

File imports have one real browser difference: Firefox closes the popup the
moment its native file dialog opens, before the picked file's `change` event
can fire, so the **File…**/**Re-import** buttons reopen the popup as a full tab
on Firefox (Chrome shows the dialog fine from the popup directly).

```
manifest.json      extension manifest (MV3, Chrome + Firefox)
rules.js           shared state + DNR rule builder + catalog fetch/validate
sw.js              background script — applies rules on install/startup/change
popup.html/js/css  endpoint + manual header UI
examples/          sample headers.json to try the Endpoint tab's File import
```

## Notes

- `host_permissions: <all_urls>` is required to modify headers on arbitrary dev
  hosts. Nothing is sent anywhere — rules are local to your browser. On Firefox
  this is an optional permission granted per add-on (prompted on first use, or
  via `about:addons` → **Permissions**); on Chrome it's granted at install time.
- File sources use a file picker (`<input type="file">` + `File.text()`) rather
  than a typed path, so no `file://` host permission is needed — fetching an
  arbitrary local path silently would be surprising/unsafe without it.

## License

[MIT](LICENSE)
