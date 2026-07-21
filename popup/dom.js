/* DOM lookups, environment flags, and tiny UI builders shared by the popup
   modules. Dependency-free — persistence side effects stay with the callers. */

export const els = {
  master: document.getElementById("master"),
  count: document.getElementById("count"),
  globalErr: document.getElementById("globalErr"),
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
  formErr: document.getElementById("formErr"),
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

/* Firefox auto-closes the toolbar popup as soon as the native file dialog
   opens, destroying this document before the input's change event can fire
   (bugzilla 1292701 / 1658694) — so from the popup, hand the import off to
   this same page opened in a tab, where the picker works. Chrome popups
   show the dialog fine and keep the direct path. */
export const IN_TAB = new URLSearchParams(location.search).get("view") === "tab";
export const PICKER_NEEDS_TAB = typeof globalThis.browser !== "undefined" && !IN_TAB;

// The one save/rule error surface — pinned above the tabs so a failure is
// visible no matter which pane is open. Errors are keyed by their source
// ("save", "rules") so a successful save can't wipe a still-failing rule
// status, and vice versa; a source only clears its own entry.
const globalErrors = new Map();

export function setGlobalError(key, text) {
  if (text) globalErrors.set(key, text);
  else globalErrors.delete(key);
  const msg = [...globalErrors.values()].join(" · ");
  els.globalErr.textContent = msg;
  els.globalErr.classList.toggle("hidden", !msg);
}

// Endpoint-pane status line (fetch results, hints).
export function setStatus(text, kind) {
  els.status.textContent = text || "";
  els.status.className = `status${kind ? ` ${kind}` : ""}`;
}

export function makeDeleteButton(label, onClick) {
  const del = document.createElement("button");
  del.className = "del";
  del.type = "button";
  del.textContent = "×";
  del.title = label;
  del.setAttribute("aria-label", label);
  del.addEventListener("click", onClick);
  return del;
}

// Inline text input that commits a trimmed value on change, so focus/tab order
// survive while editing (committing is the caller's job — it decides whether
// to re-render). An invalid value is flagged on the field and never committed.
export function makeEditInput({ role, value, placeholder = "", label, validate, commit }) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = `${role} mono edit`;
  input.value = value;
  input.placeholder = placeholder;
  input.spellcheck = false;
  if (label) input.setAttribute("aria-label", label);
  input.addEventListener("change", () => {
    const v = input.value.trim();
    const err = validate ? validate(v) : null;
    input.classList.toggle("bad", Boolean(err));
    input.title = err ?? "";
    if (!err) commit(v);
  });
  return input;
}
