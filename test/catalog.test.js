import assert from "node:assert/strict";
import test from "node:test";
import { mergeCatalog, normalizeCatalog } from "../rules.js";

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
