import { loadState, saveState, fetchCatalog, normalizeCatalog, mergeCatalog, newSource } from "./rules.js";

const els = {
  master: document.getElementById("master"),
  count: document.getElementById("count"),
  tabs: document.querySelectorAll(".tab"),
  panes: {
    endpoint: document.getElementById("pane-endpoint"),
    manual: document.getElementById("pane-manual")
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
  newValue: document.getElementById("newValue")
};

let state;

async function persist() {
  await saveState(state);
  render();
}

function allFlags() {
  return state.sources.flatMap((s) => (s.catalog ?? []).map((f, i) => ({ ...f, sourceId: s.id, i })));
}

function activeCount() {
  if (!state.masterEnabled) return 0;
  const flags = allFlags().filter((f) => f.active).length;
  const manual = state.headers.filter((h) => h.enabled && h.name.trim() !== "").length;
  return flags + manual;
}

/* ---------- endpoint tab ---------- */

function setStatus(text, kind) {
  els.status.textContent = text || "";
  els.status.className = "status" + (kind ? " " + kind : "");
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
    const { flags, dropped } = await fetchCatalog(source.url);
    source.catalog = mergeCatalog(source.catalog, flags);
    source.syncedAt = new Date().toISOString();
    source.error = dropped ? `${dropped} malformed row(s) dropped` : null;
  } catch (err) {
    source.error = err.message;
  }
}

async function doRefreshAll() {
  const urlSources = state.sources.filter((s) => s.kind === "url" && s.url.trim());
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
  const total = allFlags().length;
  setStatus(
    `${total} flags from ${state.sources.length} source(s)${failed ? ` · ${failed} failed` : ""}`,
    failed ? "error" : "ok"
  );
  render();
}

async function importIntoSource(source, file) {
  source.fileName = file.name;
  try {
    const text = await file.text();
    const { flags, dropped } = normalizeCatalog(JSON.parse(text));
    source.catalog = mergeCatalog(source.catalog, flags);
    source.syncedAt = new Date().toISOString();
    source.error = dropped ? `${dropped} malformed row(s) dropped` : null;
  } catch (err) {
    source.error = err.message;
  }
}

function renderSources() {
  els.sourceList.innerHTML = "";
  state.sources.forEach((s, i) => {
    const li = document.createElement("li");
    li.className = "sourcerow";

    const main = document.createElement("div");
    main.className = "sourcemain";

    if (s.kind === "file") {
      const label = document.createElement("span");
      label.className = "name mono";
      label.textContent = "📄 " + (s.fileName || "(no file)");
      main.append(label);

      const reimport = document.createElement("button");
      reimport.type = "button";
      reimport.className = "reimport";
      reimport.textContent = "Re-import";
      reimport.addEventListener("click", () => {
        els.fileInput.dataset.sourceId = s.id;
        els.fileInput.click();
      });
      main.append(reimport);
    } else {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "name mono edit";
      input.value = s.url;
      input.placeholder = "https://…/api/flags";
      input.spellcheck = false;
      input.addEventListener("change", () => {
        state.sources[i].url = input.value.trim();
        saveState(state); // no re-render: keep focus while editing
      });
      main.append(input);
    }

    const del = document.createElement("button");
    del.className = "del";
    del.type = "button";
    del.textContent = "×";
    del.title = "Remove source";
    del.addEventListener("click", () => {
      state.sources.splice(i, 1);
      persist();
    });
    main.append(del);

    const caption = document.createElement("span");
    caption.className = "sourcecaption";
    if (s.error) {
      caption.classList.add("error");
      caption.textContent = s.error;
    } else if (s.syncedAt) {
      caption.textContent = `${(s.catalog ?? []).length} flags · synced ${syncTime(s.syncedAt)}`;
    } else {
      caption.textContent = s.kind === "file" ? "not imported yet" : "not fetched yet";
    }

    li.append(main, caption);
    els.sourceList.append(li);
  });
}

function renderCatalog() {
  const q = els.flagFilter.value.trim().toLowerCase();
  const flags = allFlags();
  const showOrigin = state.sources.length > 1;
  els.catalogEmpty.classList.toggle("hidden", flags.length > 0);
  els.catalogList.innerHTML = "";

  flags.forEach((f) => {
    if (q && !f.key.toLowerCase().includes(q)) return;
    const source = state.sources.find((s) => s.id === f.sourceId);
    const li = document.createElement("li");
    li.className = "row" + (f.active ? "" : " off");

    const toggle = document.createElement("label");
    toggle.className = "switch";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!f.active;
    cb.addEventListener("change", () => {
      source.catalog[f.i].active = cb.checked;
      persist();
    });
    const slider = document.createElement("span");
    slider.className = "slider";
    toggle.append(cb, slider);

    const kv = document.createElement("span");
    kv.className = "kv";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = f.key;
    kv.append(name);
    if (f.value !== "" && f.value !== "1") {
      const val = document.createElement("span");
      val.className = "fval mono";
      val.textContent = "= " + f.value;
      kv.append(val);
    }
    if (showOrigin) {
      const origin = document.createElement("span");
      origin.className = "fval origin";
      origin.textContent = source.kind === "file" ? source.fileName : hostLabel(source.url);
      kv.append(origin);
    }

    li.append(toggle, kv);
    els.catalogList.append(li);
  });
}

