import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

test("options markup is tailored to the local TradeBridge deployment", () => {
  const markup = fs.readFileSync(path.resolve("src/options/options.html"), "utf8");
  const optionsSource = fs.readFileSync(path.resolve("src/options/options.ts"), "utf8");

  assert.equal(markup.includes('name="serverUrl"'), false);
  assert.equal(markup.includes('name="syncIntervalMinutes"'), false);
  assert.equal(markup.includes('name="channelAccountExternalId"'), false);
  assert.equal(markup.includes('name="sellerAccountExternalId"'), false);
  assert.equal(markup.includes('id="server-url"'), true);
  assert.equal(markup.includes('id="detected-login-id"'), true);
  assert.equal(markup.includes('id="detected-ali-id"'), true);
  assert.equal(markup.includes("本地服务 http://localhost:3001"), true);
  assert.equal(markup.includes("同步间隔固定为 10 秒"), true);
  assert.equal(markup.includes('name="historyBackfillEnabled"'), true);
  assert.equal(markup.includes('name="historyMessagesPerConversation"'), true);
  assert.equal(markup.includes('id="current-account"'), true);
  assert.equal(markup.includes('id="current-device-id"'), true);
  assert.match(optionsSource, /DEFAULT_SERVER_URL = "http:\/\/localhost:3001"/);
  assert.match(optionsSource, /detectOneTalkAccount/);
  assert.match(optionsSource, /missing_onetalk_account_identity/);
  assert.equal(markup.includes("不要填写 OneTalk 密码"), true);
});
