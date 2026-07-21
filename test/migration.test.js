import test from "node:test";
import assert from "node:assert/strict";

// rules.js binds `browser` from globalThis.chrome at import time, so install a
// mutable in-memory stub BEFORE importing it, then reset the stores per test.
const sync = {};
const local = {};
globalThis.chrome = {
  storage: {
    sync: { get: async (k) => ({ [k]: sync[k] }), set: async (o) => Object.assign(sync, o) },
    local: { get: async (k) => ({ [k]: local[k] }), set: async (o) => Object.assign(local, o) }
  }
};
const { loadState, saveState, activeProfile } = await import("../rules.js");

function reset(stored) {
  for (const k of Object.keys(sync)) delete sync[k];
  for (const k of Object.keys(local)) delete local[k];
  if (stored) sync.overheadState = stored;
}

test("legacy flat state migrates into one Default profile without data loss", async () => {
  reset({
    urlRegex: "(shop)\\.dev",
    masterEnabled: true,
    theme: "dark",
    accent: "teal",
    headers: [{ name: "X-Old", value: "1", enabled: true }],
    sources: [
      { id: "s1", kind: "url", url: "https://x.dev/h", catalog: [{ name: "a", value: "1", active: true }], syncedAt: null, error: null }
    ]
  });
  const st = await loadState();
  const p = activeProfile(st);
  assert.equal(st.profiles.length, 1);
  assert.equal(p.name, "Default");
  assert.equal(p.headers.length, 1);
  assert.equal(p.sources.length, 1);
  assert.equal(p.urlRegex, "(shop)\\.dev");
  assert.equal(st.activeProfileId, p.id);
  assert.equal(st.theme, "dark"); // global prefs preserved
  assert.equal(st.headers, undefined); // legacy top-level dropped
  assert.equal(p.sources[0].catalog.length, 1); // inline catalog kept on first load
});

test("saveState keeps catalogs out of the synced item and in storage.local", async () => {
  reset(null);
  const st = await loadState(); // fresh → one empty Default profile
  st.profiles[0].sources = [
    { id: "s1", kind: "url", url: "u", catalog: [{ name: "a", value: "1", active: true }], syncedAt: null, error: null }
  ];
  const res = await saveState(st);
  assert.equal(res.ok, true);
  assert.equal(sync.overheadState.profiles[0].sources[0].catalog, undefined); // stripped from sync
  assert.equal(local.overheadCatalogs.s1.length, 1); // stored in local by source id
});

test("saveState → loadState round-trips the catalog back onto the source", async () => {
  reset(null);
  const st = await loadState();
  st.profiles[0].sources = [{ id: "s1", kind: "url", url: "u", catalog: [{ name: "a", value: "1", active: true }] }];
  await saveState(st);
  const reloaded = await loadState();
  assert.equal(reloaded.profiles[0].sources[0].catalog.length, 1);
});
