export const STORAGE_KEY = "niceHeaderState";

const DEFAULT_URL_REGEX = ".*";

function newId() {
  return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function newSource(kind) {
  return { id: newId(), kind, url: "", fileName: "", catalog: [], syncedAt: null, error: null };
}

const DEFAULT_STATE = {
  urlRegex: DEFAULT_URL_REGEX,
  masterEnabled: true,
  activeTab: "endpoint", // endpoint | manual
  headers: [],
  // Independent flag sources - each fetched/imported on its own, all merged into one list.
  // kind: "url" (fetched on refresh) | "file" (imported once via file picker, re-import to update).
  sources: [] // [{ id, kind, url, fileName, catalog: [{ key, value, active }], syncedAt, error }]
};

export async function loadState() {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  return { ...DEFAULT_STATE, ...(stored[STORAGE_KEY] ?? {}) };
}

export async function saveState(state) {
  await chrome.storage.sync.set({ [STORAGE_KEY]: state });
}

// Validate + coerce an endpoint response into catalog rows.
// Expected shape: { "flags": [ { "key": string, "value": string } ] }
// value is optional and defaults to "1". Returns { flags, dropped }; throws on a bad top-level shape.
export function normalizeCatalog(data) {
  const rows = Array.isArray(data?.flags) ? data.flags : null;
  if (!rows) throw new Error('Expected { "flags": [ … ] }');

  const flags = [];
  let dropped = 0;
  for (const r of rows) {
    const key = typeof r?.key === "string" ? r.key.trim() : "";
    if (!key) {
      dropped++;
      continue;
    }
    const value = r.value == null ? "1" : String(r.value);
    flags.push({ key, value });
  }
  return { flags, dropped };
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

// Carry the user's per-flag active selection across a refetch, matched by key.
// Values stay source-authoritative — they are refreshed from the response.
export function mergeCatalog(prevFlags, freshFlags) {
  const prev = new Map((prevFlags ?? []).map((f) => [f.key, f]));
  return freshFlags.map((f) => ({ ...f, active: prev.get(f.key)?.active ?? false }));
}

function activeHeaders(state) {
  if (!state.masterEnabled) return [];
  const fromFlags = (state.sources ?? [])
    .flatMap((s) => s.catalog ?? [])
    .filter((f) => f.active && f.key.trim() !== "")
    .map((f) => ({ name: f.key.trim(), value: f.value ?? "1" }));
  const manual = state.headers
    .filter((h) => h.enabled && h.name.trim() !== "")
    .map((h) => ({ name: h.name.trim(), value: (h.value ?? "").trim() }));

  // Manual headers win on name collision (last-write via Map).
  const byName = new Map();
  for (const h of [...fromFlags, ...manual]) byName.set(h.name.toLowerCase(), h);
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
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
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

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  await updateBadge(requestHeaders.length);
}

async function updateBadge(count) {
  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#F39200" });
}
