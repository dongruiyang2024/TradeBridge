import assert from "node:assert/strict";
import { test } from "node:test";
import { LwpRpcClient } from "../src/background/lwp-rpc-client.js";

test("LwpRpcClient sends request frames and resolves matching mid responses", async () => {
  const socket = new FakeSocket();
  const client = new LwpRpcClient({
    socketFactory: () => socket as never,
    nextMid: () => "mid-1",
    timeoutMs: 1000
  });

  const opened = client.connect();
  socket.emit("open", {});
  await opened;

  const pending = client.request("/r/SyncStatus/getState", [{ topic: "sync" }]);
  assert.deepEqual(JSON.parse(socket.sent[0]), {
    lwp: "/r/SyncStatus/getState",
    headers: { mid: "mid-1" },
    body: [{ topic: "sync" }]
  });

  socket.emit("message", {
    data: JSON.stringify({ code: 200, headers: { mid: "mid-1" }, body: { topic: "sync" } })
  });

  const frame = await pending;
  assert.equal(frame.code, 200);
  assert.equal(frame.mid, "mid-1");
  assert.deepEqual(frame.body, { topic: "sync" });
});

test("LwpRpcClient rejects requests on timeout", async () => {
  const socket = new FakeSocket();
  const client = new LwpRpcClient({
    socketFactory: () => socket as never,
    nextMid: () => "mid-timeout",
    timeoutMs: 1
  });

  const opened = client.connect();
  socket.emit("open", {});
  await opened;

  await assert.rejects(() => client.request("/r/SyncStatus/getState", [{ topic: "sync" }]), /lwp_request_timeout/);
});

test("LwpRpcClient can send heartbeat frames", async () => {
  const socket = new FakeSocket();
  const client = new LwpRpcClient({
    socketFactory: () => socket as never,
    nextMid: () => "mid-heartbeat",
    timeoutMs: 1000
  });

  const opened = client.connect();
  socket.emit("open", {});
  await opened;

  client.heartbeat();
  assert.deepEqual(JSON.parse(socket.sent[0]), {
    lwp: "/!",
    headers: { mid: "mid-heartbeat" }
  });
});

test("LwpRpcClient sends raw frames without dropping custom headers", async () => {
  const socket = new FakeSocket();
  const client = new LwpRpcClient({
    socketFactory: () => socket as never,
    timeoutMs: 1000
  });

  const opened = client.connect();
  socket.emit("open", {});
  await opened;

  const pending = client.requestFrame(
    JSON.stringify({
      lwp: "/reg",
      headers: {
        mid: "mid-reg",
        token: "access-token",
        "app-key": "12574478"
      }
    })
  );
  assert.deepEqual(JSON.parse(socket.sent[0]), {
    lwp: "/reg",
    headers: {
      mid: "mid-reg",
      token: "access-token",
      "app-key": "12574478"
    }
  });

  socket.emit("message", {
    data: JSON.stringify({ code: 200, headers: { mid: "mid-reg", "reg-uid": "seller-ali" }, body: { unitName: "icbu" } })
  });

  const frame = await pending;
  assert.equal(frame.mid, "mid-reg");
  assert.equal(frame.headers["reg-uid"], "seller-ali");
});

test("LwpRpcClient acknowledges OneTalk server push frames", async () => {
  const socket = new FakeSocket();
  const client = new LwpRpcClient({
    socketFactory: () => socket as never,
    nextMid: () => "mid-state",
    timeoutMs: 1000
  });

  const opened = client.connect();
  socket.emit("open", {});
  await opened;

  const pending = client.request("/r/SyncStatus/getState", [{ topic: "sync" }]);
  socket.emit("message", {
    data: JSON.stringify({
      lwp: "/s/sync",
      headers: { mid: "server-mid", sid: "sid-value", "app-key": "runtime-app-key", ua: "ua-value" },
      body: { syncExtraType: "diff" }
    })
  });

  assert.deepEqual(JSON.parse(socket.sent[1]), {
    code: 200,
    headers: { mid: "server-mid", sid: "sid-value", "app-key": "runtime-app-key", ua: "ua-value" }
  });

  socket.emit("message", {
    data: JSON.stringify({ code: 200, headers: { mid: "mid-state" }, body: { topic: "sync" } })
  });

  const frame = await pending;
  assert.equal(frame.mid, "mid-state");
});

class FakeSocket {
  sent: string[] = [];
  readyState = 0;
  private listeners = new Map<string, Array<(event: unknown) => void>>();

  addEventListener(type: string, callback: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), callback]);
  }

  removeEventListener(type: string, callback: (event: unknown) => void) {
    this.listeners.set(
      type,
      (this.listeners.get(type) || []).filter((item) => item !== callback)
    );
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.emit("close", {});
  }

  emit(type: string, event: unknown) {
    if (type === "open") this.readyState = 1;
    for (const callback of this.listeners.get(type) || []) callback(event);
  }
}
