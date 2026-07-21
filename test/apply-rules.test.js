import assert from "node:assert/strict";
import test from "node:test";

// Stub the full extension surface applyRules touches BEFORE importing rules.js
// (it binds `browser` at import time).
const local = {};
let dynamicRules = [];
let updateCalls = [];
let rejectNextUpdate = null;
let badge = { text: null, color: null };

globalThis.chrome = {
  storage: {
    sync: { get: async (k) => ({ [k]: undefined }), set: async () => {} },
    local: {
      get: async (k) => ({ [k]: local[k] }),
      set: async (o) => Object.assign(local, o),
    },
  },
  declarativeNetRequest: {
    getDynamicRules: async () => dynamicRules,
    updateDynamicRules: async ({ removeRuleIds, addRules }) => {
      updateCalls.push({ removeRuleIds, addRules });
      if (rejectNextUpdate) {
        const err = rejectNextUpdate;
        rejectNextUpdate = null;
        throw err;
      }
      dynamicRules = addRules;
    },
    isRegexSupported: async ({ regex }) =>
      regex === "re2-rejects-this" ? { isSupported: false } : { isSupported: true },
  },
  action: {
    setBadgeText: async ({ text }) => {
      badge.text = text;
    },
    setBadgeBackgroundColor: async ({ color }) => {
      badge.color = color;
    },
  },
};

const { applyRules, RULE_STATUS_KEY } = await import("../rules.js");

function reset() {
  dynamicRules = [];
  updateCalls = [];
  rejectNextUpdate = null;
  badge = { text: null, color: null };
  delete local[RULE_STATUS_KEY];
}

function state({ headers = [], urlRegex = ".*" } = {}) {
  return {
    masterEnabled: true,
    accent: "indigo",
    activeProfileId: "p",
    profiles: [{ id: "p", name: "P", urlRegex, headers, sources: [] }],
  };
}

test("a valid state installs the rule and records ok status", async () => {
  reset();
  const status = await applyRules(state({ headers: [{ name: "X-A", value: "1", enabled: true }] }));
  assert.equal(status.ok, true);
  assert.equal(status.applied, 1);
  assert.equal(dynamicRules.length, 1);
  assert.equal(badge.text, "1");
  assert.equal(local[RULE_STATUS_KEY].ok, true);
});

test("an RE2-rejected pattern fails closed: old rules removed, error recorded", async () => {
  reset();
  dynamicRules = [{ id: 1 }]; // something stale is installed
  const status = await applyRules(
    state({ headers: [{ name: "X-A", value: "1", enabled: true }], urlRegex: "re2-rejects-this" }),
  );
  assert.equal(status.ok, false);
  assert.match(status.error, /URL pattern rejected/);
  assert.deepEqual(dynamicRules, []); // nothing left injecting
  assert.equal(badge.text, "!");
  assert.equal(local[RULE_STATUS_KEY].ok, false);
});

test("invalid headers are skipped (not letting one row void the atomic update)", async () => {
  reset();
  const status = await applyRules(
    state({
      headers: [
        { name: "X-Ok", value: "1", enabled: true },
        { name: "bad name", value: "1", enabled: true },
      ],
    }),
  );
  assert.equal(status.applied, 1);
  assert.equal(status.ok, false); // still reported — nothing silent
  assert.deepEqual(
    status.skipped.map((s) => s.name),
    ["bad name"],
  );
  assert.equal(dynamicRules[0].action.requestHeaders.length, 1);
});

test("an engine rejection clears installed rules instead of keeping stale ones", async () => {
  reset();
  dynamicRules = [{ id: 1 }];
  rejectNextUpdate = new Error("Rule with id 1 specifies an invalid value");
  const status = await applyRules(state({ headers: [{ name: "X-A", value: "1", enabled: true }] }));
  assert.equal(status.ok, false);
  assert.match(status.error, /invalid value/);
  // second call is the fail-closed removal
  assert.equal(updateCalls.length, 2);
  assert.deepEqual(updateCalls[1].addRules, []);
  assert.deepEqual(dynamicRules, []);
  assert.equal(badge.text, "!");
});
