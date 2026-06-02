import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createPopupViewModel } from "../src/popup/popup-view.js";

test("createPopupViewModel shows TradeBridge account and operational status", () => {
  const view = createPopupViewModel({
    tradeBridgeAccountEmail: "admin@example.com",
    status: {
      lastSyncedAt: "2026-06-01T06:32:00.000Z",
      accountValidation: {
        state: "valid",
        email: "admin@example.com",
        checkedAt: "2026-06-01T06:31:00.000Z"
      },
      realtime: {
        state: "connected",
        sessionId: "session-1",
        connectedAt: "2026-06-01T06:30:00.000Z",
        lastChangedAt: "2026-06-01T06:30:00.000Z"
      }
    }
  });

  assert.equal(view.accountLabel, "admin@example.com");
  assert.equal(view.accountValidationLabel, "账号校验：已验证");
  assert.equal(view.realtimeLabel, "实时连接：已连接");
  assert.equal(view.syncLabel, "最近同步：2026-06-01T06:32:00.000Z");
  assert.equal(view.reconnectActionLabel, "重新连接");
});

test("createPopupViewModel warns when the TradeBridge account token is invalid", () => {
  const view = createPopupViewModel({
    tradeBridgeAccountEmail: "admin@example.com",
    status: {
      accountValidation: {
        state: "invalid",
        checkedAt: "2026-06-01T06:31:00.000Z",
        error: "tradebridge_unauthorized"
      }
    }
  });

  assert.equal(view.accountValidationLabel, "账号校验：失效（tradebridge_unauthorized）");
});

test("createPopupViewModel keeps technical seller device and server details out of the popup", () => {
  const view = createPopupViewModel({
    tradeBridgeAccountEmail: "admin@example.com",
    status: {},
    technicalDetails: {
      serverUrl: "http://127.0.0.1:5032",
      sellerAccountExternalId: "default-seller",
      deviceId: "chrome-extension-1"
    }
  });

  const renderedText = Object.values(view).join("\n");
  assert.equal(renderedText.includes("default-seller"), false);
  assert.equal(renderedText.includes("chrome-extension-1"), false);
  assert.equal(renderedText.includes("127.0.0.1"), false);
});

test("popup markup exposes reconnect without showing technical details", () => {
  const markup = fs.readFileSync(path.resolve("src/popup/popup.html"), "utf8");

  assert.equal(markup.includes('id="reconnect"'), true);
  assert.equal(markup.includes('id="account-validation"'), true);
  assert.equal(markup.includes("店铺"), false);
  assert.equal(markup.includes("设备"), false);
  assert.equal(markup.includes("服务"), false);
});
