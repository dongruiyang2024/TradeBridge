import assert from "node:assert/strict";
import { test } from "node:test";
import { createCollectorRealtimeHub } from "../src/collector-realtime-hub.js";

test("collector realtime hub sends outbound availability to seller sessions", () => {
  const hub = createCollectorRealtimeHub({
    now: () => new Date("2026-06-01T00:00:00.000Z"),
    nextId: () => "server-msg-1"
  });
  const sellerSocket = fakeSocket();
  const otherSocket = fakeSocket();

  hub.addSession({
    sessionId: "session-1",
    sellerAccountExternalId: "seller-1",
    deviceId: "device-1",
    socket: sellerSocket
  });
  hub.addSession({
    sessionId: "session-2",
    sellerAccountExternalId: "seller-2",
    deviceId: "device-2",
    socket: otherSocket
  });

  const delivered = hub.notifyOutboundAvailable("seller-1", 3);

  assert.equal(delivered, 1);
  assert.equal(sellerSocket.sent.length, 1);
  assert.equal(JSON.parse(sellerSocket.sent[0]).type, "outbound.available");
  assert.equal(JSON.parse(sellerSocket.sent[0]).payload.pendingCount, 3);
  assert.equal(otherSocket.sent.length, 0);
});

test("collector realtime hub removes closed sessions", () => {
  const hub = createCollectorRealtimeHub();
  const socket = fakeSocket();
  hub.addSession({
    sessionId: "session-1",
    sellerAccountExternalId: "seller-1",
    deviceId: "device-1",
    socket
  });

  hub.removeSession("session-1");

  assert.equal(hub.notifyOutboundAvailable("seller-1", 1), 0);
});

function fakeSocket() {
  return {
    readyState: 1,
    sent: [] as string[],
    send(data: string) {
      this.sent.push(data);
    },
    close() {
      this.readyState = 3;
    }
  };
}
