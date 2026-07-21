import assert from "node:assert/strict";
import test from "node:test";
import { CONFIG_VERSION, decodeConfig, encodeConfig } from "../rules.js";

test("config round-trip preserves headers, scope, url sources, name", () => {
  const state = {
    activeProfileId: "p1",
    profiles: [
      {
        id: "p1",
        name: "Staging",
        urlRegex: "(shop)\\.dev",
        headers: [
          { name: "X-Env", value: "staging", enabled: true },
          { name: "X-Off", value: "1", enabled: false },
        ],
        sources: [
          { id: "s1", kind: "url", url: "https://x.dev/h", catalog: [] },
          { id: "s2", kind: "file", url: "", fileName: "f.json", catalog: [] },
        ],
      },
    ],
  };
  const back = decodeConfig(encodeConfig(state));
  assert.equal(back.name, "Staging");
  assert.equal(back.urlRegex, "(shop)\\.dev");
  assert.deepEqual(back.headers, [
    { name: "X-Env", value: "staging", enabled: true },
    { name: "X-Off", value: "1", enabled: false },
  ]);
  assert.deepEqual(back.sources, ["https://x.dev/h"]); // file source omitted, url kept
});

test("decodeConfig accepts a full share link (anything after last #)", () => {
  const state = {
    activeProfileId: "p",
    profiles: [
      {
        id: "p",
        name: "n",
        urlRegex: ".*",
        headers: [{ name: "A", value: "1", enabled: true }],
        sources: [],
      },
    ],
  };
  const code = encodeConfig(state);
  const back = decodeConfig(`https://overhead.metzner.uk/i#${code}`);
  assert.equal(back.headers.length, 1);
});

test("decodeConfig rejects garbage and future versions", () => {
  assert.throws(() => decodeConfig("not valid base64 %%%"));
  const newer = Buffer.from(JSON.stringify({ v: CONFIG_VERSION + 1, headers: [] })).toString(
    "base64url",
  );
  assert.throws(() => decodeConfig(newer), /newer version/);
});
