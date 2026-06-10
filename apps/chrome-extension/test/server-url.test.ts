import assert from "node:assert/strict";
import { test } from "node:test";
import { boundedInteger, normalizeServerUrl, serverHostPermissionPatterns } from "../src/options/server-url.js";

test("normalizeServerUrl keeps only a valid http or https origin", () => {
  assert.equal(normalizeServerUrl(" https://api.tradebridge.example/base/path "), "https://api.tradebridge.example");
  assert.equal(normalizeServerUrl("http://127.0.0.1:5032/collector"), "http://127.0.0.1:5032");
  assert.throws(() => normalizeServerUrl("ftp://example.com"), /invalid_server_url/);
  assert.throws(() => normalizeServerUrl("not-a-url"), /invalid_server_url/);
});

test("serverHostPermissionPatterns derives runtime HTTP host permissions", () => {
  assert.deepEqual(serverHostPermissionPatterns("https://api.tradebridge.example"), [
    "https://api.tradebridge.example/*"
  ]);
  assert.deepEqual(serverHostPermissionPatterns("http://127.0.0.1:5032"), [
    "http://127.0.0.1:5032/*"
  ]);
});

test("boundedInteger clamps release settings to a safe range", () => {
  assert.equal(boundedInteger("60", { fallback: 30, min: 5, max: 1440 }), 60);
  assert.equal(boundedInteger("1", { fallback: 30, min: 5, max: 1440 }), 5);
  assert.equal(boundedInteger("5000", { fallback: 30, min: 5, max: 1440 }), 1440);
  assert.equal(boundedInteger("nope", { fallback: 30, min: 5, max: 1440 }), 30);
});
