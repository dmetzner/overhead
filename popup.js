import {
  ACCENTS,
  activeProfile,
  DEFAULT_ACCENT,
  decodeConfig,
  encodeConfig,
  fetchCatalog,
  loadState,
  mergeCatalog,
  newProfile,
  newSource,
  normalizeCatalog,
  SHARE_BASE,
  saveState,
} from "./rules.js";
import { HEADER_BY_NAME, STANDARD_HEADERS } from "./standard-headers.js";

const api = globalThis.browser ?? globalThis.chrome;

const els = {
  master: document.getElementById("master"),
  count: document.getElementById("count"),
  tabs: document.querySelectorAll(".tab"),
  panes: {
    endpoint: document.getElementById("pane-endpoint"),
    manual: document.getElementById("pane-manual"),
  },
  urlRegex: document.getElementById("urlRegex"),
  urlRegexErr: document.getElementById("urlRegexErr"),
  urlRegexInfo: document.getElementById("urlRegexInfo"),
  urlRegexHelp: document.getElementById("urlRegexHelp"),
  endpointInfo: document.getElementById("endpointInfo"),
  endpointHelp: document.getElementById("endpointHelp"),
  // endpoint / sources
  sourceList: document.getElementById("sourceList"),
  newSourceUrl: document.getElementById("newSourceUrl"),
  addSourceUrl: document.getElementById("addSourceUrl"),
  addSourceFile: document.getElementById("addSourceFile"),
  fileInput: document.getElementById("fileInput"),
  refresh: document.getElementById("refresh"),
  status: document.getElementById("status"),
  flagFilter: document.getElementById("flagFilter"),
  catalogList: document.getElementById("catalogList"),
  catalogEmpty: document.getElementById("catalogEmpty"),
  // manual
  list: document.getElementById("headerList"),
  empty: document.getElementById("empty"),
  form: document.getElementById("addForm"),
  newName: document.getElementById("newName"),
  newValue: document.getElementById("newValue"),
  stdHeaders: document.getElementById("stdHeaders"),
  // appearance
  settingsBtn: document.getElementById("settingsBtn"),
  settingsPopover: document.getElementById("settingsPopover"),
  themeSeg: document.getElementById("themeSeg"),
  accentSwatches: document.getElementById("accentSwatches"),
  copyShare: document.getElementById("copyShare"),
  importToggle: document.getElementById("importToggle"),
  importBox: document.getElementById("importBox"),
  importText: document.getElementById("importText"),
  importApply: document.getElementById("importApply"),
  cfgStatus: document.getElementById("cfgStatus"),
  // profiles
  profileSelect: document.getElementById("profileSelect"),
  profRenameInput: document.getElementById("profRenameInput"),
  profNew: document.getElementById("profNew"),
  profDup: document.getElementById("profDup"),
  profRename: document.getElementById("profRename"),
  profDel: document.getElementById("profDel"),
};

let state;

// The active profile owns headers / urlRegex / sources; everything below reads
// and mutates through here so switching profiles swaps the whole working set.
function prof() {
  return activeProfile(state);
}

async function persist() {
  const res = await saveState(state);
  render();
  if (res && !res.ok) setStatus(`Couldn't save: ${res.error}`, "error");
}

function allEntries() {
  return prof().sources.flatMap((s) =>
    (s.catalog ?? []).map((h, i) => ({ ...h, sourceId: s.id, i })),
  );
}

function makeDeleteButton(title, onDelete) {
  const del = document.createElement("button");
  del.className = "del";
  del.type = "button";
  del.textContent = "×";
  del.title = title;
  del.addEventListener("click", () => {
    onDelete();
    persist();
  });
  return del;
}

// Inline text input that commits a trimmed value to state on change, saving
// without a re-render so focus/tab order survive while editing.
function makeEditInput(roleClass, value, placeholder, commit) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = `${roleClass} mono edit`;
  input.value = value;
  input.placeholder = placeholder;
  input.spellcheck = false;
  input.addEventListener("change", () => {
    commit(input.value.trim());
    saveState(state);
  });
  return input;
}

