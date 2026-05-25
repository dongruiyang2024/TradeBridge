import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPayload } from "../src/index.js";

test("buildPayload preserves conversation identity and backward pagination fields", () => {
  const payload = buildPayload(
    {
      contactAccountId: "contact-account",
      encryptContactAccountId: "encrypted-contact-account",
      contactAliId: "contact-ali",
      encryptContactAliId: "encrypted-contact-ali",
      cid: "conversation-code",
      chatToken: "chat-token"
    },
    {
      aliId: "self-ali"
    },
    1710000000000,
    50
  );

  assert.deepEqual(payload, {
    contactAccountId: "contact-account",
    contactAccountIdEncrypt: "encrypted-contact-account",
    aliId: "contact-ali",
    aliIdEncrypt: "encrypted-contact-ali",
    cid: "conversation-code",
    conversationCode: "conversation-code",
    chatToken: "chat-token",
    selfAliId: "self-ali",
    timeSlide: {
      forward: false,
      timeStamp: 1710000000000,
      pageSize: 50
    }
  });
});

test("buildPayload prefers explicit selfAliId and alternate encrypted field names", () => {
  const payload = buildPayload(
    {
      contactAccountId: "contact-account",
      contactAccountIdEncrypt: "alt-encrypted-contact-account",
      contactAliId: "contact-ali",
      aliIdEncrypt: "alt-encrypted-contact-ali",
      cid: "conversation-code",
      selfAliId: "conversation-self"
    },
    {
      aliId: "bootstrap-self"
    },
    null,
    20
  );

  assert.equal(payload.contactAccountIdEncrypt, "alt-encrypted-contact-account");
  assert.equal(payload.aliIdEncrypt, "alt-encrypted-contact-ali");
  assert.equal(payload.selfAliId, "conversation-self");
  assert.deepEqual(payload.timeSlide, {
    forward: false,
    timeStamp: null,
    pageSize: 20
  });
});
