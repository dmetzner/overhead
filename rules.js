import {
  b64urlEncode,
  CONFIG_VERSION,
  decodeConfig,
  headerNameError,
  headerValueError,
  isBroadScope,
  isCredentialHeader,
} from "./share.js";

// Re-export the shared codec + validation so rules.js stays the single import
// surface for the popup and tests; share.js is the source of truth (and the
// same file, copied to docs/, backs the share-link preview page).
export {
  CONFIG_VERSION,
  decodeConfig,
  headerNameError,
  headerValueError,
  isBroadScope,
  isCredentialHeader,
};

// Firefox exposes the promise-based WebExtension APIs on `browser`; Chrome (121+)
// exposes the same promise API on `chrome`. `browser ?? chrome` picks the
// promise-based namespace on either browser.
const browser = globalThis.browser ?? globalThis.chrome;

export const STORAGE_KEY = "overheadState";
// Fetched catalogs are a re-fetchable cache and can be large, so they live in
// storage.local (~5 MB) keyed by source id — keeping the synced config well
// under storage.sync's ~8 KB per-item cap.
export const CATALOG_KEY = "overheadCatalogs";
// Result of the last declarativeNetRequest update, written by applyRules and
// read by the popup — so the UI never claims "active" when the engine rejected
// the rule. Lives in storage.local (device-specific, not worth syncing).
export const RULE_STATUS_KEY = "overheadRuleStatus";

const DEFAULT_URL_REGEX = ".*";

/* ---------- validation ----------
   updateDynamicRules is atomic: one bad header name/value or an RE2-invalid
   pattern rejects the whole update and nothing is injected. Header name/value
   validation is centralized in share.js (pure, shared verbatim with the
   preview page); urlRegexError stays here because it consults the
   declarativeNetRequest RE2 engine, which only exists in an extension
   context. */

// DNR's regexFilter runs RE2, which is stricter than JS RegExp. Syntax-check
// with RegExp first (fast, works everywhere), then ask the engine itself via
// isRegexSupported where available (extension contexts).
export async function urlRegexError(pattern) {
  const rx = (pattern ?? "").trim() || DEFAULT_URL_REGEX;
  try {
    new RegExp(rx);
  } catch (err) {
    return err.message;
  }
  const dnr = browser?.declarativeNetRequest;
  if (dnr?.isRegexSupported) {
    const res = await dnr.isRegexSupported({ regex: rx });
    if (!res?.isSupported) {
      return res?.reason === "memoryLimitExceeded"
        ? "Pattern is too complex for the request-matching engine (RE2)."
        : "Pattern is not supported by the request-matching engine (RE2).";
    }
  }
  return null;
}

// Accent presets — shared by the popup swatches and the toolbar badge color.
export const ACCENTS = {
  indigo: { base: "#6366f1", hi: "#818cf8" },
  blue: { base: "#3b82f6", hi: "#60a5fa" },
  teal: { base: "#14b8a6", hi: "#2dd4bf" },
  green: { base: "#22c55e", hi: "#4ade80" },
  amber: { base: "#f59e0b", hi: "#fbbf24" },
  rose: { base: "#f43f5e", hi: "#fb7185" },
};
export const DEFAULT_ACCENT = "indigo";

