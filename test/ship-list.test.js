import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

// The set of files that make up the shipped extension is written down in four
// places: `.github/runtime-paths.txt` (which decides whether a change owes a
// version bump and a release) and one shell list in each of the three shipping
// workflows. A shell word list is not a regex, so they cannot literally be the
// same string — but they must describe the same set, or the estate lies in one
// of two directions: a new runtime file that ships but never triggers a release,
// or one that forces releases while never reaching a store zip.
//
// This test is what makes that drift fail CI instead of shipping.

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/** The declared source of truth, with directory markers stripped. */
const declared = new Set(
  read(".github/runtime-paths.txt")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.replace(/\/$/, "")),
);

/** Pull one shell word list out of a workflow, by the line that carries it. */
function shipList(workflow, pattern, drop = []) {
  const text = read(`.github/workflows/${workflow}`);
  const m = text.match(pattern);
  assert.ok(
    m,
    `could not find the ship-list in ${workflow} — the line shape changed, so this test can no longer see what that workflow ships. Re-anchor the pattern.`,
  );
  return new Set(
    m[1]
      .trim()
      .split(/\s+/)
      .filter((w) => !drop.includes(w)),
  );
}

const lists = {
  // shared="sw.js rules.js …"  — plus manifest.json, added on the zip line
  "pack.yml": new Set([...shipList("pack.yml", /^\s*shared="([^"]+)"/m), "manifest.json"]),
  // cp -r manifest.json … dist/
  "sign-firefox.yml": shipList("sign-firefox.yml", /^\s*cp -r (.+) dist\/$/m),
  // zip -r "overhead-chrome.zip" \\\n  manifest.json … \\
  "publish-chrome.yml": shipList("publish-chrome.yml", /^\s*(manifest\.json .+?) \\$/m),
};

for (const [workflow, shipped] of Object.entries(lists)) {
  test(`${workflow} ships exactly the declared runtime paths`, () => {
    const missing = [...declared].filter((p) => !shipped.has(p));
    const extra = [...shipped].filter((p) => !declared.has(p));
    assert.deepEqual(
      { missing, extra },
      { missing: [], extra: [] },
      `${workflow} disagrees with .github/runtime-paths.txt — ` +
        `missing from ${workflow}: [${missing}]; not declared as runtime: [${extra}]`,
    );
  });
}

test("the declared runtime paths all exist in the repo", () => {
  for (const p of declared) {
    assert.ok(
      existsSync(new URL(`../${p}`, import.meta.url)),
      `.github/runtime-paths.txt lists "${p}", which is not in the repo`,
    );
  }
});

// The regex both gates match changed paths against. Its failure mode is silent:
// a wrong escape yields a pattern that matches nothing, so the gates stop firing
// and every release check quietly passes. So assert the exact string, and the
// two anchoring decisions that make it correct.
const runtimeRegex = () =>
  execFileSync(new URL("../.github/runtime-regex.sh", import.meta.url).pathname, {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf8",
  }).trim();

test("the runtime regex is built from the declaration, correctly escaped", () => {
  const expected = [...declared]
    .map((p) => {
      const escaped = p.replace(/\./g, "\\.");
      // A directory entry keeps its trailing slash and is anchored at the front
      // only; a file entry is anchored at both ends.
      return read(".github/runtime-paths.txt").includes(`${p}/`) ? `^${escaped}/` : `^${escaped}$`;
    })
    .join("|");
  assert.equal(runtimeRegex(), expected);
});

test("the runtime regex matches shipped paths and nothing adjacent", () => {
  const re = new RegExp(runtimeRegex());
  for (const p of [
    "manifest.json",
    "sw.js",
    "popup/store.js",
    "popup/nested/deep.js",
    "icons/icon16.png",
  ]) {
    assert.ok(re.test(p), `${p} should count as a runtime change`);
  }
  for (const p of [
    "manifest.jsonx",
    "sw.js.bak",
    "my/popup/x.js",
    "docs/share.js",
    "test/sw.test.js",
    "README.md",
  ]) {
    assert.ok(!re.test(p), `${p} should NOT count as a runtime change`);
  }
});

// pack.yml and sign-firefox.yml call `.github/ensure-release.sh` behind an
// `[ -x ]` guard, so a lost exec bit does not fail the release — it quietly
// falls through to `--generate-notes` and the CHANGELOG notes disappear from the
// release body with no warning. Both gates likewise execute runtime-regex.sh
// directly.
for (const script of [".github/ensure-release.sh", ".github/runtime-regex.sh"]) {
  test(`${script} is executable`, () => {
    const mode = statSync(new URL(`../${script}`, import.meta.url)).mode & 0o777;
    assert.ok(
      mode & 0o111,
      `${script} is mode ${mode.toString(8)} — the workflows execute it directly, and pack/sign-firefox silently downgrade the release notes when it is not executable`,
    );
  });
}
