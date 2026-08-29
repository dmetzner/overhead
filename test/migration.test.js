import assert from "node:assert/strict";
import test from "node:test";

// rules.js binds `browser` from globalThis.chrome at import time, so install a
// mutable in-memory stub BEFORE importing it, then reset the stores per test.
const sync = {};
const local = {};
globalThis.chrome = {
  storage: {
    sync: { get: async (k) => ({ [k]: sync[k] }), set: async (o) => Object.assign(sync, o) },
    local: { get: async (k) => ({ [k]: local[k] }), set: async (o) => Object.assign(local, o) },
  },
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
      {
        id: "s1",
        kind: "url",
        url: "https://x.dev/h",
        catalog: [{ name: "a", value: "1", active: true }],
        syncedAt: null,
        error: null,
      },
    ],
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
    {
      id: "s1",
      kind: "url",
      url: "u",
      catalog: [{ name: "a", value: "1", active: true }],
      syncedAt: null,
      error: null,
    },
  ];
  const res = await saveState(st);
  assert.equal(res.ok, true);
  assert.equal(sync.overheadState.profiles[0].sources[0].catalog, undefined); // stripped from sync
  assert.equal(local.overheadCatalogs.s1.length, 1); // stored in local by source id
});

test("saveState → loadState round-trips the catalog back onto the source", async () => {
  reset(null);
  const st = await loadState();
  st.profiles[0].sources = [
    { id: "s1", kind: "url", url: "u", catalog: [{ name: "a", value: "1", active: true }] },
  ];
  await saveState(st);
  const reloaded = await loadState();
  assert.equal(reloaded.profiles[0].sources[0].catalog.length, 1);
});

test("duplicated source ids get split into fresh ids with their own catalog copy", async () => {
  // Pre-fix profile duplication cloned sources including their ids — both
  // profiles then shared one catalog slot in storage.local.
  reset({
    activeProfileId: "p1",
    profiles: [
      {
        id: "p1",
        name: "A",
        urlRegex: ".*",
        headers: [],
        sources: [{ id: "s1", kind: "url", url: "u" }],
      },
      {
        id: "p2",
        name: "A copy",
        urlRegex: ".*",
        headers: [],
        sources: [{ id: "s1", kind: "url", url: "u" }],
      },
    ],
  });
  local.overheadCatalogs = { s1: [{ name: "a", value: "1", active: true }] };

  const st = await loadState();
  const [s1] = st.profiles[0].sources;
  const [s2] = st.profiles[1].sources;
  assert.notEqual(s1.id, s2.id); // fresh id for the later occurrence
  assert.deepEqual(s2.catalog, s1.catalog); // same content…
  s2.catalog[0].value = "changed";
  assert.equal(s1.catalog[0].value, "1"); // …but no longer the same array

  // After a save, each id owns its own catalog slot.
  await saveState(st);
  assert.equal(Object.keys(local.overheadCatalogs).length, 2);
});

test("saveState writes sync (source of truth) before local catalogs", async () => {
  reset(null);
  const order = [];
  const origSync = globalThis.chrome.storage.sync.set;
  const origLocal = globalThis.chrome.storage.local.set;
  globalThis.chrome.storage.sync.set = async (o) => {
    order.push("sync");
    return origSync(o);
  };
  globalThis.chrome.storage.local.set = async (o) => {
    order.push("local");
    return origLocal(o);
  };
  const st = await loadState();
  await saveState(st);
  globalThis.chrome.storage.sync.set = origSync;
  globalThis.chrome.storage.local.set = origLocal;
  assert.deepEqual(order, ["sync", "local"]);
});

test("saveState reports a failed write instead of losing it", async () => {
  reset(null);
  const st = await loadState();
  const orig = globalThis.chrome.storage.sync.set;
  globalThis.chrome.storage.sync.set = async () => {
    throw new Error("QUOTA_BYTES exceeded");
  };
  const res = await saveState(st);
  globalThis.chrome.storage.sync.set = orig;
  assert.equal(res.ok, false);
  assert.match(res.error, /QUOTA_BYTES/);
  // and the queue keeps working afterwards
  const res2 = await saveState(st);
  assert.equal(res2.ok, true);
});