export function newId(prefix = "s") {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function newSource(kind) {
  return { id: newId(), kind, url: "", fileName: "", catalog: [], syncedAt: null, error: null };
}

// A profile is a named, self-contained set: its own headers, URL scope, and
// sources. Only the active profile is injected. Theme/accent/master are global.
export function newProfile(name = "New profile") {
  return { id: newId("p"), name, urlRegex: DEFAULT_URL_REGEX, headers: [], sources: [] };
}

export function activeProfile(state) {
  return state.profiles.find((p) => p.id === state.activeProfileId) ?? state.profiles[0];
}

// Compact fingerprint of everything that affects the injected DNR rule (+ badge
// color). The background script skips rebuilding rules when this is unchanged,
// so theme/accent-only or tab-only edits don't churn declarativeNetRequest.
export function injectionSig(state) {
  const p = activeProfile(state);
  return JSON.stringify([
    state.masterEnabled,
    state.accent,
    p.urlRegex,
    (p.headers ?? [])
      .filter((h) => h.enabled && h.name.trim())
      .map((h) => [h.name.trim(), h.value]),
    (p.sources ?? []).flatMap((s) =>
      (s.catalog ?? []).filter((h) => h.active).map((h) => [h.name, h.value]),
    ),
  ]);
}

/* ---------- shareable config ----------
   A config is the portable slice of state — manual headers, the URL scope, and
   any URL sources (file sources are local, so they're left out). It's packed to
   a URL-safe base64 string carried in a link fragment, so sharing is entirely
   client-side: the blob never touches a server. The /i page on the site decodes
   and previews it (via the same share.js); the popup's Import pastes it back.
   CONFIG_VERSION, b64url*, and decodeConfig live in share.js. */

export const SHARE_BASE = "https://overhead.metzner.uk/i";

// Serialize the active profile's shareable slice to a URL-safe code.
export function encodeConfig(state) {
  const prof = activeProfile(state);
  const sources = (prof.sources ?? [])
    .filter((s) => s.kind === "url" && s.url && s.url.trim())
    .map((s) => {
      const selected = (s.catalog ?? [])
        .filter((h) => h.active && h.name?.trim())
        .map((h) => ({ name: h.name.trim(), value: h.value ?? "1" }));
      return selected.length ? { url: s.url.trim(), headers: selected } : { url: s.url.trim() };
    });
  const payload = {
    v: sources.some((s) => s.headers) ? CONFIG_VERSION : 1,
    name: prof.name,
    urlRegex: prof.urlRegex ?? ".*",
    headers: (prof.headers ?? [])
      .filter((h) => h.name?.trim())
      .map((h) => ({ name: h.name.trim(), value: h.value ?? "", enabled: h.enabled !== false })),
    sources,
  };
  return b64urlEncode(JSON.stringify(payload));
}

// Global state holds appearance + which profile is active; each profile owns the
// headers, URL scope, and sources. See newProfile().
const DEFAULT_STATE = {
  masterEnabled: true,
  activeTab: "endpoint", // endpoint | manual
  theme: "system", // system | light | dark
  accent: DEFAULT_ACCENT, // key into ACCENTS
  activeProfileId: null,
  profiles: [], // [{ id, name, urlRegex, headers: [{name,value,enabled}], sources: [...] }]
};

export async function loadState() {
  const stored = await browser.storage.sync.get(STORAGE_KEY);
  const raw = stored[STORAGE_KEY] ?? {};
  const state = { ...DEFAULT_STATE, ...raw };

  // Migrate the pre-profiles flat shape ({ headers, urlRegex, sources }) into a
  // single "Default" profile.
  if (!Array.isArray(state.profiles) || state.profiles.length === 0) {
    state.profiles = [
      {
        id: newId("p"),
        name: "Default",
        urlRegex: typeof raw.urlRegex === "string" ? raw.urlRegex : DEFAULT_URL_REGEX,
        headers: Array.isArray(raw.headers) ? raw.headers : [],
        sources: Array.isArray(raw.sources) ? raw.sources : [],
      },
    ];
  }
  // Defensive: guarantee every profile has all fields.
  state.profiles = state.profiles.map((p) => ({
    id: p.id || newId("p"),
    name: typeof p.name === "string" && p.name.trim() ? p.name : "Profile",
    urlRegex: typeof p.urlRegex === "string" ? p.urlRegex : DEFAULT_URL_REGEX,
    headers: Array.isArray(p.headers) ? p.headers : [],
    sources: Array.isArray(p.sources) ? p.sources : [],
  }));
  // Drop legacy top-level fields now that they live inside the profile.
  delete state.headers;
  delete state.urlRegex;
  delete state.sources;
  // Resolve the active profile.
  if (!state.activeProfileId || !state.profiles.some((p) => p.id === state.activeProfileId)) {
    state.activeProfileId = state.profiles[0].id;
  }
  // Rehydrate catalogs from storage.local (keep any inline catalog from a
  // pre-split install so the first save can migrate it out of sync).
  const local = await browser.storage.local.get(CATALOG_KEY);
  const catalogs = local[CATALOG_KEY] ?? {};
  for (const p of state.profiles) {
    p.sources = (p.sources ?? []).map((s) => ({
      ...s,
      catalog: Array.isArray(catalogs[s.id])
        ? catalogs[s.id]
        : Array.isArray(s.catalog)
          ? s.catalog
          : [],
    }));
  }
  // Migration: duplicated profiles used to clone sources with their ids, making
  // two sources share one catalog slot (and, after rehydration above, the same
  // array instance). Give later occurrences a fresh id and their own copy; the
  // next save persists the split.
  const seenSourceIds = new Set();
  for (const p of state.profiles) {
    for (const s of p.sources) {
      if (seenSourceIds.has(s.id)) {
        s.id = newId();
        s.catalog = structuredClone(s.catalog);
      }
      seenSourceIds.add(s.id);
    }
  }
  return state;
}

// Writes the small config to storage.sync and the bulky catalogs to
// storage.local. Returns {ok} / {ok:false, error} — callers surface failures
// instead of the write silently vanishing. See CATALOG_KEY.
//
// The two writes can't be one transaction, so: saves are serialized through a
// queue (concurrent persists can't interleave their writes), and sync — the
// source of truth for which sources exist — is written first. If the catalog
// write then fails, the worst case is a source showing "not fetched yet" until
// the next refresh; the reverse order could leave stale catalogs injecting
// under a config that no longer matches them.
let saveQueue = Promise.resolve();

export function saveState(state) {
  const run = saveQueue.then(() => writeState(state));
  saveQueue = run.catch(() => {}); // keep the queue alive after a failed save
  return run;
}

async function writeState(state) {
  const catalogs = {};
  const synced = {
    ...state,
    profiles: state.profiles.map((p) => ({
      ...p,
      sources: (p.sources ?? []).map(({ catalog, ...rest }) => {
        if (catalog?.length) catalogs[rest.id] = catalog;
        return rest;
      }),
    })),
  };
  try {
    await browser.storage.sync.set({ [STORAGE_KEY]: synced });
    await browser.storage.local.set({ [CATALOG_KEY]: catalogs });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

// Validate + coerce an endpoint response into catalog rows.
// Expected shape: { "headers": [ { "name": string, "value": string } ] }
// value is optional and defaults to "1". Returns { headers, dropped }; throws on a bad top-level shape.
export function normalizeCatalog(data) {
  const rows = Array.isArray(data?.headers) ? data.headers : null;
  if (!rows) throw new Error('Expected { "headers": [ … ] }');

  const headers = [];
  let dropped = 0;
  for (const r of rows) {
    const name = typeof r?.name === "string" ? r.name.trim() : "";
    if (!name) {
      dropped++;
      continue;
    }
    const value = r.value == null ? "1" : String(r.value);
    headers.push({ name, value });
  }
  return { headers, dropped };
}

// One stalled endpoint must not hang a refresh forever (the popup awaits all
// sources) — cut every fetch off after this long.
const FETCH_TIMEOUT_MS = 10_000;

export async function fetchCatalog(url) {
  const target = (url ?? "").trim();
  if (!target) throw new Error("No endpoint URL configured.");
  let res;
  try {
    res = await fetch(target, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(
      err?.name === "TimeoutError"
        ? `Timed out after ${FETCH_TIMEOUT_MS / 1000} s.`
        : "Request failed — check the URL and host permissions.",
    );
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("Response was not valid JSON.");
  }
  return normalizeCatalog(data);
}

// Carry the user's per-row active selection across a refetch, matched by name.
// Values stay source-authoritative — they are refreshed from the response.
export function mergeCatalog(prevHeaders, freshHeaders) {
  const prev = new Map((prevHeaders ?? []).map((h) => [h.name, h]));
  return freshHeaders.map((h) => ({ ...h, active: prev.get(h.name)?.active ?? false }));
}

// How many currently-enabled rows had their value changed by the refetch. An
// active row's value is injected as-is on the next apply, so a silent change at
// the source (e.g. a compromised endpoint rotating a token) is worth surfacing.
// Pure so it can be tested without a live refresh; `merged` is mergeCatalog's
// output, `prev` the catalog before the merge.
export function countChangedActiveValues(prev, merged) {
  const before = new Map((prev ?? []).filter((h) => h.active).map((h) => [h.name, h.value]));
  return (merged ?? []).filter(
    (h) => h.active && before.has(h.name) && before.get(h.name) !== h.value,
  ).length;
}

// The headers the active profile currently injects, deduplicated the way DNR
// does (case-insensitive names; manual headers win over source rows).
function activeHeaders(state) {
  if (!state.masterEnabled) return [];
  const prof = activeProfile(state);
  const fromSources = (prof.sources ?? [])
    .flatMap((s) => s.catalog ?? [])
    .filter((h) => h.active && h.name.trim() !== "")
    .map((h) => ({ name: h.name.trim(), value: h.value ?? "1" }));
  const manual = (prof.headers ?? [])
    .filter((h) => h.enabled && h.name.trim() !== "")
    .map((h) => ({ name: h.name.trim(), value: (h.value ?? "").trim() }));

  // Manual headers win on name collision (last-write via Map).
  const byName = new Map();
  for (const h of [...fromSources, ...manual]) byName.set(h.name.toLowerCase(), h);
  return [...byName.values()];
}

// activeHeaders, split into what the engine will accept vs reject. The popup
// count uses `valid` — the exact list applyRules installs — so count, badge,
// and engine can't disagree even when a source served an invalid name.
export function partitionActiveHeaders(state) {
  const valid = [];
  const invalid = [];
  for (const h of activeHeaders(state)) {
    const err = headerNameError(h.name) || headerValueError(h.value);
    if (err) invalid.push({ name: h.name, error: err });
    else valid.push(h);
  }
  return { valid, invalid };
}

// Rebuild the dynamic DNR rule from state and record the outcome under
// RULE_STATUS_KEY. updateDynamicRules is atomic, so this never mixes old and
// new rules — and on any failure it fails closed (removes the old rule rather
// than silently keeping stale headers flowing) and reports why.
export async function applyRules(state) {
  const { valid, invalid } = partitionActiveHeaders(state);
  const status = {
    ok: true,
    applied: 0,
    skipped: invalid,
    error: null,
    at: new Date().toISOString(),
  };
  const regexFilter = activeProfile(state).urlRegex?.trim() || DEFAULT_URL_REGEX;

  let removeRuleIds = [];
  try {
    const regexErr = await urlRegexError(regexFilter);
    removeRuleIds = (await browser.declarativeNetRequest.getDynamicRules()).map((r) => r.id);
    if (regexErr) {
      await browser.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: [] });
      status.ok = false;
      status.error = `URL pattern rejected: ${regexErr}`;
    } else {
      const addRules =
        valid.length === 0
          ? []
          : [
              {
                id: 1,
                priority: 1,
                action: {
                  type: "modifyHeaders",
                  requestHeaders: valid.map((h) => ({
                    header: h.name,
                    operation: "set",
                    value: h.value,
                  })),
                },
                condition: {
                  regexFilter,
                  resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest", "other"],
                },
              },
            ];
      await browser.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
      status.applied = valid.length;
      if (status.skipped.length) {
        status.ok = false;
        status.error = `${status.skipped.length} invalid header(s) skipped: ${status.skipped
          .map((s) => s.name)
          .join(", ")}`;
      }
    }
  } catch (err) {
    status.ok = false;
    status.error = err?.message || String(err);
    // The atomic update was rejected as a whole — clear whatever is installed
    // so a red status never coexists with silently-still-active old rules.
    // Re-fetch the ids: the original failure may have been getDynamicRules
    // itself, leaving removeRuleIds empty.
    try {
      const ids = (await browser.declarativeNetRequest.getDynamicRules()).map((r) => r.id);
      await browser.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: ids,
        addRules: [],
      });
      status.applied = 0;
    } catch {
      // Even the removal failed — nothing more we can do beyond reporting.
    }
  }

  await updateBadge(status, state.accent);
  await browser.storage.local.set({ [RULE_STATUS_KEY]: status });
  return status;
}

async function updateBadge(status, accent) {
  const acc = ACCENTS[accent] ?? ACCENTS[DEFAULT_ACCENT];
  const failed = !status.ok && status.applied === 0 && Boolean(status.error);
  await browser.action.setBadgeText({
    text: failed ? "!" : status.applied > 0 ? String(status.applied) : "",
  });
  await browser.action.setBadgeBackgroundColor({ color: failed ? "#c0453b" : acc.base });
}
