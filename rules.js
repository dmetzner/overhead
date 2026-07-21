// Firefox exposes the promise-based WebExtension APIs on `browser`; Chrome (121+)
// exposes the same promise API on `chrome`. `browser ?? chrome` picks the
// promise-based namespace on either browser.
const browser = globalThis.browser ?? globalThis.chrome;

export const STORAGE_KEY = "overheadState";

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

function newId() {
  return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function newSource(kind) {
  return { id: newId(), kind, url: "", fileName: "", catalog: [], syncedAt: null, error: null };
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

// Serialize the shareable slice of state to a URL-safe code.
export function encodeConfig(state) {
  const payload = {
    v: CONFIG_VERSION,
    urlRegex: state.urlRegex ?? ".*",
    headers: (state.headers ?? [])
      .filter((h) => h.name && h.name.trim())
      .map((h) => ({ name: h.name.trim(), value: h.value ?? "", enabled: h.enabled !== false })),
    sources: (state.sources ?? [])
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
  if (!data || typeof data !== "object" || !Array.isArray(data.headers)) {
    throw new Error("Config code is malformed.");
  }
  const headers = data.headers
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
  return { headers, sources, urlRegex };
}

const DEFAULT_STATE = {
  urlRegex: DEFAULT_URL_REGEX,
  masterEnabled: true,
  activeTab: "endpoint", // endpoint | manual
  theme: "system", // system | light | dark
  accent: DEFAULT_ACCENT, // key into ACCENTS
  headers: [],
  // Independent header sources - each fetched/imported on its own, all merged into one list.
  // kind: "url" (fetched on refresh) | "file" (imported once via file picker, re-import to update).
  sources: [] // [{ id, kind, url, fileName, catalog: [{ name, value, active }], syncedAt, error }]
};

export async function loadState() {
  const stored = await browser.storage.sync.get(STORAGE_KEY);
  return { ...DEFAULT_STATE, ...(stored[STORAGE_KEY] ?? {}) };
}

export async function saveState(state) {
  await browser.storage.sync.set({ [STORAGE_KEY]: state });
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
  const fromSources = (state.sources ?? [])
    .flatMap((s) => s.catalog ?? [])
    .filter((h) => h.active && h.name.trim() !== "")
    .map((h) => ({ name: h.name.trim(), value: h.value ?? "1" }));
  const manual = state.headers
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
              regexFilter: state.urlRegex?.trim() || DEFAULT_URL_REGEX,
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
