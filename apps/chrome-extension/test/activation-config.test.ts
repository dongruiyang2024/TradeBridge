import assert from "node:assert/strict";
import { test } from "node:test";
import { createActivatedExtensionConfig } from "../src/options/activation-config.js";

test("createActivatedExtensionConfig stores the activating TradeBridge account email", () => {
  const config = createActivatedExtensionConfig({
    serverUrl: "http://127.0.0.1:5032",
    email: "admin@example.com",
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
});
