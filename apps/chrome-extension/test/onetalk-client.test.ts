import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { BrowserOnetalkClient } from "../src/background/onetalk-client.js";

const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

test("fetchWeblite parses cached conversations and sends credentials include", async () => {
  const requests: Request[] = [];
  const html = fs.readFileSync(path.resolve("test/fixtures/weblite.html"), "utf8");
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html" }
    });
  };

  const client = new BrowserOnetalkClient();
  const result = await client.fetchWeblite();

  assert.equal(result.bootstrap.aliId, "self-ali");
  assert.equal(result.conversations.length, 1);
  assert.equal(requests[0].credentials, "include");
});

test("getChatMessages posts payload and parses message list", async () => {
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json({
      code: 200,
      data: {
        list: [{ messageId: "m1", content: "hello", sendTime: 1779706200000 }]
      }
    });
  };

  const client = new BrowserOnetalkClient();
  const result = await client.getChatMessages({
    conversation: {
      cid: "conv-1",
      contactAccountId: "buyer-1",
      encryptContactAccountId: "buyer-enc",
      contactAliId: "buyer-ali",
      encryptContactAliId: "buyer-ali-enc"
    },
    bootstrap: { aliId: "self-ali" },
    before: 1779706200000,
    pageSize: 50
  });

  assert.equal(result.status, 200);
  assert.equal(result.messages.length, 1);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].credentials, "include");
});

test("fetchWeblite maps login pages to onetalk_login_required", async () => {
  globalThis.fetch = async () =>
    new Response("<html><script>newlogin</script></html>", {
      status: 200,
      headers: { "content-type": "text/html" }
    });

  const client = new BrowserOnetalkClient();
  await assert.rejects(() => client.fetchWeblite(), /onetalk_login_required/);
});
