import assert from "node:assert/strict";
import { test } from "node:test";
import { collectorRuntimeConfig } from "../src/runtime-config.js";

test("collectorRuntimeConfig uses default seller and hostname device without seller or device env vars", () => {
  const config = collectorRuntimeConfig(
    {
      WANGWANG_SERVER_URL: "http://127.0.0.1:5032",
      WANGWANG_COLLECTOR_TOKEN: "collector-token"
    },
    "Demo-Mac"
  );

  assert.deepEqual(config.sellerAccount, {
    externalAccountId: "default-seller"
  });
  assert.deepEqual(config.device, {
    deviceId: "collector-desktop-Demo-Mac",
    deviceName: "Demo-Mac"
  });
  assert.equal(config.serverUrl, "http://127.0.0.1:5032");
  assert.equal(config.collectorToken, "collector-token");
});
