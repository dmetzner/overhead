# NiceHeader

A tiny Chrome extension (Manifest V3) that injects **arbitrary request headers**
into outgoing requests — with a fast path for feature-flag headers pulled from
a JSON source (see below), but works for any header.

Toggle each header on/off, scope them to a URL regex. Multiple headers active
at once, one click each. No ads, no bloat.

Two ways to pick flags:

- **Endpoint** — add one or more URLs or local files that return known feature
  flags as fixed-format JSON (refresh for URLs, re-import for files), then
  toggle which ones to inject. No more guessing flag names or their casing.
- **Manual** — type any header/flag by hand.

## Endpoint sources

Each source is independent — just a URL or a local JSON file, same schema
(see below). Add as many as you need (e.g. a `shop` and an `admin` endpoint);
there's no "active" one to switch between — **Refresh all** fetches every URL
source in parallel and their flags all show up merged into one list, each
tagged with its origin when more than one source is configured. A source's
on/off selections persist across a refresh, matched by key.

File sources aren't auto-refreshed (browsers don't let a page silently re-read
an arbitrary local path) — hit **Re-import** on that row to pick the file again.

The response/file content must match this shape:

```json
{
  "flags": [
    { "key": "checkout.express_pay", "value": "1" }
  ]
}
```

`key` string (required) · `value` string (optional, defaults to `"1"` — e.g.
`"1;context=de"`). Extra fields are ignored; malformed rows (missing/blank
`key`) are dropped and the count reported. Toggling a flag **on** injects
`<key>: <value>` — the key is used as the header name exactly as the source
sends it, no prefix added.

Try it without a real backend: **File…** → pick [`examples/flags.sample.json`](examples/flags.sample.json).

## Manual source

Type any header name + value and it's sent as-is — no prefixing, no magic. Use
it for one-off headers or flags the endpoint doesn't list. Each row's name and
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

## Install (unpacked)

1. Grab the latest `nice-header-v*.zip` from the [Releases](../../releases) page
   and unzip it (or `git clone` this repo).
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. **Load unpacked** → select the folder.
5. Pin the NiceHeader icon; the badge shows how many headers are active.

## Releasing

A zip is built by the [Pack extension](.github/workflows/pack.yml) workflow:

- **Push a tag** `vX.Y.Z` (matching `manifest.json`) → a GitHub Release is
  created with the zip attached.
- Or run the workflow manually (**Actions → Pack extension → Run workflow**) to
  get the zip as a downloadable build artifact without cutting a release.

## How it works

Manifest V3 removed blocking `webRequest`, so headers are set declaratively via
[`declarativeNetRequest.updateDynamicRules`](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest).
One dynamic rule holds a `modifyHeaders` action with one `set` entry per active
header. State lives in `chrome.storage.sync`; the service worker rebuilds the
rule whenever state changes.

```
manifest.json      extension manifest (MV3)
rules.js           shared state + DNR rule builder + catalog fetch/validate
sw.js              service worker — applies rules on install/startup/change
popup.html/js/css  endpoint + manual header UI
examples/          sample flags.json to try the Endpoint tab's File import
```

## Notes

- `host_permissions: <all_urls>` is required to modify headers on arbitrary dev
  hosts. Nothing is sent anywhere — rules are local to your browser.
- File sources use a file picker (`<input type="file">` + `File.text()`) rather
  than a typed path, so no `file://` host permission is needed — that permission
  is a hidden per-extension toggle in `chrome://extensions` and fetching an
  arbitrary local path silently would be surprising/unsafe without it.

## License

[MIT](LICENSE)
