import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

test("options markup supports release configuration without defaulting to localhost", () => {
  const markup = fs.readFileSync(path.resolve("src/options/options.html"), "utf8");

  assert.equal(markup.includes('value="http://127.0.0.1:5032"'), false);
  assert.equal(markup.includes('name="serverUrl"'), true);
  assert.equal(markup.includes('name="syncIntervalMinutes"'), true);
  assert.equal(markup.includes('name="historyBackfillEnabled"'), true);
  assert.equal(markup.includes('name="historyMessagesPerConversation"'), true);
  assert.equal(markup.includes('id="current-account"'), true);
  assert.equal(markup.includes("不要填写 OneTalk 密码"), true);
});
