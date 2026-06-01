import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCollectorWsMessage, parseCollectorWsMessage } from "@wangwang/collector-protocol";
import { InMemorySyncStore } from "@wangwang/database";
import { createServer } from "../src/server.js";

test("collector websocket accepts hello with registered device token", async (t) => {
  const store = new InMemorySyncStore();
  await store.registerCollectorDevice({
    sellerAccountExternalId: "seller-1",
    externalDeviceId: "device-1",
    deviceName: "Chrome Extension",
    token: "device-token"
  });
  const app = await createServer({ store });
  await app.ready();

  const ws = await app.injectWS("/collector/v1/ws");
  const ready = nextMessage(ws);
  const closed = nextClose(ws);
  ws.send(
    JSON.stringify(
      buildCollectorWsMessage({
        id: "client-1",
        type: "collector.hello",
        sentAt: "2026-06-01T00:00:00.000Z",
        payload: {
          collectorToken: "device-token",
          deviceId: "device-1",
          deviceName: "Chrome Extension",
          capabilities: ["outbound.claim", "delivery.report"]
        }
      })
    )
  );

  const message = parseCollectorWsMessage(await ready);
  assert.equal(message.type, "collector.ready");
  assert.equal(message.payload.sellerAccountExternalId, "seller-1");
  closeWs(ws);
  await closed;
  await app.close();
});

test("collector websocket closes when hello token is invalid", async () => {
  const app = await createServer({ store: new InMemorySyncStore() });
  await app.ready();

  const ws = await app.injectWS("/collector/v1/ws");
  const closed = new Promise<{ code: number }>((resolve) => {
    ws.on("close", (code) => resolve({ code }));
  });
  ws.send(
    JSON.stringify(
      buildCollectorWsMessage({
        id: "client-1",
        type: "collector.hello",
        sentAt: "2026-06-01T00:00:00.000Z",
        payload: {
          collectorToken: "bad-token",
          deviceId: "device-1",
          capabilities: []
        }
      })
    )
  );

  assert.equal((await closed).code, 1008);
  await app.close();
});

function nextMessage(ws: { once(event: "message", listener: (data: Buffer) => void): void }): Promise<string> {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(data.toString()));
  });
}

function nextClose(ws: { once(event: "close", listener: () => void): void }): Promise<void> {
  return new Promise((resolve) => {
    ws.once("close", () => resolve());
  });
}

function closeWs(ws: { close(): void; terminate?: () => void }): void {
  if (ws.terminate) ws.terminate();
  else ws.close();
}
