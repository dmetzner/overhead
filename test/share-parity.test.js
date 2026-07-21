import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodeConfig as decodeFromDocs } from "../docs/share.js";
import { decodeConfig as decodeFromRoot } from "../share.js";

/* The share-link preview page (docs/i/index.html) and the extension used to
   carry two hand-written decoders that could silently disagree on what's valid.
   They now share ONE source — share.js — copied verbatim to docs/share.js so
   GitHub Pages can serve it. These tests enforce that the copy stays exact and
   that the page actually delegates to it (no second decoder creeping back in).
   `npm run sync:share` refreshes the copy. */

const root = readFileSync(new URL("../share.js", import.meta.url), "utf8");
const docs = readFileSync(new URL("../docs/share.js", import.meta.url), "utf8");
const page = readFileSync(new URL("../docs/i/index.html", import.meta.url), "utf8");

test("docs/share.js is byte-identical to share.js (run `npm run sync:share`)", () => {
  assert.equal(docs, root, "docs/share.js drifted from share.js — copy is stale");
});

test("both copies decode a config to the same result", () => {
  const code = Buffer.from(
    JSON.stringify({
      v: 2,
      name: "T",
      urlRegex: "api\\.x\\.dev",
      headers: [{ name: "X-Env", value: "staging", enabled: true }],
      sources: [{ url: "https://x.dev/h", headers: [{ name: "X-Sel", value: "1" }] }],
    }),
  ).toString("base64url");
  assert.deepEqual(decodeFromDocs(code), decodeFromRoot(code));
});

test("the preview page delegates decoding to /share.js, not a bespoke copy", () => {
  const script = page.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "preview page must have a module script");
  assert.match(script, /import\s*\{\s*decodeConfig\s*\}\s*from\s*"\/share\.js"/);
  // No re-implemented decoder: the raw primitives live only in share.js now.
  assert.doesNotMatch(script, /\batob\b|\bb64urlDecode\b|JSON\.parse/);
});
