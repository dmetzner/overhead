import { loadState, applyRules, injectionSig, STORAGE_KEY, CATALOG_KEY } from "./rules.js";

// Firefox exposes the promise-based WebExtension APIs on `browser`; Chrome (121+)
// exposes the same promise API on `chrome`. `browser ?? chrome` picks the
// promise-based namespace on either browser.
const browser = globalThis.browser ?? globalThis.chrome;

let lastSig = null;

async function sync() {
  const state = await loadState();
  // Skip the DNR round-trip when nothing injection-relevant changed (e.g. a
  // theme/accent or active-tab edit).
  const sig = injectionSig(state);
  if (sig === lastSig) return;
  lastSig = sig;
  await applyRules(state);
}

browser.runtime.onInstalled.addListener(sync);
browser.runtime.onStartup.addListener(sync);

// Config lives in storage.sync; fetched catalogs (incl. their on/off state) in
// storage.local — watch both so endpoint toggles still re-apply.
browser.storage.onChanged.addListener((changes, area) => {
  if ((area === "sync" && changes[STORAGE_KEY]) || (area === "local" && changes[CATALOG_KEY])) sync();
});
