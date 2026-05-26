import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPayload, extractJsonAfter, pageBootstrap } from "../src/browser.js";

test("browser entry exposes parser and payload helpers without session helpers", () => {
  const html = `
    <script>
      window.aliId = 'self-ali';
      window.__VMFsConv__cache__ = [{"cid":"c1","contactAccountId":"buyer-1"}];
    </script>
  `;

  assert.deepEqual(pageBootstrap(html), { aliId: "self-ali" });
  assert.deepEqual(extractJsonAfter(html, "window.__VMFsConv__cache__"), [
    { cid: "c1", contactAccountId: "buyer-1" }
  ]);

  const payload = buildPayload(
    {
      contactAccountId: "buyer-1",
      encryptContactAccountId: "buyer-enc",
      contactAliId: "buyer-ali",
      encryptContactAliId: "buyer-ali-enc",
      cid: "conv-1"
    },
    { aliId: "self-ali" },
    1779706200000,
    50
  );

  assert.equal(payload.selfAliId, "self-ali");
  assert.equal(payload.conversationCode, "conv-1");
});
