import assert from "node:assert/strict";
import { test } from "node:test";
import { createActivatedExtensionConfig } from "../src/options/activation-config.js";

test("createActivatedExtensionConfig stores the activating TradeBridge account email", () => {
  const config = createActivatedExtensionConfig({
    serverUrl: "http://127.0.0.1:5032",
    email: "admin@example.com",
    historyBackfillEnabled: true,
    historyMessagesPerConversation: 50,
    existingDeviceId: undefined,
    existingDeviceName: undefined,
    generatedDeviceId: "chrome-extension-generated",
    activation: {
      token: "collector-token",
      device: {
        id: "collector-device-1",
        externalDeviceId: "chrome-extension-generated",
        sellerAccountExternalId: "default-seller",
        deviceName: "Chrome Extension",
        status: "active"
      }
    }
  });

  assert.equal(config.tradeBridgeAccountEmail, "admin@example.com");
  assert.equal(config.serverUrl, "http://127.0.0.1:5032");
  assert.equal(config.collectorToken, "collector-token");
  assert.equal(config.syncIntervalSeconds, 10);
  assert.equal(config.historyBackfillEnabled, true);
  assert.equal(config.historyMessagesPerConversation, 50);
});

test("createActivatedExtensionConfig preserves Trade-Mind binding token and real account identities", () => {
  const config = createActivatedExtensionConfig({
    serverUrl: "http://127.0.0.1:5032",
    email: "admin@example.com",
    tradeMindBindingToken: "tm-binding-token",
    sellerAccountExternalId: "self-ali-1",
    sellerAccountDisplayName: "Self Ali",
    channelAccountExternalId: "self-login-1",
    existingDeviceId: undefined,
    existingDeviceName: undefined,
    generatedDeviceId: "chrome-extension-generated",
    activation: {
      token: "collector-token",
      device: {
        id: "collector-device-1",
        externalDeviceId: "chrome-extension-generated",
        sellerAccountExternalId: "self-ali-1",
        deviceName: "Chrome Extension",
        status: "active"
      }
    }
  });

  assert.equal(config.tradeMindBindingToken, "tm-binding-token");
  assert.equal(config.sellerAccountExternalId, "self-ali-1");
  assert.equal(config.sellerAccountDisplayName, "Self Ali");
  assert.equal(config.channelAccountExternalId, "self-login-1");
  assert.equal(config.syncIntervalSeconds, 10);
});
