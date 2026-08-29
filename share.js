/* Pure, browser-free share-config codec + header validation.

   ONE source of truth, imported by two consumers:
     - rules.js — the extension core (validation, decode-on-import).
     - the share-link preview page (docs/i/index.html), via an identical copy
       at docs/share.js — so the page previews EXACTLY what the extension will
       import (same validation, same dropped rows), instead of a second
       hand-written decoder that can silently disagree.

   Keep share.js and docs/share.js byte-identical: `npm run sync:share` copies
   root → docs, and test/share-parity.test.js fails CI if they drift.

   No DOM, no WebExtension APIs, no imports here — that's what lets the static
   page load it as a plain ES module. */

/* ---------- header validation ----------
   updateDynamicRules is atomic: one bad header name/value rejects the whole
   update and nothing is injected. Validate centrally so every entry point
   (manual add, inline edit, import, endpoint rows) agrees with what the engine
   will actually accept. */

// RFC 9110 token — the charset Chromium enforces for header names.
const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
// Field content: no CR/LF/NUL or other C0 controls (tab allowed).
const HEADER_VALUE_RE = /^[\t\x20-\x7E\u0080-\uFFFF]*$/;

export function headerNameError(name) {
  const n = (name ?? "").trim();
  if (!n) return "Header name is empty.";
  if (!HEADER_NAME_RE.test(n)) return `"${n}" is not a valid HTTP header name.`;
  return null;
}

export function headerValueError(value) {
  if (!HEADER_VALUE_RE.test(value ?? "")) return "Header value contains control characters.";
  return null;
}

/* ---------- credential / scope risk ----------
   A header carrying a secret leaks it to whatever the URL scope matches, so the
   UI warns when a credential-class header is active under a scope broad enough
   to hit unrelated sites. These are heuristics for a *warning*, never a block —
   the user stays in control. */

// Request headers that typically carry a secret. Lowercased for comparison.
const CREDENTIAL_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "x-api-key",
  "x-auth-token",
  "x-access-token",
  "x-csrf-token",
  "x-xsrf-token",
]);

export function isCredentialHeader(name) {
  return CREDENTIAL_HEADERS.has((name ?? "").trim().toLowerCase());
}

// True when `regex` (a DNR regexFilter) would match arbitrary, unrelated URLs —
// i.e. the scope is so broad a credential header under it leaks to sites the
// user never named. Probed behaviourally: if the pattern matches these
// nothing-to-do-with-anyone sentinels, it matches (almost) everything. This
// won't flag a specific pattern like `api\.example\.dev`, only genuinely broad
// ones (`.*`, `.`, empty, `https?`, …). One sentinel per common TLD, so a
// bare-TLD catch-all (`\.io`, `\.org`, … — matches nearly every site on that
// TLD) is flagged too, while a full host pattern like `shop\.example\.com` is
// not. regexFilter partial-matches and JS RegExp.test does too, so the check
// mirrors the engine. It can't cover every TLD that exists — it's a best-effort
// warning, never a block.
const SCOPE_SENTINEL_TLDS = [
  "com",
  "org",
  "net",
  "io",
  "dev",
  "app",
  "co",
  "xyz",
  "info",
  "example",
  "test",
];
// Each carries "https://" + a distinctive host so scheme catch-alls (`https?`)
// and TLD wildcards (`\.io`) both match, while a real host pattern doesn't.
const SCOPE_SENTINELS = SCOPE_SENTINEL_TLDS.map((tld) => `https://q7z.${tld}/p`);

// This is the ONLY place an untrusted scope pattern is executed, and JS RegExp
// has no timeout — it can backtrack super-linearly (exponentially for a nested
// quantifier, polynomially for stacked ones) and freeze the popup thread. We
// can't safely run an arbitrary pattern, so instead of trying to enumerate every
// dangerous *shape* (a denylist is provably leaky — `.*.*.*…!` and `((.)+)+!`
// both slip past shape matching yet hang), we bound backtracking *potential*:
// skip the probe for any pattern with more than two repetition quantifiers or a
// directly-quantified group. A genuine broad scope (`.*`, `\.io`, `https?`)
// needs neither; a skipped pattern simply gets no breadth warning, and the real
// request matcher (linear RE2) is unaffected either way.
const MAX_SCOPE_QUANTIFIERS = 2;

