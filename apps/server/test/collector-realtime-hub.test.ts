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

  const delivered = hub.notifyOutboundAvailable({ sellerAccountExternalId: "seller-1", pendingCount: 3 });

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

  assert.equal(hub.notifyOutboundAvailable({ sellerAccountExternalId: "seller-1", pendingCount: 1 }), 0);
});

test("collector realtime hub filters channel availability by session capabilities", () => {
  const hub = createCollectorRealtimeHub();
  const whatsappSocket = fakeSocket();
  const onetalkSocket = fakeSocket();
  hub.addSession({
    sessionId: "session-whatsapp",
    sellerAccountExternalId: "seller-1",
    deviceId: "device-1",
    capabilities: ["channel:whatsapp-web"],
    socket: whatsappSocket
  });
  hub.addSession({
    sessionId: "session-onetalk",
    sellerAccountExternalId: "seller-1",
    deviceId: "device-2",
    capabilities: ["channel:alibaba-im"],
    socket: onetalkSocket
  });

  const delivered = hub.notifyOutboundAvailable({
    sellerAccountExternalId: "seller-1",
    pendingCount: 1,
    channel: "whatsapp-web"
  });

  assert.equal(delivered, 1);
  assert.equal(whatsappSocket.sent.length, 1);
  assert.equal(onetalkSocket.sent.length, 0);
});

test("collector realtime hub filters channel availability by declared channel account", () => {
  const hub = createCollectorRealtimeHub();
  const matchingSocket = fakeSocket();
  const otherAccountSocket = fakeSocket();
  hub.addSession({
    sessionId: "session-whatsapp-1",
    sellerAccountExternalId: "seller-1",
    deviceId: "device-1",
    capabilities: ["channel:whatsapp-web"],
    channelAccounts: [{ channel: "whatsapp-web", externalAccountId: "wa-account-1" }],
    socket: matchingSocket
  });
  hub.addSession({
    sessionId: "session-whatsapp-2",
    sellerAccountExternalId: "seller-1",
    deviceId: "device-2",
    capabilities: ["channel:whatsapp-web"],
    channelAccounts: [{ channel: "whatsapp-web", externalAccountId: "wa-account-2" }],
    socket: otherAccountSocket
  });

  const delivered = hub.notifyOutboundAvailable({
    sellerAccountExternalId: "seller-1",
    pendingCount: 1,
    channel: "whatsapp-web",
    channelAccountExternalId: "wa-account-1"
  });

  assert.equal(delivered, 1);
  assert.equal(matchingSocket.sent.length, 1);
  assert.equal(otherAccountSocket.sent.length, 0);
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
