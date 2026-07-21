// Firefox exposes the promise-based WebExtension APIs on `browser`; Chrome (121+)
// exposes the same promise API on `chrome`. `browser ?? chrome` picks the
// promise-based namespace on either browser.
const browser = globalThis.browser ?? globalThis.chrome;

export const STORAGE_KEY = "overheadState";
// Fetched catalogs are a re-fetchable cache and can be large, so they live in
// storage.local (~5 MB) keyed by source id — keeping the synced config well
// under storage.sync's ~8 KB per-item cap.
export const CATALOG_KEY = "overheadCatalogs";

const DEFAULT_URL_REGEX = ".*";

// Accent presets — shared by the popup swatches and the toolbar badge color.
export const ACCENTS = {
  indigo: { base: "#6366f1", hi: "#818cf8" },
  blue: { base: "#3b82f6", hi: "#60a5fa" },
  teal: { base: "#14b8a6", hi: "#2dd4bf" },
  green: { base: "#22c55e", hi: "#4ade80" },
  amber: { base: "#f59e0b", hi: "#fbbf24" },
  rose: { base: "#f43f5e", hi: "#fb7185" }
};
export const DEFAULT_ACCENT = "indigo";

function newId(prefix = "s") {
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
    (p.headers ?? []).filter((h) => h.enabled && h.name.trim()).map((h) => [h.name.trim(), h.value]),
    (p.sources ?? []).flatMap((s) => (s.catalog ?? []).filter((h) => h.active).map((h) => [h.name, h.value]))
  ]);
}

/* ---------- shareable config ----------
   A config is the portable slice of state — manual headers, the URL scope, and
   any URL sources (file sources are local, so they're left out). It's packed to
   a URL-safe base64 string carried in a link fragment, so sharing is entirely
   client-side: the blob never touches a server. The /i page on the site decodes
   and previews it; the popup's Import pastes it back. */

export const CONFIG_VERSION = 1;
export const SHARE_BASE = "https://overhead.metzner.uk/i";

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(b64) {
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// Serialize the active profile's shareable slice to a URL-safe code.
export function encodeConfig(state) {
  const prof = activeProfile(state);
  const payload = {
    v: CONFIG_VERSION,
    name: prof.name,
    urlRegex: prof.urlRegex ?? ".*",
    headers: (prof.headers ?? [])
      .filter((h) => h.name && h.name.trim())
      .map((h) => ({ name: h.name.trim(), value: h.value ?? "", enabled: h.enabled !== false })),
    sources: (prof.sources ?? [])
      .filter((s) => s.kind === "url" && s.url && s.url.trim())
      .map((s) => ({ url: s.url.trim() }))
  };
  return b64urlEncode(JSON.stringify(payload));
}

// Parse a share code (raw, or a full link — anything after the last "#" is used)
// into { headers, sources, urlRegex }. Throws on a malformed code.
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
  const headers = (Array.isArray(data.headers) ? data.headers : [])
    .filter((h) => h && typeof h.name === "string" && h.name.trim())
    .map((h) => ({
      name: h.name.trim(),
      value: typeof h.value === "string" ? h.value : "",
      enabled: h.enabled !== false
    }));
  const sources = Array.isArray(data.sources)
    ? data.sources.filter((s) => s && typeof s.url === "string" && s.url.trim()).map((s) => s.url.trim())
    : [];
  const urlRegex = typeof data.urlRegex === "string" ? data.urlRegex : null;
  const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Shared config";
  return { name, headers, sources, urlRegex };
}

// Global state holds appearance + which profile is active; each profile owns the
// headers, URL scope, and sources. See newProfile().
const DEFAULT_STATE = {
  masterEnabled: true,
  activeTab: "endpoint", // endpoint | manual
  theme: "system", // system | light | dark
  accent: DEFAULT_ACCENT, // key into ACCENTS
  activeProfileId: null,
  profiles: [] // [{ id, name, urlRegex, headers: [{name,value,enabled}], sources: [...] }]
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
        sources: Array.isArray(raw.sources) ? raw.sources : []
      }
    ];
  }
  // Defensive: guarantee every profile has all fields.
  state.profiles = state.profiles.map((p) => ({
    id: p.id || newId("p"),
    name: typeof p.name === "string" && p.name.trim() ? p.name : "Profile",
    urlRegex: typeof p.urlRegex === "string" ? p.urlRegex : DEFAULT_URL_REGEX,
    headers: Array.isArray(p.headers) ? p.headers : [],
    sources: Array.isArray(p.sources) ? p.sources : []
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
      catalog: Array.isArray(catalogs[s.id]) ? catalogs[s.id] : Array.isArray(s.catalog) ? s.catalog : []
    }));
  }
  return state;
}

// Writes the small config to storage.sync and the bulky catalogs to
// storage.local. Returns {ok} / {ok:false, error} — callers surface failures
// instead of the write silently vanishing. See CATALOG_KEY.
export async function saveState(state) {
  const catalogs = {};
  const synced = {
    ...state,
    profiles: state.profiles.map((p) => ({
      ...p,
      sources: (p.sources ?? []).map(({ catalog, ...rest }) => {
        if (catalog && catalog.length) catalogs[rest.id] = catalog;
        return rest;
      })
    }))
  };
  try {
    await browser.storage.local.set({ [CATALOG_KEY]: catalogs });
    await browser.storage.sync.set({ [STORAGE_KEY]: synced });
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

export async function fetchCatalog(url) {
  const target = (url ?? "").trim();
  if (!target) throw new Error("No endpoint URL configured.");
  let res;
  try {
    res = await fetch(target, { headers: { Accept: "application/json" }, cache: "no-store" });
  } catch {
    throw new Error("Request failed — check the URL and host permissions.");
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

function toRequestHeaders(state) {
  return activeHeaders(state).map((h) => ({
    header: h.name,
    operation: "set",
    value: h.value
  }));
}

export async function applyRules(state) {
  const existing = await browser.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((r) => r.id);
  const requestHeaders = toRequestHeaders(state);

  const addRules =
    requestHeaders.length === 0
      ? []
      : [
          {
            id: 1,
            priority: 1,
            action: { type: "modifyHeaders", requestHeaders },
            condition: {
              regexFilter: activeProfile(state).urlRegex?.trim() || DEFAULT_URL_REGEX,
              resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest", "other"]
            }
          }
        ];

  await browser.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  await updateBadge(requestHeaders.length, state.accent);
}

async function updateBadge(count, accent) {
  const acc = ACCENTS[accent] ?? ACCENTS[DEFAULT_ACCENT];
  await browser.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  await browser.action.setBadgeBackgroundColor({ color: acc.base });
}
