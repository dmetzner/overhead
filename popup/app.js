/* Popup entry point: bootstraps state, composes the render pass, and owns the
   shell (master switch, tabs, URL scope, rule-status banner). */

import { partitionActiveHeaders, RULE_STATUS_KEY, urlRegexError } from "../rules.js";
import { els, IN_TAB, setGlobalError, setStatus } from "./dom.js";
import { initEndpoint, renderEndpoint } from "./endpoint.js";
import { initManual, renderManual } from "./manual.js";
import { initProfiles, renderProfiles } from "./profiles.js";
import { applyAppearance, initSettings, renderAppearance } from "./settings.js";
import { getState, initState, persist, prof, setRenderer } from "./store.js";

const api = globalThis.browser ?? globalThis.chrome;

function render() {
  const state = getState();
  renderProfiles();
  els.master.checked = state.masterEnabled;
  document.body.classList.toggle("master-off", !state.masterEnabled);
  if (document.activeElement !== els.urlRegex) els.urlRegex.value = prof().urlRegex;

  // Same list the DNR rule is built from — the popup count, the badge, and the
  // engine can't disagree (engine-invalid rows are skipped there too).
  const n = partitionActiveHeaders(state).valid.length;
  els.count.textContent = n ? `${n} active` : "";

  els.tabs.forEach((t) => {
    const on = t.dataset.tab === state.activeTab;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on);
    t.tabIndex = on ? 0 : -1; // roving tabindex; arrows move between tabs
  });
  els.panes.endpoint.classList.toggle("hidden", state.activeTab !== "endpoint");
  els.panes.manual.classList.toggle("hidden", state.activeTab !== "manual");

  if (state.activeTab === "endpoint") renderEndpoint();
  else renderManual();
}

/* ---------- rule status ----------
   applyRules (in the background script) records whether the engine actually
   accepted the last update. Mirror that here so the popup never claims headers
   are active while the real rule failed to install. */

function showRuleStatus(status) {
  setGlobalError("rules", status && !status.ok ? `Rules not applied: ${status.error}` : "");
}

async function watchRuleStatus() {
  const stored = await api.storage.local.get(RULE_STATUS_KEY);
  showRuleStatus(stored[RULE_STATUS_KEY]);
  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[RULE_STATUS_KEY]) {
      showRuleStatus(changes[RULE_STATUS_KEY].newValue);
    }
  });
}

/* ---------- shell events ---------- */

function wireInfo(btn, help) {
  btn.addEventListener("click", () => {
    const hidden = help.classList.toggle("hidden");
    btn.setAttribute("aria-expanded", String(!hidden));
  });
}

function initShell() {
  wireInfo(els.urlRegexInfo, els.urlRegexHelp);
  wireInfo(els.endpointInfo, els.endpointHelp);

  els.master.addEventListener("change", () => {
    getState().masterEnabled = els.master.checked;
    persist();
  });

  const tabList = [...els.tabs];
  tabList.forEach((t, i) => {
    t.addEventListener("click", () => {
      getState().activeTab = t.dataset.tab;
      persist();
    });
    t.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const next =
        tabList[(i + (e.key === "ArrowRight" ? 1 : -1) + tabList.length) % tabList.length];
      getState().activeTab = next.dataset.tab;
      persist();
      next.focus();
    });
  });

  let regexSaveTimer;
  let regexCheckSeq = 0;
  els.urlRegex.addEventListener("input", async () => {
    const value = els.urlRegex.value.trim();
    // Validate against the engine that will actually run the pattern (RE2 via
    // isRegexSupported), not just JS RegExp — they disagree on real patterns.
    const seq = ++regexCheckSeq;
    const err = await urlRegexError(value);
    if (seq !== regexCheckSeq) return; // a newer keystroke superseded this check
    els.urlRegexErr.textContent = err ? `Invalid pattern: ${err}` : "";
    els.urlRegexErr.classList.toggle("hidden", !err);
    els.urlRegex.classList.toggle("bad", Boolean(err));
    if (err) return; // don't persist a broken pattern — DNR would reject the whole rule
    prof().urlRegex = value;
    // Validate live, but debounce the storage write + render (sync has a
    // write-rate limit and re-rendering every keystroke is wasteful).
    clearTimeout(regexSaveTimer);
    regexSaveTimer = setTimeout(() => persist(), 300);
  });
}

/* ---------- boot ---------- */

(async () => {
  await initState();
  setRenderer(render);
  applyAppearance();
  renderAppearance();
  initSettings();
  initProfiles();
  initEndpoint();
  initManual();
  initShell();
  watchRuleStatus();
  if (IN_TAB) {
    document.body.classList.add("tabview");
    getState().activeTab = "endpoint"; // the tab is only opened for file imports, which live here
  }
  render();
  if (IN_TAB) {
    setStatus(
      "Opened as a tab — Firefox can't show the file dialog from the popup. Pick your file here.",
      "",
    );
  }
})();
