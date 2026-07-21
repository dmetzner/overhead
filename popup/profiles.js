/* Profile bar: switch, create, duplicate, rename, delete. */

import { newId, newProfile } from "../rules.js";
import { els, setStatus } from "./dom.js";
import { getState, persist, prof } from "./store.js";

export function renderProfiles() {
  const sel = els.profileSelect;
  sel.innerHTML = "";
  getState().profiles.forEach((p) => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.name;
    if (p.id === getState().activeProfileId) o.selected = true;
    sel.append(o);
  });
  els.profDel.disabled = getState().profiles.length <= 1;
}

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

// Duplicate the active profile. Every copied source gets a fresh id — catalogs
// are stored globally by source id, so a shared id would make the original and
// the copy overwrite each other's catalog on every save.
function duplicateProfile() {
  const a = prof();
  const copy = newProfile(`${a.name} copy`);
  copy.urlRegex = a.urlRegex;
  copy.headers = structuredClone(a.headers);
  copy.sources = a.sources.map((s) => ({ ...structuredClone(s), id: newId() }));
  getState().profiles.push(copy);
  getState().activeProfileId = copy.id;
  persist();
}

let delArmed = false;
function disarmDelete() {
  delArmed = false;
  els.profDel.textContent = "✕";
  els.profDel.title = "Delete profile";
  els.profDel.classList.remove("armed");
}

export function initProfiles() {
  els.profileSelect.addEventListener("change", () => {
    getState().activeProfileId = els.profileSelect.value;
    setStatus("", "");
    persist();
  });

  els.profNew.addEventListener("click", () => {
    const p = newProfile(`Profile ${getState().profiles.length + 1}`);
    getState().profiles.push(p);
    getState().activeProfileId = p.id;
    persist();
    beginRename();
  });

  els.profDup.addEventListener("click", duplicateProfile);

  els.profRename.addEventListener("click", beginRename);
  els.profRenameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") endRename(true);
    else if (e.key === "Escape") endRename(false);
  });
  els.profRenameInput.addEventListener("blur", () => endRename(true));

  els.profDel.addEventListener("click", () => {
    const state = getState();
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
}
