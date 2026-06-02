import assert from "node:assert/strict";
import { after, test } from "node:test";
import { OnetalkClient } from "../src/index.js";

const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

test("OnetalkClient fetches weblite data with provided web cookies", async () => {
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return new Response(
      `
        <script>
          window.aliId = 'self-ali';
          window.__VMFsConv__cache__ = [{"cid":"c1","contactAccountId":"account","contactAliId":"ali"}];
        </script>
      `,
      {
        status: 200,
        headers: { "content-type": "text/html" }
      }
    );
  };

  const client = new OnetalkClient({ cookie2: "cookie-value" });
  const result = await client.fetchWeblite();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers.get("cookie"), "cookie2=cookie-value");
  assert.match(requests[0].headers.get("user-agent") || "", /Chrome/);
  assert.deepEqual(result.bootstrap, { aliId: "self-ali" });
  assert.deepEqual(result.conversations, [{ cid: "c1", contactAccountId: "account", contactAliId: "ali" }]);
});

test("OnetalkClient posts a message request with provided web cookies and conversation context", async () => {
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json({
      code: 200,
      data: {
        list: [{ messageId: "m1", content: "hello" }]
      }
    });
  };

  const client = new OnetalkClient({ xman_us_t: "ctoken%3Dfrom-cookie", _tb_token_: "tb-token" });
  const result = await client.getChatMessages({
    conversation: {
      contactAccountId: "contact-account",
      encryptContactAccountId: "encrypted-contact-account",
      contactAliId: "contact-ali",
      encryptContactAliId: "encrypted-contact-ali",
      cid: "conversation-code"
    },
    bootstrap: { aliId: "self-ali" },
    before: 1710000000000,
    pageSize: 50
  });

  assert.equal(result.status, 200);
  assert.equal(result.code, 200);
  assert.deepEqual(result.messages, [{ messageId: "m1", content: "hello" }]);
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /ctoken=from-cookie/);
  assert.match(requests[0].url, /_tb_token_=tb-token/);
  assert.equal(requests[0].headers.get("cookie"), "xman_us_t=ctoken%3Dfrom-cookie; _tb_token_=tb-token");
});
