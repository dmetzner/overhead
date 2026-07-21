import assert from "node:assert/strict";
import test from "node:test";

/* Regression test for the background sync loop: a FAILED apply must not keep
   the last-good signature, or reverting a bad edit would early-return and
   leave the (fail-closed-removed) rules gone forever. */

const storageListeners = [];
const sync = {};
const local = {};
let dynamicRules = [];

globalThis.chrome = {
  runtime: {
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
  },
  storage: {
    sync: { get: async (k) => ({ [k]: sync[k] }), set: async (o) => Object.assign(sync, o) },
    local: { get: async (k) => ({ [k]: local[k] }), set: async (o) => Object.assign(local, o) },
    onChanged: { addListener: (fn) => storageListeners.push(fn) },
  },
  declarativeNetRequest: {
    getDynamicRules: async () => dynamicRules,
    updateDynamicRules: async ({ addRules }) => {
      dynamicRules = addRules;
    },
    isRegexSupported: async () => ({ isSupported: true }),
  },
  action: {
    setBadgeText: async () => {},
    setBadgeBackgroundColor: async () => {},
  },
};

await import("../sw.js");

function stateWith(urlRegex) {
  return {
    masterEnabled: true,
    accent: "indigo",
    activeProfileId: "p",
    profiles: [
      {
        id: "p",
        name: "P",
        urlRegex,
        headers: [{ name: "X-A", value: "1", enabled: true }],
        sources: [],
      },
    ],
  };
}

// The listener kicks off sync() without awaiting it — give it a beat to land.
async function fire() {
  for (const fn of storageListeners) fn({ overheadState: {} }, "sync");
  await new Promise((r) => setTimeout(r, 25));
}

test("a failed apply doesn't lock out reverting to the last good state", async () => {
  assert.equal(storageListeners.length, 1, "sw.js registered its storage listener");

  sync.overheadState = stateWith(".*");
  await fire();
  assert.equal(dynamicRules.length, 1, "good state installs the rule");

  sync.overheadState = stateWith("(broken"); // JS-invalid → apply fails closed
  await fire();
  assert.equal(dynamicRules.length, 0, "failure removes the rule (fail closed)");

  sync.overheadState = stateWith(".*"); // revert to the exact previous signature
  await fire();
  assert.equal(dynamicRules.length, 1, "revert re-applies instead of being sig-suppressed");
});
