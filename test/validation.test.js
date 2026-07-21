import assert from "node:assert/strict";
import test from "node:test";
import { headerNameError, headerValueError, urlRegexError } from "../rules.js";

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