/* ---------- manual tab ---------- */

function buildHeader(rawName, rawValue) {
  const name = rawName.trim();
  if (!name) return null;
  return { name, value: rawValue.trim(), enabled: true };
}

function renderManual() {
  els.list.innerHTML = "";
  els.empty.classList.toggle("hidden", state.headers.length > 0);

  state.headers.forEach((h, i) => {
    const li = document.createElement("li");
    li.className = "row" + (h.enabled ? "" : " off");

    const toggle = document.createElement("label");
    toggle.className = "switch";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = h.enabled;
    cb.addEventListener("change", () => {
      state.headers[i].enabled = cb.checked;
      persist();
    });
    const slider = document.createElement("span");
    slider.className = "slider";
    toggle.append(cb, slider);

    const kv = document.createElement("span");
    kv.className = "kv";
    const name = document.createElement("input");
    name.type = "text";
    name.className = "name mono edit";
    name.value = h.name;
    name.spellcheck = false;
    name.addEventListener("change", () => {
      state.headers[i].name = name.value.trim();
      saveState(state); // no re-render: keep focus/tab flow while editing
    });
    const val = document.createElement("input");
    val.type = "text";
    val.className = "val mono edit";
    val.value = h.value;
    val.placeholder = "value";
    val.spellcheck = false;
    val.addEventListener("change", () => {
      state.headers[i].value = val.value.trim();
      saveState(state); // no re-render: keep focus/tab flow while editing
    });
    kv.append(name, val);

    const del = document.createElement("button");
    del.className = "del";
    del.type = "button";
    del.textContent = "×";
    del.title = "Remove";
    del.addEventListener("click", () => {
      state.headers.splice(i, 1);
      persist();
    });

    li.append(toggle, kv, del);
    els.list.append(li);
  });
}

/* ---------- shell ---------- */

function render() {
  els.master.checked = state.masterEnabled;
  if (document.activeElement !== els.urlRegex) els.urlRegex.value = state.urlRegex;

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

/* ---------- events ---------- */

els.tabs.forEach((t) =>
  t.addEventListener("click", () => {
    state.activeTab = t.dataset.tab;
    persist();
  })
);

els.master.addEventListener("change", () => {
  state.masterEnabled = els.master.checked;
  persist();
});

els.urlRegex.addEventListener("input", () => {
  const value = els.urlRegex.value.trim();
  try {
    new RegExp(value);
  } catch (err) {
    els.urlRegexErr.textContent = "Invalid regex: " + err.message;
    els.urlRegexErr.classList.remove("hidden");
    els.urlRegex.classList.add("bad");
    return; // don't persist a broken pattern — DNR would reject the whole rule
  }
  els.urlRegexErr.classList.add("hidden");
  els.urlRegex.classList.remove("bad");
  state.urlRegex = value;
  persist();
});

function addUrlSource() {
  const url = els.newSourceUrl.value.trim();
  if (!url) return;
  const source = newSource("url");
  source.url = url;
  state.sources.push(source);
  els.newSourceUrl.value = "";
  setStatus("", "");
  persist();
}
els.addSourceUrl.addEventListener("click", addUrlSource);
els.newSourceUrl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addUrlSource();
});

els.addSourceFile.addEventListener("click", () => {
  delete els.fileInput.dataset.sourceId;
  els.fileInput.click();
});
els.fileInput.addEventListener("change", async () => {
  const file = els.fileInput.files[0];
  els.fileInput.value = "";
  if (!file) return;

  const reimportId = els.fileInput.dataset.sourceId;
  let source = reimportId && state.sources.find((s) => s.id === reimportId);
  if (!source) {
    source = newSource("file");
    state.sources.push(source);
  }

  await importIntoSource(source, file);
  await persist();
});

els.refresh.addEventListener("click", doRefreshAll);
els.flagFilter.addEventListener("input", renderCatalog);

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const header = buildHeader(els.newName.value, els.newValue.value);
  if (!header) return;
  const dup = state.headers.find((h) => h.name.toLowerCase() === header.name.toLowerCase());
  if (dup) {
    dup.value = header.value;
    dup.enabled = true;
  } else {
    state.headers.push(header);
  }
  els.newName.value = "";
  els.newValue.value = "";
  persist();
  els.newName.focus();
});

(async () => {
  state = await loadState();
  render();
})();