function activeCount() {
  if (!state.masterEnabled) return 0;
  const fromSources = allEntries().filter((h) => h.active).length;
  const manual = prof().headers.filter((h) => h.enabled && h.name.trim() !== "").length;
  return fromSources + manual;
}

/* ---------- file picker ----------
   Firefox auto-closes the toolbar popup as soon as the native file dialog
   opens, destroying this document before the input's change event can fire
   (bugzilla 1292701 / 1658694) — so from the popup, hand the import off to
   this same page opened in a tab, where the picker works. Chrome popups
   show the dialog fine and keep the direct path. */

const IN_TAB = new URLSearchParams(location.search).get("view") === "tab";
const PICKER_NEEDS_TAB = typeof globalThis.browser !== "undefined" && !IN_TAB;

function openFilePicker(sourceId) {
  if (PICKER_NEEDS_TAB) {
    api.tabs.create({ url: api.runtime.getURL("popup.html?view=tab") }).then(() => window.close());
    return;
  }
  if (sourceId) els.fileInput.dataset.sourceId = sourceId;
  else delete els.fileInput.dataset.sourceId;
  els.fileInput.click();
}

/* ---------- endpoint tab ---------- */

function setStatus(text, kind) {
  els.status.textContent = text || "";
  els.status.className = `status${kind ? ` ${kind}` : ""}`;
}

function syncTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function hostLabel(url) {
  try {
    return new URL(url).host;
  } catch {
    return url || "(no URL)";
  }
}

async function refreshSource(source) {
  try {
    const { headers, dropped } = await fetchCatalog(source.url);
    source.catalog = mergeCatalog(source.catalog, headers);
    source.syncedAt = new Date().toISOString();
    source.error = dropped ? `${dropped} malformed row(s) dropped` : null;
  } catch (err) {
    source.error = err.message;
  }
}

async function doRefreshAll() {
  const urlSources = prof().sources.filter((s) => s.kind === "url" && s.url.trim());
  if (!urlSources.length) {
    setStatus("No URL sources to refresh.", "warn");
    return;
  }
  els.refresh.classList.add("spin");
  setStatus("Fetching…", "");
  await Promise.all(urlSources.map(refreshSource));
  await saveState(state);
  els.refresh.classList.remove("spin");

  const failed = urlSources.filter((s) => s.error && !s.catalog.length).length;
  const total = allEntries().length;
  setStatus(
    `${total} headers from ${prof().sources.length} source(s)${failed ? ` · ${failed} failed` : ""}`,
    failed ? "error" : "ok",
  );
  render();
}

async function importIntoSource(source, file) {
  source.fileName = file.name;
  try {
    const text = await file.text();
    const { headers, dropped } = normalizeCatalog(JSON.parse(text));
    source.catalog = mergeCatalog(source.catalog, headers);
    source.syncedAt = new Date().toISOString();
    source.error = dropped ? `${dropped} malformed row(s) dropped` : null;
  } catch (err) {
    source.error = err.message;
  }
}

function renderSources() {
  els.sourceList.innerHTML = "";
  prof().sources.forEach((s, i) => {
    const li = document.createElement("li");
    li.className = "sourcerow";

    const main = document.createElement("div");
    main.className = "sourcemain";

    if (s.kind === "file") {
      const label = document.createElement("span");
      label.className = "name mono";
      label.textContent = `📄 ${s.fileName || "(no file)"}`;
      main.append(label);

      const reimport = document.createElement("button");
      reimport.type = "button";
      reimport.className = "reimport";
      reimport.textContent = "Re-import";
      reimport.addEventListener("click", () => openFilePicker(s.id));
      main.append(reimport);
    } else {
      main.append(
        makeEditInput("name", s.url, "https://…/api/headers", (v) => {
          prof().sources[i].url = v;
        }),
      );
    }

    main.append(makeDeleteButton("Remove source", () => prof().sources.splice(i, 1)));

    const caption = document.createElement("span");
    caption.className = "sourcecaption";
    if (s.error) {
      caption.classList.add("error");
      caption.textContent = s.error;
    } else if (s.syncedAt) {
      caption.textContent = `${(s.catalog ?? []).length} headers · synced ${syncTime(s.syncedAt)}`;
    } else {
      caption.textContent = s.kind === "file" ? "not imported yet" : "not fetched yet";
    }

    li.append(main, caption);
    els.sourceList.append(li);
  });
}

