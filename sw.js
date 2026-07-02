import { loadState, applyRules, STORAGE_KEY } from "./rules.js";

async function sync() {
  const state = await loadState();
  await applyRules(state);
}

chrome.runtime.onInstalled.addListener(sync);
chrome.runtime.onStartup.addListener(sync);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes[STORAGE_KEY]) sync();
});
