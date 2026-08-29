/* Manual tab: hand-typed headers with autocomplete hints. */

import { headerNameError, headerValueError } from "../rules.js";
import { HEADER_BY_NAME, STANDARD_HEADERS } from "../standard-headers.js";
import { els, makeDeleteButton, makeEditInput } from "./dom.js";
import { persist, prof } from "./store.js";

function setFormError(text) {
  els.formErr.textContent = text || "";
  els.formErr.classList.toggle("hidden", !text);
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

export function renderManual() {
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
    const name = makeEditInput({
      role: "name",
      value: h.name,
      label: "Header name",
      validate: headerNameError,
      commit: (v) => {
        prof().headers[i].name = v;
        persist({ rerender: false });
      },
    });
    const val = makeEditInput({
      role: "val",
      value: h.value,
      placeholder: "value",
      label: `Value for ${h.name || "header"}`,
      validate: headerValueError,
      commit: (v) => {
        prof().headers[i].value = v;
        persist({ rerender: false });
      },
    });
    kv.append(name, val);

    li.append(
      toggle,
      kv,
      makeDeleteButton(`Remove header ${h.name || "(unnamed)"}`, () => {
        prof().headers.splice(i, 1);
        persist();
      }),
    );
    els.list.append(li);
  });
}

export function initManual() {
  buildHeaderDatalist();

  els.newName.addEventListener("input", () => hintValueFor(els.newName.value));

  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = els.newName.value.trim();
    const value = els.newValue.value.trim();
    if (!name) return;
    // Reject what the engine would reject — one bad header would otherwise
    // void the whole atomic DNR update later.
    const err = headerNameError(name) || headerValueError(value);
    setFormError(err);
    if (err) return;
    const dup = prof().headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
    if (dup) {
      dup.value = value;
      dup.enabled = true;
    } else {
      prof().headers.push({ name, value, enabled: true });
    }
    els.newName.value = "";
    els.newValue.value = "";
    hintValueFor("");
    persist();
    els.newName.focus();
  });
}