function renderCatalog() {
  const q = els.flagFilter.value.trim().toLowerCase();
  const entries = allEntries();
  const showOrigin = prof().sources.length > 1;
  els.catalogEmpty.classList.toggle("hidden", entries.length > 0);
  els.catalogList.innerHTML = "";

  entries.forEach((h) => {
    if (q && !h.name.toLowerCase().includes(q)) return;
    const source = prof().sources.find((s) => s.id === h.sourceId);
    const li = document.createElement("li");
    li.className = `row${h.active ? "" : " off"}`;

    const toggle = document.createElement("label");
    toggle.className = "switch";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!h.active;
    cb.setAttribute("aria-label", `Send header ${h.name}`);
    cb.addEventListener("change", () => {
      source.catalog[h.i].active = cb.checked;
      persist();
    });
    const slider = document.createElement("span");
    slider.className = "slider";
    toggle.append(cb, slider);

    const kv = document.createElement("span");
    kv.className = "kv";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = h.name;
    const val = makeEditInput("val", h.value, "value", (v) => {
      source.catalog[h.i].value = v;
    });
    kv.append(name, val);
    if (showOrigin) {
      const origin = document.createElement("span");
      origin.className = "fval origin";
      origin.textContent = source.kind === "file" ? source.fileName : hostLabel(source.url);
      kv.append(origin);
    }

    li.append(
      toggle,
      kv,
      makeDeleteButton("Remove", () => source.catalog.splice(h.i, 1)),
    );
    els.catalogList.append(li);
  });
}

/* ---------- manual tab ---------- */

function buildHeader(rawName, rawValue) {
  const name = rawName.trim();
  if (!name) return null;
  return { name, value: rawValue.trim(), enabled: true };
}

// Populate the <datalist> that backs the name field's autocomplete. `label`
// surfaces the browser-controlled note (shown by Chrome next to the option).
function buildHeaderDatalist() {
  els.stdHeaders.innerHTML = "";
  for (const h of STANDARD_HEADERS) {
    const opt = document.createElement("option");
    opt.value = h.name;
    if (h.note) opt.label = h.note;
    els.stdHeaders.append(opt);
  }
}

// When the typed/picked name matches a known header, hint its typical value in
// the (empty) value field's placeholder — non-destructive, never overwrites.
function hintValueFor(name) {
  const match = HEADER_BY_NAME.get(name.trim().toLowerCase());
  els.newValue.placeholder = match?.example || "value";
}

function renderManual() {
  els.list.innerHTML = "";
  els.empty.classList.toggle("hidden", prof().headers.length > 0);

  prof().headers.forEach((h, i) => {
    const li = document.createElement("li");
    li.className = `row${h.enabled ? "" : " off"}`;

    const toggle = document.createElement("label");
    toggle.className = "switch";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = h.enabled;
    cb.setAttribute("aria-label", `Send header ${h.name || "(unnamed)"}`);
    cb.addEventListener("change", () => {
      prof().headers[i].enabled = cb.checked;
      persist();
    });
    const slider = document.createElement("span");
    slider.className = "slider";
    toggle.append(cb, slider);

    const kv = document.createElement("span");
    kv.className = "kv";
    const name = makeEditInput("name", h.name, "", (v) => {
      prof().headers[i].name = v;
    });
    const val = makeEditInput("val", h.value, "value", (v) => {
      prof().headers[i].value = v;
    });
    kv.append(name, val);

    li.append(
      toggle,
      kv,
      makeDeleteButton("Remove", () => prof().headers.splice(i, 1)),
    );
    els.list.append(li);
  });
}

