/* Shared popup state: the loaded state object, the active profile, and the
   persist + render plumbing every feature module goes through. */

import { activeProfile, loadState, saveState } from "../rules.js";
import { setGlobalError } from "./dom.js";

let state = null;
let renderFn = () => {};

export function getState() {
  return state;
}

// The active profile owns headers / urlRegex / sources; feature modules read
// and mutate through here so switching profiles swaps the whole working set.
export function prof() {
  return activeProfile(state);
}

// app.js registers the composite renderer; modules just call render().
export function setRenderer(fn) {
  renderFn = fn;
}

export function render() {
  renderFn();
}

export async function initState() {
  state = await loadState();
  return state;
}

// Persist state and surface any failure on the global banner — a save must
// never fail silently, whichever pane is open. Pass rerender:false for inline
// edits where a re-render would destroy focus.
export async function persist({ rerender = true } = {}) {
  const res = await saveState(state);
  if (rerender) render();
  setGlobalError("save", res.ok ? "" : `Couldn't save: ${res.error}`);
  return res;
}
