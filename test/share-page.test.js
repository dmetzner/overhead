import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { decodeConfig, encodeConfig } from "../rules.js";

/* Parity test for the share-link preview page: docs/i/index.html implements
   the decoder independently (it's a standalone static page), so run its actual
   inline script against a minimal DOM and compare with rules.js' decoder. */

const html = readFileSync(new URL("../docs/i/index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "docs/i/index.html must contain an inline <script>");

function makeEl(tag = "div") {
  const el = {
    tag,
    children: [],
    textContent: "",
    innerHTML: "",
    value: "",
    className: "",
    classes: new Set(),
    append(...kids) {
      el.children.push(...kids);
    },
    addEventListener() {},
    focus() {},
    select() {},
  };
  el.classList = {
    add: (c) => el.classes.add(c),
    remove: (c) => el.classes.delete(c),
    toggle: (c) => (el.classes.has(c) ? el.classes.delete(c) : el.classes.add(c)),
    contains: (c) => el.classes.has(c),
  };
  return el;
}

// Run the page script against a given location.hash; return the stub elements.
function renderPage(hash) {
  const els = {};
  for (const id of ["preview", "empty", "hdrs", "count", "scope", "codeField", "copyCode"]) {
    els[id] = makeEl();
  }
  els.preview.classes.add("hidden");
  els.empty.classes.add("hidden");
  els.codeField.classes.add("hidden");

  const context = {
    document: {
      getElementById: (id) => els[id],
      createElement: (tag) => makeEl(tag),
      createTextNode: (text) => ({ text }),
    },
    location: { hash },
    atob,
    TextDecoder,
    Uint8Array,
    setTimeout,
    navigator: { clipboard: { writeText: async () => {} } },
    console,
  };
  vm.runInNewContext(script, context, { filename: "docs/i/index.html <script>" });
  return els;
}

test("page renders exactly what decodeConfig decodes (v2 with source selections)", () => {
  const state = {
    activeProfileId: "p",
    profiles: [
      {
        id: "p",
        name: "Team",
        urlRegex: "api\\.example\\.dev",
        headers: [
          { name: "X-Env", value: "staging", enabled: true },
          { name: "X-Off", value: "1", enabled: false },
        ],
        sources: [
          {
            id: "s1",
            kind: "url",
            url: "https://x.dev/h",
            catalog: [{ name: "X-Sel", value: "1", active: true }],
          },
        ],
      },
    ],
  };
  const code = encodeConfig(state);
  const decoded = decodeConfig(code);
  const els = renderPage(`#${code}`);

  assert.ok(!els.preview.classes.has("hidden"), "preview is shown");
  assert.ok(els.empty.classes.has("hidden"), "empty state stays hidden");

  const names = els.hdrs.children.map((li) => li.children[0]?.textContent);
  for (const h of decoded.headers) assert.ok(names.includes(h.name), `renders ${h.name}`);
  for (const s of decoded.sources) {
    assert.ok(names.includes("source"), "renders the source row");
    for (const h of s.headers) assert.ok(names.includes(h.name), `renders selection ${h.name}`);
  }

  const total = decoded.headers.length + decoded.sources.flatMap((s) => s.headers).length;
  assert.match(els.count.textContent, new RegExp(`^${total} headers`));
});

test("a malformed percent-encoded fragment fails into the empty state, not a blank page", () => {
  const els = renderPage("#%E0%A4%A"); // decodeURIComponent throws URIError on this
  assert.ok(els.preview.classes.has("hidden"));
  assert.ok(!els.empty.classes.has("hidden"));
});

test("garbage base64 fails into the empty state", () => {
  const els = renderPage("#!!!not-base64!!!");
  assert.ok(els.preview.classes.has("hidden"));
  assert.ok(!els.empty.classes.has("hidden"));
});

test("a future config version asks for an update instead of failing silently", () => {
  const code = Buffer.from(JSON.stringify({ v: 3, headers: [{ name: "A" }] })).toString(
    "base64url",
  );
  const els = renderPage(`#${code}`);
  assert.ok(!els.empty.classes.has("hidden"));
  assert.match(els.empty.textContent, /newer version/);
});