/* ---------- shell ---------- */

function renderProfiles() {
  const sel = els.profileSelect;
  sel.innerHTML = "";
  state.profiles.forEach((p) => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.name;
    if (p.id === state.activeProfileId) o.selected = true;
    sel.append(o);
  });
  els.profDel.disabled = state.profiles.length <= 1;
}

function render() {
  renderProfiles();
  els.master.checked = state.masterEnabled;
  document.body.classList.toggle("master-off", !state.masterEnabled);
  if (document.activeElement !== els.urlRegex) els.urlRegex.value = prof().urlRegex;

  const n = activeCount();
  els.count.textContent = n ? `${n} active` : "";

  els.tabs.forEach((t) => {
    const on = t.dataset.tab === state.activeTab;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on);
  });
  els.panes.endpoint.classList.toggle("hidden", state.activeTab !== "endpoint");
  els.panes.manual.classList.toggle("hidden", state.activeTab !== "manual");

  if (state.activeTab === "endpoint") {
    renderSources();
    renderCatalog();
  } else {
    renderManual();
  }
}

/* ---------- info toggles ---------- */

function wireInfo(btn, help) {
  btn.addEventListener("click", () => {
    const hidden = help.classList.toggle("hidden");
    btn.setAttribute("aria-expanded", String(!hidden));
  });
}
wireInfo(els.urlRegexInfo, els.urlRegexHelp);
wireInfo(els.endpointInfo, els.endpointHelp);

/* ---------- appearance (theme + accent) ---------- */

// Push the chosen theme/accent onto the document. Theme drives the palette via
// a data-theme attribute (absent = follow the OS); accent overrides the CSS
// custom properties inline so it wins over the stylesheet fallback.
function applyAppearance() {
  const root = document.documentElement;
  if (state.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", state.theme);
  const acc = ACCENTS[state.accent] ?? ACCENTS[DEFAULT_ACCENT];
  root.style.setProperty("--accent", acc.base);
  root.style.setProperty("--accent-hi", acc.hi);
}

function buildSwatches() {
  els.accentSwatches.innerHTML = "";
  for (const [key, { base }] of Object.entries(ACCENTS)) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch";
    b.dataset.accent = key;
    b.title = key;
    b.style.background = base;
    b.setAttribute("aria-label", key);
    b.addEventListener("click", () => {
      state.accent = key;
      applyAppearance();
      renderAppearance();
      persist();
    });
    els.accentSwatches.append(b);
  }
}

function renderAppearance() {
  for (const b of els.themeSeg.querySelectorAll("button")) {
    b.setAttribute("aria-pressed", String(b.dataset.theme === state.theme));
  }
  for (const b of els.accentSwatches.querySelectorAll(".swatch")) {
    b.setAttribute("aria-pressed", String(b.dataset.accent === state.accent));
  }
}

for (const b of els.themeSeg.querySelectorAll("button")) {
  b.addEventListener("click", () => {
    state.theme = b.dataset.theme;
    applyAppearance();
    renderAppearance();
    persist();
  });
}

els.settingsBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const hidden = els.settingsPopover.classList.toggle("hidden");
  els.settingsBtn.setAttribute("aria-expanded", String(!hidden));
});
// Click outside closes the popover.
document.addEventListener("click", (e) => {
  if (els.settingsPopover.classList.contains("hidden")) return;
  if (els.settingsPopover.contains(e.target) || els.settingsBtn.contains(e.target)) return;
  els.settingsPopover.classList.add("hidden");
  els.settingsBtn.setAttribute("aria-expanded", "false");
});

/* ---------- config share / import ---------- */

function setCfgStatus(text, kind) {
  els.cfgStatus.textContent = text || "";
  els.cfgStatus.className = `cfgstatus${kind ? ` ${kind}` : ""}`;
}

