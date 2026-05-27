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

test("sanitizeForUpload removes OneTalk LWP token and session fields", () => {
  const sanitized = sanitizeForUpload({
    sourceMeta: {
      accessToken: "secret-access",
      refreshToken: "secret-refresh",
      sid: "secret-sid",
      "reg-sid": "secret-reg-sid",
      "reg-uid": "secret-reg-uid",
      route: "/r/Conversation/listNewestPagination"
    },
    messages: [
      {
        content: "hello",
        rawSanitized: {
          headers: {
            sid: "secret-header-sid",
            mid: "safe-mid"
          }
        }
      }
    ]
  });

  assert.deepEqual(sanitized, {
    sourceMeta: {
      route: "/r/Conversation/listNewestPagination"
    },
    messages: [
      {
        content: "hello",
        rawSanitized: {
          headers: {
            mid: "safe-mid"
          }
        }
      }
    ]
  });
});

test("assertNoSensitiveFields blocks raw LWP token text", () => {
  assert.throws(
    () => assertNoSensitiveFields({ diagnostics: "accessToken=secret-value; refreshToken=secret-refresh" }),
    /sanitizer_blocked_payload/
  );
});
