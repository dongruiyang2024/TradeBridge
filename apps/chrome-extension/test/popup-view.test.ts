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
      },
      lastDiagnostics: {
        conversations: 3,
        messageRequests: [],
        lwpRoutes: [
          { route: "page-socket-tap", status: 200, listLength: 4 },
          { route: "page-sdk-history", status: 200, listLength: 12 }
        ]
      }
    }
  });

  assert.equal(view.accountLabel, "admin@example.com");
  assert.equal(view.accountValidationLabel, "账号校验：已验证");
  assert.equal(view.realtimeLabel, "实时连接：已连接");
  assert.match(view.syncLabel, /^最近同步：2026-06-01 \d{2}:32$/);
  assert.equal(view.syncLabel.includes("T"), false);
  assert.equal(view.historyLabel, "历史回补：本轮 12 条 / 实时 4 条 / 会话 3 个");
  assert.equal(view.reconnectActionLabel, "重新连接");
  assert.equal(view.reconnectActionHidden, true);
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

test("createPopupViewModel shows platform binding status when TradeMind validation is available", () => {
  const view = createPopupViewModel({
    tradeBridgeAccountEmail: "admin@example.com",
    status: {
      tradeMindBinding: {
        valid: true,
        status: "disconnected",
        bindingStatus: "bound",
        tokenStatus: "valid",
        runtimeStatus: "offline",
        recommendedAction: "open_plugin",
        checkedAt: "2026-06-01T06:31:00.000Z"
      }
    }
  });

  assert.equal(view.accountValidationLabel, "平台绑定：已绑定");
  assert.equal(view.realtimeLabel, "实时同步：等待插件上线");
  assert.equal(view.headlineLabel, "等待插件上线");
  assert.equal(view.reconnectActionHidden, false);
});

test("createPopupViewModel asks for rebind when TradeMind marks the token invalid", () => {
  const view = createPopupViewModel({
    tradeBridgeAccountEmail: "admin@example.com",
    status: {
      tradeMindBinding: {
        valid: false,
        status: "disconnected",
        bindingStatus: "revoked",
        tokenStatus: "invalid",
        runtimeStatus: "offline",
        recommendedAction: "rebind",
        reason: "token_revoked",
        checkedAt: "2026-06-01T06:31:00.000Z"
      }
    }
  });

  assert.equal(view.accountValidationLabel, "平台绑定：需要重新绑定（token_revoked）");
  assert.equal(view.realtimeLabel, "实时同步：未连接");
  assert.equal(view.reconnectActionHidden, true);
});

test("createPopupViewModel shows reconnect action only when realtime is recoverable", () => {
  const view = createPopupViewModel({
    tradeBridgeAccountEmail: "admin@example.com",
    status: {
      realtime: {
        state: "closed",
        disconnectedAt: "2026-06-01T06:31:00.000Z",
        lastChangedAt: "2026-06-01T06:31:00.000Z"
      }
    }
  });

  assert.equal(view.reconnectActionLabel, "重新连接");
  assert.equal(view.reconnectActionHidden, false);
});

test("createPopupViewModel keeps popup diagnostics compact for long OneTalk event names", () => {
  const longEventName =
    "paas.conversation.added.with.an.extraordinarily.long.event.name.that.should.not.render.in.the.popup";
  const view = createPopupViewModel({
    tradeBridgeAccountEmail: "admin@example.com",
    status: {
      lastSyncedAt: "2026-06-08T01:54:45.709Z",
      captureDiagnostics: {
        observedMessageCount: 6,
        seenEventNames: ["paas.connection.changed", longEventName, "paas.message.changed"]
      }
    }
  });

  const renderedText = Object.values(view).join("\n");
  assert.equal(view.captureLabel, "抓取诊断：已抓取 6 条 / 3 类事件");
  assert.equal(view.syncLabel.includes("T01:54:45.709Z"), false);
  assert.equal(renderedText.includes(longEventName), false);
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
  assert.equal(markup.includes('id="sync-now"'), false);
  assert.equal(markup.includes('id="account-validation"'), true);
  assert.equal(markup.includes('id="history"'), true);
  assert.equal(markup.includes("店铺"), false);
  assert.equal(markup.includes("设备"), false);
  assert.equal(markup.includes("服务"), false);
});

test("popup css keeps the extension popup width stable while constraining long status text", () => {
  const css = fs.readFileSync(path.resolve("src/popup/popup.css"), "utf8");

  assert.equal(css.includes("width: 360px"), true);
  assert.equal(css.includes("min-width: 360px"), true);
  assert.equal(css.includes("max-width: 100vw"), false);
  assert.equal(css.includes("overflow-x: hidden"), true);
  assert.equal(css.includes("overflow-wrap: anywhere"), true);
  assert.equal(css.includes("#sync-now"), false);
  assert.equal(css.includes("button[hidden]"), true);
});