els.copyShare.addEventListener("click", async () => {
  const link = `${SHARE_BASE}#${encodeConfig(state)}`;
  try {
    await navigator.clipboard.writeText(link);
    setCfgStatus("Link copied ✓ — it carries your header values, share with care.", "ok");
  } catch {
    // clipboard blocked — surface the link so it can be copied by hand
    els.importBox.classList.remove("hidden");
    els.importText.value = link;
    els.importText.select();
    setCfgStatus("Copy the link above.", "");
  }
});

els.importToggle.addEventListener("click", () => {
  const hidden = els.importBox.classList.toggle("hidden");
  els.importToggle.setAttribute("aria-expanded", String(!hidden));
  if (!hidden) els.importText.focus();
  setCfgStatus("", "");
});

els.importApply.addEventListener("click", () => {
  const raw = els.importText.value.trim();
  if (!raw) {
    setCfgStatus("Paste a share link or code first.", "error");
    return;
  }
  let cfg;
  try {
    cfg = decodeConfig(raw);
  } catch (err) {
    setCfgStatus(err.message, "error");
    return;
  }

  // A shared config lands as its own new profile, so it never clobbers the one
  // you're on — then we switch to it.
  const p = newProfile(cfg.name || "Imported");
  p.headers = cfg.headers.map((h) => ({ name: h.name, value: h.value, enabled: h.enabled }));
  p.sources = cfg.sources.map((url) => {
    const s = newSource("url");
    s.url = url;
    return s;
  });
  if (cfg.urlRegex != null) p.urlRegex = cfg.urlRegex;
  // Land it inactive — activating (and thus injecting attacker-chosen headers)
  // must be a deliberate switch in the profile bar, not a side effect of Apply.
  state.profiles.push(p);

  els.importText.value = "";
  els.importBox.classList.add("hidden");
  els.importToggle.setAttribute("aria-expanded", "false");
  const n = p.headers.length;
  const risky =
    p.headers.some((h) =>
      /^(authorization|cookie|proxy-authorization|x-forwarded-for)$/i.test(h.name),
    ) || p.urlRegex === ".*";
  setCfgStatus(
    `Added profile "${p.name}" (${n} header${n === 1 ? "" : "s"}). ` +
      (risky
        ? "Review it before switching — broad scope or credential headers."
        : "Switch to it in the bar above."),
    "ok",
  );
  persist();
});

/* ---------- profiles ---------- */

function beginRename() {
  els.profRenameInput.value = prof().name;
  els.profileSelect.classList.add("hidden");
  els.profRenameInput.classList.remove("hidden");
  els.profRenameInput.focus();
  els.profRenameInput.select();
}

function endRename(commit) {
  if (commit) {
    const v = els.profRenameInput.value.trim();
    if (v) prof().name = v;
  }
  els.profRenameInput.classList.add("hidden");
  els.profileSelect.classList.remove("hidden");
  persist();
}

els.profileSelect.addEventListener("change", () => {
  state.activeProfileId = els.profileSelect.value;
  setStatus("", "");
  persist();
});

els.profNew.addEventListener("click", () => {
  const p = newProfile(`Profile ${state.profiles.length + 1}`);
  state.profiles.push(p);
  state.activeProfileId = p.id;
  persist();
  beginRename();
});

els.profDup.addEventListener("click", () => {
  const a = prof();
  const copy = newProfile(`${a.name} copy`);
  copy.urlRegex = a.urlRegex;
  copy.headers = structuredClone(a.headers);
  copy.sources = structuredClone(a.sources);
  state.profiles.push(copy);
  state.activeProfileId = copy.id;
  persist();
});

els.profRename.addEventListener("click", beginRename);
els.profRenameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") endRename(true);
  else if (e.key === "Escape") endRename(false);
});
els.profRenameInput.addEventListener("blur", () => endRename(true));

