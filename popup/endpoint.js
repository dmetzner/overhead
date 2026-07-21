/* Endpoint tab: URL/file sources, the merged catalog list, and refresh. */

import {
  countChangedActiveValues,
  fetchCatalog,
  headerValueError,
  mergeCatalog,
  newSource,
  normalizeCatalog,
} from "../rules.js";
import { els, makeDeleteButton, makeEditInput, PICKER_NEEDS_TAB, setStatus } from "./dom.js";
import { persist, prof, render } from "./store.js";

const api = globalThis.browser ?? globalThis.chrome;

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

function allEntries() {
  return prof().sources.flatMap((s) =>
    (s.catalog ?? []).map((h, i) => ({ ...h, sourceId: s.id, i })),
  );
}

function openFilePicker(sourceId) {
  if (PICKER_NEEDS_TAB) {
    api.tabs.create({ url: api.runtime.getURL("popup.html?view=tab") }).then(() => window.close());
    return;
  }
  if (sourceId) els.fileInput.dataset.sourceId = sourceId;
  else delete els.fileInput.dataset.sourceId;
  els.fileInput.click();
}

async function refreshSource(source) {
  try {
    const { headers, dropped } = await fetchCatalog(source.url);
    const merged = mergeCatalog(source.catalog, headers);
    // An enabled row whose value changed at the source gets injected with the
    // new value on the next apply — count it (before overwriting the catalog) so
    // a silent swap (e.g. a compromised endpoint rotating a token) is surfaced.
    const changed = countChangedActiveValues(source.catalog, merged);
    source.catalog = merged;
    source.syncedAt = new Date().toISOString();
    source.error = dropped ? `${dropped} malformed row(s) dropped` : null;
    source.stale = false;
    return changed;
  } catch (err) {
    // Keep the cached rows but flag them: they now come from a failed source
    // and may no longer match what the endpoint would serve.
    source.error = err.message;
    source.stale = (source.catalog ?? []).length > 0;
    return 0;
  }
}

async function doRefreshAll() {
  const urlSources = prof().sources.filter((s) => s.kind === "url" && s.url.trim());
  if (!urlSources.length) {
    setStatus("No URL sources to refresh.", "warn");
    return;
  }
  els.refresh.disabled = true; // no duplicate refreshes while one is running
  els.refresh.classList.add("spin");
  setStatus("Fetching…", "");
  let changed = 0;
  try {
    const counts = await Promise.all(urlSources.map(refreshSource));
    changed = counts.reduce((a, b) => a + b, 0);
    await persist({ rerender: false });
  } finally {
    els.refresh.disabled = false;
    els.refresh.classList.remove("spin");
  }

  // Every errored source counts as failed — cached rows don't make a fetch
  // failure a success, they just keep (visibly stale) data around.
  const failed = urlSources.filter((s) => s.error).length;
  const stale = urlSources.filter((s) => s.stale).length;
  setStatus(
    `${allEntries().length} headers from ${prof().sources.length} source(s)` +
      (failed ? ` · ${failed} failed` : "") +
      (stale ? ` · stale data kept` : "") +
      (changed ? ` · ${changed} active value(s) changed at source` : ""),
    failed ? "error" : changed ? "warn" : "ok",
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
    source.stale = false;
  } catch (err) {
    source.error = err.message;
    source.stale = (source.catalog ?? []).length > 0;
  }
}

function sourceCaption(s) {
  const rows = (s.catalog ?? []).length;
  if (s.error && s.stale) {
    return {
      text: `${s.error} — keeping ${rows} stale header(s) from ${syncTime(s.syncedAt)}`,
      error: true,
    };
  }
  if (s.error) return { text: s.error, error: true };
  if (s.syncedAt) return { text: `${rows} headers · synced ${syncTime(s.syncedAt)}`, error: false };
  return { text: s.kind === "file" ? "not imported yet" : "not fetched yet", error: false };
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
      reimport.setAttribute("aria-label", `Re-import file ${s.fileName || "source"}`);
      reimport.addEventListener("click", () => openFilePicker(s.id));
      main.append(reimport);
    } else {
      main.append(
        makeEditInput({
          role: "name",
          value: s.url,
          placeholder: "https://…/api/headers",
          label: "Source endpoint URL",
          commit: (v) => {
            const src = prof().sources[i];
            if (src.url === v) return;
            // A new URL is a new endpoint — the old catalog (and whatever was
            // selected in it) must not keep injecting under the new address.
            src.url = v;
            src.catalog = [];
            src.syncedAt = null;
            src.error = null;
            src.stale = false;
            persist();
          },
        }),
      );
    }

    const sourceName = s.kind === "file" ? s.fileName || "file" : hostLabel(s.url);
    main.append(
      makeDeleteButton(`Remove source ${sourceName}`, () => {
        prof().sources.splice(i, 1);
        persist();
      }),
    );

    const caption = document.createElement("span");
    caption.className = "sourcecaption";
    const { text, error } = sourceCaption(s);
    caption.classList.toggle("error", error);
    caption.textContent = text;

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
    const val = makeEditInput({
      role: "val",
      value: h.value,
      placeholder: "value",
      label: `Value for ${h.name}`,
      validate: headerValueError,
      commit: (v) => {
        source.catalog[h.i].value = v;
        persist({ rerender: false });
      },
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
      makeDeleteButton(`Remove header ${h.name}`, () => {
        source.catalog.splice(h.i, 1);
        persist();
      }),
    );
    els.catalogList.append(li);
  });
}

export function renderEndpoint() {
  renderSources();
  renderCatalog();
}

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

export function initEndpoint() {
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
}
