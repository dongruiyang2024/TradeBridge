import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

test("options markup is tailored to the managed TradeBridge deployment", () => {
  const markup = fs.readFileSync(path.resolve("src/options/options.html"), "utf8");
  const optionsSource = fs.readFileSync(path.resolve("src/options/options.ts"), "utf8");

  assert.equal(markup.includes('name="serverUrl"'), false);
  assert.equal(markup.includes('name="email"'), false);
  assert.equal(markup.includes('name="password"'), false);
  assert.equal(markup.includes('name="tradeMindBindingToken"'), false);
  assert.equal(markup.includes('name="activationToken"'), true);
  assert.equal(markup.includes('name="syncIntervalMinutes"'), false);
  assert.equal(markup.includes('name="channelAccountExternalId"'), false);
  assert.equal(markup.includes('name="sellerAccountExternalId"'), false);
  assert.equal(markup.includes('id="server-url"'), true);
  assert.equal(markup.includes('id="detected-login-id"'), true);
  assert.equal(markup.includes('id="detected-ali-id"'), true);
  assert.equal(markup.includes("自动连接 TradeBridge 服务"), true);
  assert.equal(markup.includes("自动连接本地采集服务"), false);
  assert.equal(markup.includes("Trade-Mind 激活码"), true);
  assert.equal(markup.includes("同步间隔固定为 10 秒"), true);
  assert.equal(markup.includes('name="historyBackfillEnabled"'), true);
  assert.equal(markup.includes('name="historyMessagesPerConversation"'), true);
  assert.equal(markup.includes('id="current-account"'), true);
  assert.equal(markup.includes('id="current-device-id"'), true);
  assert.match(optionsSource, /DEFAULT_SERVER_URL = __TRADEBRIDGE_SERVER_URL__/);
  assert.equal(optionsSource.includes("http://112.124.53.207"), false);
  assert.equal(optionsSource.includes("http://127.0.0.1:5032"), false);
  assert.match(optionsSource, /activationToken/);
  assert.match(optionsSource, /detectOneTalkAccount/);
  assert.match(optionsSource, /missing_onetalk_account_identity/);
  assert.match(optionsSource, /tradeMindBindingConfirmErrorMessage/);
  assert.match(optionsSource, /重新生成激活码/);
  assert.equal(markup.includes("不要填写 OneTalk 密码"), true);
  assert.equal(markup.includes("TradeBridge 管理员账号"), false);
});
