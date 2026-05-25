import assert from "node:assert/strict";
import { test } from "node:test";
import { extractJsonAfter, pageBootstrap } from "../src/index.js";

test("extractJsonAfter parses the weblite cached conversations array", () => {
  const html = `
    <script>
      window.__VMFsConv__cache__ = [
        {"cid":"c1","contactAccountId":"100","contactAliId":"200","latestMessage":{"content":"hello"}}
      ];
    </script>
  `;

  assert.deepEqual(extractJsonAfter(html, "window.__VMFsConv__cache__"), [
    {
      cid: "c1",
      contactAccountId: "100",
      contactAliId: "200",
      latestMessage: { content: "hello" }
    }
  ]);
});

test("pageBootstrap extracts and decodes known bootstrap globals", () => {
  const html = `
    <script>
      window.aliId = '12345';
      window.aliIdEncrypt = 'ali&amp;enc';
      window.currentUserAccountId = 'owner-1';
      window.currentUserAccountIdEncry = 'owner&quot;enc';
    </script>
  `;

  assert.deepEqual(pageBootstrap(html), {
    aliId: "12345",
    aliIdEncrypt: "ali&enc",
    currentUserAccountId: "owner-1",
    currentUserAccountIdEncry: 'owner"enc'
  });
});
