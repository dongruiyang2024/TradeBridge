import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LWP_ROUTES,
  buildAckDiffFrame,
  buildConversationListFrame,
  buildGetStateFrame,
  buildHeartbeatFrame,
  buildMessageListFrame,
  buildRegisterFrame,
  parseLwpFrame
} from "../src/browser.js";

test("LWP frame builders match OneTalk HAR route shapes", () => {
  assert.deepEqual(JSON.parse(buildGetStateFrame("mid-state")), {
    lwp: "/r/SyncStatus/getState",
    headers: { mid: "mid-state" },
    body: [{ topic: "sync" }]
  });

  assert.deepEqual(JSON.parse(buildConversationListFrame("mid-conv", 1779862804977, 100)), {
    lwp: "/r/Conversation/listNewestPagination",
    headers: { mid: "mid-conv" },
    body: [1779862804977, 100]
  });

  assert.deepEqual(JSON.parse(buildMessageListFrame("mid-msg", "buyer-seller#11011@icbu", 9007199254740991, 20)), {
    lwp: "/r/MessageManager/listUserMessages",
    headers: { mid: "mid-msg" },
    body: ["buyer-seller#11011@icbu", false, 9007199254740991, 20, false]
  });

  assert.deepEqual(JSON.parse(buildHeartbeatFrame("mid-heartbeat")), {
    lwp: "/!",
    headers: { mid: "mid-heartbeat" }
  });

  assert.deepEqual(
    JSON.parse(
      buildRegisterFrame({
        mid: "mid-reg",
        appKey: "12574478",
        deviceId: "chrome-device",
        accessToken: "access-token",
        userAgent: "Mozilla/5.0"
      })
    ),
    {
      lwp: "/reg",
      headers: {
        mid: "mid-reg",
        "app-key": "12574478",
        did: "chrome-device",
        token: "access-token",
        ua: "Mozilla/5.0 DingTalk(2.1.0-beta.22) DingWeb/2.1.0-beta.22 IMPaaS",
        dt: "j",
        wv: "im:3,au:3,sy:6",
        sync: "0,0;0;0;",
        "cache-header": "app-key token ua wv"
      }
    }
  );

  assert.equal(LWP_ROUTES.messages, "/r/MessageManager/listUserMessages");
  assert.equal(typeof buildAckDiffFrame("mid-ack", { topic: "sync" }), "string");
});

test("parseLwpFrame returns structured frame data", () => {
  const parsed = parseLwpFrame(
    JSON.stringify({
      code: 200,
      headers: { mid: "mid-1", sid: "sid-value" },
      body: { hasMore: false, nextCursor: "cursor-1", userConvs: [] }
    })
  );

  assert.deepEqual(parsed, {
    code: 200,
    route: undefined,
    mid: "mid-1",
    headers: { mid: "mid-1", sid: "sid-value" },
    body: { hasMore: false, nextCursor: "cursor-1", userConvs: [] },
    raw: {
      code: 200,
      headers: { mid: "mid-1", sid: "sid-value" },
      body: { hasMore: false, nextCursor: "cursor-1", userConvs: [] }
    }
  });
});

test("parseLwpFrame rejects non JSON frames", () => {
  assert.throws(() => parseLwpFrame("not-json"), /lwp_frame_invalid_json/);
});
