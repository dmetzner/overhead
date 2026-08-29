import assert from "node:assert/strict";
import test from "node:test";
import { countChangedActiveValues, mergeCatalog, normalizeCatalog } from "../rules.js";

test("normalizeCatalog drops blank names and defaults value to '1'", () => {
  const { headers, dropped } = normalizeCatalog({
    headers: [{ name: "A" }, { name: "  " }, { name: "B", value: "2" }],
  });
  assert.equal(dropped, 1);
  assert.deepEqual(headers, [
    { name: "A", value: "1" },
    { name: "B", value: "2" },
  ]);
});

test("normalizeCatalog throws on a bad top-level shape", () => {
  assert.throws(() => normalizeCatalog({}));
});

test("mergeCatalog carries the active flag by name, values stay source-authoritative", () => {
  const merged = mergeCatalog(
    [{ name: "A", value: "1", active: true }],
    [
      { name: "A", value: "9" },
      { name: "B", value: "2" },
    ],
  );
  assert.equal(merged[0].active, true); // carried across refetch
  assert.equal(merged[0].value, "9"); // refreshed from source
  assert.equal(merged[1].active, false); // new row defaults off
});

test("countChangedActiveValues counts only active rows whose value changed at the source", () => {
  const prev = [
    { name: "X-Env", value: "staging", active: true },
    { name: "X-Token", value: "old", active: true },
    { name: "X-Off", value: "a", active: false }, // inactive: change ignored
    { name: "X-Same", value: "1", active: true },
  ];
  // Simulate a refetch that rotates X-Token, flips X-Off's value, keeps others.
  const fresh = [
    { name: "X-Env", value: "staging" },
    { name: "X-Token", value: "new" }, // changed + active -> counts
    { name: "X-Off", value: "b" }, // changed but inactive -> ignored
    { name: "X-Same", value: "1" },
    { name: "X-New", value: "z" }, // new row, not previously active
  ];
  const merged = mergeCatalog(prev, fresh);
  assert.equal(countChangedActiveValues(prev, merged), 1);
});

test("countChangedActiveValues is 0 when nothing active changed, and tolerates empties", () => {
  const prev = [{ name: "A", value: "1", active: true }];
  const merged = mergeCatalog(prev, [{ name: "A", value: "1" }]);
  assert.equal(countChangedActiveValues(prev, merged), 0);
  assert.equal(countChangedActiveValues(undefined, undefined), 0);
  assert.equal(countChangedActiveValues([], []), 0);
});