let delArmed = false;
function disarmDelete() {
  delArmed = false;
  els.profDel.textContent = "✕";
  els.profDel.title = "Delete profile";
  els.profDel.classList.remove("armed");
}
els.profDel.addEventListener("click", () => {
  if (state.profiles.length <= 1) return;
  // Two-step: a whole profile is destroyed with no undo, so the first click
  // arms and the second (within 3 s) confirms.
  if (!delArmed) {
    delArmed = true;
    els.profDel.textContent = "?";
    els.profDel.title = "Click again to delete this profile";
    els.profDel.classList.add("armed");
    setTimeout(disarmDelete, 3000);
    return;
  }
  disarmDelete();
  const i = state.profiles.findIndex((p) => p.id === state.activeProfileId);
  state.profiles.splice(i, 1);
  state.activeProfileId = state.profiles[Math.max(0, i - 1)].id;
  persist();
});

/* ---------- events ---------- */

for (const t of els.tabs) {
  t.addEventListener("click", () => {
    state.activeTab = t.dataset.tab;
    persist();
  });
}

els.master.addEventListener("change", () => {
  state.masterEnabled = els.master.checked;
  persist();
});

let regexSaveTimer;
els.urlRegex.addEventListener("input", () => {
  const value = els.urlRegex.value.trim();
  try {
    new RegExp(value);
  } catch (err) {
    els.urlRegexErr.textContent = `Invalid regex: ${err.message}`;
    els.urlRegexErr.classList.remove("hidden");
    els.urlRegex.classList.add("bad");
    return; // don't persist a broken pattern — DNR would reject the whole rule
  }
  els.urlRegexErr.classList.add("hidden");
  els.urlRegex.classList.remove("bad");
  prof().urlRegex = value;
  // Validate live, but debounce the storage write + render (sync has a
  // write-rate limit and re-rendering every keystroke is wasteful).
  clearTimeout(regexSaveTimer);
  regexSaveTimer = setTimeout(() => persist(), 300);
});

function addUrlSource() {
  const url = els.newSourceUrl.value.trim();
  if (!url) return;
  const source = newSource("url");
  source.url = url;
  prof().sources.push(source);
  els.newSourceUrl.value = "";
  setStatus("", "");
  persist();
}
els.addSourceUrl.addEventListener("click", addUrlSource);
els.newSourceUrl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addUrlSource();
});

els.addSourceFile.addEventListener("click", () => openFilePicker());
els.fileInput.addEventListener("change", async () => {
  const file = els.fileInput.files[0];
  els.fileInput.value = "";
  if (!file) return;

  const reimportId = els.fileInput.dataset.sourceId;
  let source = reimportId && prof().sources.find((s) => s.id === reimportId);
  if (!source) {
    source = newSource("file");
    prof().sources.push(source);
  }

  await importIntoSource(source, file);
  await persist();
});

els.refresh.addEventListener("click", doRefreshAll);
els.flagFilter.addEventListener("input", renderCatalog);

els.newName.addEventListener("input", () => hintValueFor(els.newName.value));

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const header = buildHeader(els.newName.value, els.newValue.value);
  if (!header) return;
  const dup = prof().headers.find((h) => h.name.toLowerCase() === header.name.toLowerCase());
  if (dup) {
    dup.value = header.value;
    dup.enabled = true;
  } else {
    prof().headers.push(header);
  }
  els.newName.value = "";
  els.newValue.value = "";
  hintValueFor("");
  persist();
  els.newName.focus();
});

(async () => {
  state = await loadState();
  applyAppearance();
  buildSwatches();
  renderAppearance();
  buildHeaderDatalist();
  if (IN_TAB) {
    document.body.classList.add("tabview");
    state.activeTab = "endpoint"; // the tab is only opened for file imports, which live here
  }
  render();
  if (IN_TAB) {
    setStatus(
      "Opened as a tab — Firefox can't show the file dialog from the popup. Pick your file here.",
      "",
    );
  }
})();
