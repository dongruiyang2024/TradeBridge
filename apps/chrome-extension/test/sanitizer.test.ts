import assert from "node:assert/strict";
import { test } from "node:test";
import { assertNoSensitiveFields, sanitizeForUpload } from "../src/background/sanitizer.js";

test("sanitizeForUpload removes sensitive keys recursively", () => {
  const sanitized = sanitizeForUpload({
    cookie2: "secret-cookie",
    nested: {
      ctoken: "secret-ctoken",
      safe: "value",
      list: [{ chatToken: "secret-chat-token", content: "hello" }]
    }
  });

  assert.deepEqual(sanitized, {
    nested: {
      safe: "value",
      list: [{ content: "hello" }]
    }
  });
});

test("assertNoSensitiveFields blocks payloads that still contain sensitive text", () => {
  assert.throws(
    () => assertNoSensitiveFields({ messages: [{ content: "ctoken=secret-value" }] }),
    /sanitizer_blocked_payload/
  );
});

test("assertNoSensitiveFields allows normal customer and message data", () => {
  assert.doesNotThrow(() =>
    assertNoSensitiveFields({
      customers: [{ externalCustomerId: "buyer-1", displayName: "Buyer One" }],
      messages: [{ content: "Can you ship tomorrow?" }]
    })
  );
});
