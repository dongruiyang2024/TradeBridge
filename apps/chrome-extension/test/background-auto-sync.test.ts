import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const backgroundSource = () => fs.readFileSync(path.resolve("src/background/index.ts"), "utf8");

test("background schedules sync automatically after activation and OneTalk page login", () => {
  const source = backgroundSource();

  assert.match(source, /typed\.type === "onetalk-page-ready"/);
  assert.match(source, /typed\.type === "config-updated"[\s\S]*autoSyncScheduler\.schedule\(\)/);
  assert.match(source, /typed\.type === "onetalk-page-ready"[\s\S]*autoSyncScheduler\.schedule\(\)/);
});
