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
  // file source omitted, url kept
  assert.deepEqual(back.sources, [{ url: "https://x.dev/h", headers: [] }]);
  assert.equal(back.dropped, 0);
});

test("v2: active catalog selections round-trip with their source", () => {
  const state = {
    activeProfileId: "p1",
    profiles: [
      {
        id: "p1",
        name: "Src",
        urlRegex: ".*",
        headers: [],
        sources: [
          {
            id: "s1",
            kind: "url",
            url: "https://x.dev/h",
            catalog: [
              { name: "X-A", value: "1", active: true },
              { name: "X-B", value: "2", active: false }, // inactive rows stay local
            ],
          },
        ],
      },
    ],
  };
  const back = decodeConfig(encodeConfig(state));
  assert.deepEqual(back.sources, [
    { url: "https://x.dev/h", headers: [{ name: "X-A", value: "1" }] },
  ]);
});

test("plain shares (no selections) still encode as v1 for older installs", () => {
  const state = {
    activeProfileId: "p",
    profiles: [
      {
        id: "p",
        name: "n",
        urlRegex: ".*",
        headers: [{ name: "A", value: "1", enabled: true }],
        sources: [{ id: "s1", kind: "url", url: "https://x.dev/h", catalog: [] }],
      },
    ],
  };
  const payload = JSON.parse(Buffer.from(encodeConfig(state), "base64url").toString());
  assert.equal(payload.v, 1);
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

test("decodeConfig drops rows the engine would reject, and counts them", () => {
  const code = Buffer.from(
    JSON.stringify({
      v: 1,
      headers: [
        { name: "X-Ok", value: "1" },
        { name: "bad name", value: "1" }, // space → invalid token
        { name: "X-Ctl", value: "a\nb" }, // newline → header injection
      ],
      sources: [{ url: "https://x.dev/h", headers: [{ name: "also bad!»", value: "1" }] }],
    }),
  ).toString("base64url");
  const back = decodeConfig(code);
  assert.deepEqual(
    back.headers.map((h) => h.name),
    ["X-Ok"],
  );
  assert.deepEqual(back.sources[0].headers, []);
  assert.equal(back.dropped, 3);
});

test("decodeConfig rejects garbage and future versions", () => {
  assert.throws(() => decodeConfig("not valid base64 %%%"));
  const newer = Buffer.from(JSON.stringify({ v: CONFIG_VERSION + 1, headers: [] })).toString(
    "base64url",
  );
  assert.throws(() => decodeConfig(newer), /newer version/);
});
