import assert from "node:assert/strict";
import test from "node:test";
import {
  headerNameError,
  headerValueError,
  isBroadScope,
  isCredentialHeader,
  urlRegexError,
} from "../rules.js";

test("headerNameError accepts RFC 9110 tokens", () => {
  assert.equal(headerNameError("X-Custom-Header"), null);
  assert.equal(headerNameError("authorization"), null);
  assert.equal(headerNameError("x_1!#$%&'*+.^`|~"), null);
});

test("headerNameError rejects what the engine rejects", () => {
  assert.match(headerNameError(""), /empty/);
  assert.match(headerNameError("   "), /empty/);
  assert.match(headerNameError("bad name"), /not a valid/); // inner space
  assert.match(headerNameError("x:y"), /not a valid/); // colon
  assert.match(headerNameError("häder"), /not a valid/); // non-ASCII
});

test("headerValueError blocks control characters (header injection)", () => {
  assert.equal(headerValueError(""), null);
  assert.equal(headerValueError("1; context=de"), null);
  assert.equal(headerValueError("tabs\tare fine"), null);
  assert.match(headerValueError("a\r\nInjected: 1"), /control characters/);
  assert.match(headerValueError("a\u0000b"), /control characters/);
});

test("urlRegexError: valid and syntactically broken patterns (RegExp path)", async () => {
  assert.equal(await urlRegexError("(shop|admin)\\.example\\.dev"), null);
  assert.equal(await urlRegexError(""), null); // empty falls back to .*
  assert.ok(await urlRegexError("(unclosed"));
});

test("isCredentialHeader flags secret-bearing headers, case-insensitively", () => {
  for (const n of ["Authorization", "cookie", "Proxy-Authorization", "X-Api-Key", "x-auth-token"]) {
    assert.equal(isCredentialHeader(n), true, n);
  }
  for (const n of ["X-Env", "Accept", "", "  ", "content-type"]) {
    assert.equal(isCredentialHeader(n), false, JSON.stringify(n));
  }
});

test("isBroadScope catches catch-all patterns but not specific host patterns", () => {
  // Universal catch-alls, and bare-TLD wildcards across common TLDs that each
  // match nearly every site on that TLD.
  const broad = ["", ".*", ".", ".+", "^.*$", "https?"];
  for (const tld of ["com", "org", "net", "io", "dev", "app"]) {
    broad.push(`\\.${tld}`, `.*\\.${tld}`);
  }
  for (const rx of broad) {
    assert.equal(isBroadScope(rx), true, `broad: ${JSON.stringify(rx)}`);
  }
  // A full host pattern is specific even when it ends in a common TLD.
  for (const rx of [
    "api\\.example\\.dev",
    "shop\\.internal",
    "(shop|admin)\\.example\\.com",
    "my-app\\.fly\\.io",
  ]) {
    assert.equal(isBroadScope(rx), false, `specific: ${rx}`);
  }
  // A broken pattern isn't reported as broad — it's surfaced as invalid elsewhere.
  assert.equal(isBroadScope("(unclosed"), false);
});

test("isBroadScope resists catastrophic backtracking (ReDoS guard)", () => {
  // Patterns crafted to make JS RegExp backtrack super-linearly. Each must return
  // quickly (skipped by the quantifier budget, never run against the sentinels)
  // so a crafted share-link scope can't freeze the popup on import. Includes the
  // classic nested shapes AND the two that defeated an earlier shape-denylist:
  // sequential quantifiers (polynomial) and a nested quantified group.
  const evil = [
    "(.*)*!",
    "(a+)+$",
    "(a|a)*",
    "(a|ab)*c",
    "(x+x+)+y",
    "(.*a){20}z",
    `${".*".repeat(12)}!`, // polynomial: stacked .* — no groups, no adjacent quantifiers
    `${".*".repeat(80)}!`,
    "((.)+)+!", // exponential: quantifier outside a nested group
    `${".?".repeat(26)}ZZZ`, // exponential via stacked ? — the quantifier a budget can forget
    `${".?".repeat(98)}ZZZ`,
  ];
  const start = process.hrtime.bigint();
  for (const rx of evil) assert.equal(isBroadScope(rx), false, `skipped: ${rx}`);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms < 500, `all backtracking patterns handled in ${ms.toFixed(1)}ms`);
});

test("urlRegexError consults DNR's isRegexSupported when available", async () => {
  globalThis.chrome = {
    declarativeNetRequest: {
      isRegexSupported: async ({ regex }) =>
        regex === "re2-hates-this" ? { isSupported: false } : { isSupported: true },
    },
  };
  // rules.js binds `browser` at import time — re-import fresh with the stub.
  const { urlRegexError: withDnr } = await import(`../rules.js?dnr=${Date.now()}`);
  assert.match(await withDnr("re2-hates-this"), /RE2/);
  assert.equal(await withDnr("fine"), null);
  delete globalThis.chrome;
});
