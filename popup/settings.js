/* Settings popover: theme + accent, and config share / import. */

import {
  ACCENTS,
  DEFAULT_ACCENT,
  decodeConfig,
  encodeConfig,
  newProfile,
  newSource,
  SHARE_BASE,
  urlRegexError,
} from "../rules.js";
import { els } from "./dom.js";
import { getState, persist } from "./store.js";

/* ---------- appearance ---------- */

// Push the chosen theme/accent onto the document. Theme drives the palette via
// a data-theme attribute (absent = follow the OS); accent overrides the CSS
// custom properties inline so it wins over the stylesheet fallback.
export function applyAppearance() {
  const state = getState();
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
      getState().accent = key;
      applyAppearance();
      renderAppearance();
      persist();
    });
    els.accentSwatches.append(b);
  }
}

export function renderAppearance() {
  for (const b of els.themeSeg.querySelectorAll("button")) {
    b.setAttribute("aria-pressed", String(b.dataset.theme === getState().theme));
  }
  for (const b of els.accentSwatches.querySelectorAll(".swatch")) {
    b.setAttribute("aria-pressed", String(b.dataset.accent === getState().accent));
  }
}

/* ---------- popover open/close with focus management ---------- */

function setPopoverOpen(open, { refocus = true } = {}) {
  els.settingsPopover.classList.toggle("hidden", !open);
  els.settingsBtn.setAttribute("aria-expanded", String(open));
  if (open) {
    els.settingsPopover.querySelector("button")?.focus();
  } else if (refocus) {
    els.settingsBtn.focus();
  }
}

function isPopoverOpen() {
  return !els.settingsPopover.classList.contains("hidden");
}

/* ---------- config share / import ---------- */

function setCfgStatus(text, kind) {
  els.cfgStatus.textContent = text || "";
  els.cfgStatus.className = `cfgstatus${kind ? ` ${kind}` : ""}`;
}

async function applyImport() {
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
  p.sources = cfg.sources.map(({ url, headers }) => {
    const s = newSource("url");
    s.url = url;
    // v2 shares carry the sender's selected rows — prefill them active so the
    // profile works immediately; the next refresh re-syncs values by name.
    s.catalog = headers.map((h) => ({ ...h, active: true }));
    return s;
  });
  // Keep the pattern even if invalid — applyRules fails closed and reports it,
  // which beats silently widening the scope. But warn right here.
  const regexErr = cfg.urlRegex != null ? await urlRegexError(cfg.urlRegex) : null;
  if (cfg.urlRegex != null) p.urlRegex = cfg.urlRegex;
  // Land it inactive — activating (and thus injecting attacker-chosen headers)
  // must be a deliberate switch in the profile bar, not a side effect of Apply.
  getState().profiles.push(p);

  els.importText.value = "";
  els.importBox.classList.add("hidden");
  els.importToggle.setAttribute("aria-expanded", "false");
  const n = p.headers.length + p.sources.reduce((sum, s) => sum + s.catalog.length, 0);
  const risky =
    p.headers.some((h) =>
      /^(authorization|cookie|proxy-authorization|x-forwarded-for)$/i.test(h.name),
    ) || p.urlRegex === ".*";
  const notes = [];
  if (cfg.dropped) notes.push(`${cfg.dropped} invalid row(s) dropped`);
  if (regexErr) notes.push("its URL pattern is invalid — fix it before switching");
  if (risky) notes.push("review it before switching — broad scope or credential headers");
  setCfgStatus(
    `Added profile "${p.name}" (${n} header${n === 1 ? "" : "s"}). ` +
      (notes.length ? `${notes.join("; ")}.` : "Switch to it in the bar above."),
    regexErr || cfg.dropped ? "error" : "ok",
  );
  persist();
}

export function initSettings() {
  buildSwatches();

  for (const b of els.themeSeg.querySelectorAll("button")) {
    b.addEventListener("click", () => {
      getState().theme = b.dataset.theme;
      applyAppearance();
      renderAppearance();
      persist();
    });
  }

  els.settingsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setPopoverOpen(!isPopoverOpen(), { refocus: false });
  });
  // Click outside closes the popover.
  document.addEventListener("click", (e) => {
    if (!isPopoverOpen()) return;
    if (els.settingsPopover.contains(e.target) || els.settingsBtn.contains(e.target)) return;
    setPopoverOpen(false, { refocus: false });
  });
  // Escape closes it and puts focus back on the gear.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isPopoverOpen()) {
      e.stopPropagation();
      setPopoverOpen(false);
    }
  });

  els.copyShare.addEventListener("click", async () => {
    const link = `${SHARE_BASE}#${encodeConfig(getState())}`;
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

  els.importApply.addEventListener("click", applyImport);
}
