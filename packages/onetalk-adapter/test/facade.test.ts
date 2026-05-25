import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { detectSession, fetchConversations, fetchMessages } from "../src/index.js";

const tempRoots: string[] = [];
const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
  for (const root of tempRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("detectSession reports available local session fields while keeping cookies for adapter callers", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "onetalk-adapter-facade-test-"));
  tempRoots.push(root);
  const logPath = path.join(root, "cef.log");
  fs.writeFileSync(logPath, "xman_us_t=ctoken%3Dfrom-log; _tb_token_=tb-log; cookie2=cookie-value", "utf8");

  const session = detectSession({ logPaths: [logPath], platform: "linux" });

  assert.deepEqual(session.cookieNames, ["_tb_token_", "cookie2", "xman_us_t"]);
  assert.equal(session.hasCtoken, true);
  assert.equal(session.hasTbToken, true);
  assert.equal(session.hasCookie2, true);
  assert.equal(session.hasSgcookie, false);
  assert.equal(session.cookies.cookie2, "cookie-value");
  assert.equal(session.logPaths.length, 1);
});

test("fetchConversations fetches weblite data with provided cookies", async () => {
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

  const result = await fetchConversations({ cookies: { cookie2: "cookie-value" } });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers.get("cookie"), "cookie2=cookie-value");
  assert.deepEqual(result.bootstrap, { aliId: "self-ali" });
  assert.deepEqual(result.conversations, [{ cid: "c1", contactAccountId: "account", contactAliId: "ali" }]);
});

test("fetchMessages posts a message request with provided cookies and conversation context", async () => {
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

  const result = await fetchMessages({
    cookies: { xman_us_t: "ctoken%3Dfrom-cookie", _tb_token_: "tb-token" },
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