export function isBroadScope(regex) {
  const rx = (regex ?? "").trim() || ".*";
  if (rx.length > 200) return false; // guard compile cost of an absurdly long paste
  const bare = rx.replace(/\\./g, ""); // drop escapes so \( \* aren't miscounted
  // Count EVERY repetition operator — *, +, ?, and {n,m}. Missing any one (e.g.
  // ? = 0-or-1) lets an attacker stack it into exponential backtracking (`.?`×N).
  // With ≤2 of them and no directly-quantified group, backtracking over the
  // fixed 16-char sentinel is at worst polynomial (a few hundred steps).
  const quantifiers = (bare.match(/[*+?]|\{\d+,?\d*\}/g) ?? []).length;
  if (quantifiers > MAX_SCOPE_QUANTIFIERS || /\)[*+?{]/.test(bare)) return false;
  let re;
  try {
    re = new RegExp(rx);
  } catch {
    return false; // invalid patterns are surfaced elsewhere; don't double-warn
  }
  return SCOPE_SENTINELS.some((u) => re.test(u));
}

/* ---------- shareable config ----------
   A config is the portable slice of state — manual headers, the URL scope, and
   any URL sources (file sources are local, so they're left out). It's packed to
   a URL-safe base64 string carried in a link fragment, so sharing is entirely
   client-side: the blob never touches a server. The /i page decodes and
   previews it; the popup's Import pastes it back. */

// v2 added per-source selections (sources[].headers) so a source-driven profile
// round-trips as a working setup. Plain shares still encode as v1, so older
// installs keep importing them.
export const CONFIG_VERSION = 2;

export function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Internal to decodeConfig; b64urlEncode is exported because encodeConfig (in
// rules.js) needs it, but nothing outside decodes, so this stays module-private.
function b64urlDecode(b64) {
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// Parse a share code (raw, or a full link — anything after the last "#" is used)
// into { name, headers, sources, urlRegex, dropped }. Entries with header names
// or values the engine would reject are dropped and counted, so an imported (or
// previewed) config can never poison the atomic DNR update — and the preview
// page shows exactly the rows that will actually import. Throws on a malformed
// code.
export function decodeConfig(input) {
  const code = String(input).trim().split("#").pop().trim();
  if (!code) throw new Error("No config code found.");
  let data;
  try {
    data = JSON.parse(b64urlDecode(code));
  } catch {
    throw new Error("That doesn't look like an Overhead config code.");
  }
  if (!data || typeof data !== "object") {
    throw new Error("Config code is malformed.");
  }
  if (typeof data.v === "number" && data.v > CONFIG_VERSION) {
    throw new Error("This share code is from a newer version of Overhead — update to import it.");
  }
  let dropped = 0;
  const keepRow = (h) => {
    const ok =
      h &&
      typeof h.name === "string" &&
      !headerNameError(h.name) &&
      !headerValueError(typeof h.value === "string" ? h.value : "");
    if (h && !ok) dropped++;
    return ok;
  };
  const rowValue = (h) => (typeof h.value === "string" ? h.value : "");
  const headers = (Array.isArray(data.headers) ? data.headers : []).filter(keepRow).map((h) => ({
    name: h.name.trim(),
    value: rowValue(h),
    enabled: h.enabled !== false,
  }));
  const sources = Array.isArray(data.sources)
    ? data.sources
        .filter((s) => s && typeof s.url === "string" && s.url.trim())
        .map((s) => ({
          url: s.url.trim(),
          headers: (Array.isArray(s.headers) ? s.headers : [])
            .filter(keepRow)
            .map((h) => ({ name: h.name.trim(), value: rowValue(h) })),
        }))
    : [];
  const urlRegex = typeof data.urlRegex === "string" ? data.urlRegex : null;
  const name =
    typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Shared config";
  return { name, headers, sources, urlRegex, dropped };
}
