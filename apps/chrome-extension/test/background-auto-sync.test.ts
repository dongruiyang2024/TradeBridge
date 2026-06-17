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

test("background applies downloaded extension updates without user clicks", () => {
  const source = backgroundSource();
  const chromeApiSource = fs.readFileSync(path.resolve("src/shared/chrome-api.ts"), "utf8");

  assert.match(source, /UPDATE_RELOAD_ALARM/);
  assert.match(source, /chromeApi\.runtime\.onUpdateAvailable\?\.addListener/);
  assert.match(source, /chromeApi\.runtime\.reload\?\.\(\)/);
  assert.match(source, /saveExtensionUpdateAvailable/);
  assert.match(source, /chromeApi\.alarms\.create\(UPDATE_RELOAD_ALARM/);
  assert.match(chromeApiSource, /onUpdateAvailable\?:/);
  assert.match(chromeApiSource, /reload\?: \(\) => void/);
});

test("background keeps periodic sync on a fixed ten second cadence", () => {
  const source = backgroundSource();

  assert.match(source, /FIXED_SYNC_INTERVAL_SECONDS = 10/);
  assert.match(source, /autoSyncScheduler.startPeriodic()/);
  assert.match(source, /autoSyncScheduler\.startPeriodic\(\);\s*void ensureRealtimeConnection\(\);/);
  assert.match(source, /async function readDashboard\(\)[\s\S]*autoSyncScheduler\.startPeriodic\(\);[\s\S]*await ensureRealtimeConnection\(\);/);
  assert.match(source, /typed.type === "config-updated"[\s\S]*autoSyncScheduler.startPeriodic()/);
  assert.doesNotMatch(source, /boundedSyncInterval/);
  assert.doesNotMatch(source, /SYNC_ALARM/);
});


test("background refreshes TradeMind binding validation on startup and dashboard reads", () => {
  const source = backgroundSource();

  assert.match(source, /validateTradeMindBinding/);
  assert.match(source, /chromeApi\.runtime\.onStartup\?\.addListener[\s\S]*refreshTradeMindBindingValidation/);
  assert.match(source, /async function readDashboard\(\)[\s\S]*validateStoredTradeMindBinding/);
  assert.match(source, /typed\.type === "config-updated"[\s\S]*refreshTradeMindBindingValidation/);
  assert.match(source, /typed\.type === "realtime-reconnect"[\s\S]*refreshTradeMindBindingValidation\(\{ force: true \}\)/);
  assert.match(source, /reportCollectorHeartbeat\(\{ lastSyncAt:[\s\S]*refreshTradeMindBindingValidation\(\)\.catch/);
  assert.doesNotMatch(source, /if \(!config\.tradeMindBindingToken\)/);
});

test("background reports collector heartbeat after sync and sync errors", () => {
  const source = backgroundSource();

  assert.match(source, /sendCollectorHeartbeat/);
  assert.match(source, /reportCollectorHeartbeat\(\{ lastSyncAt:/);
  assert.match(source, /catch \(error\)[\s\S]*reportCollectorHeartbeat\(\{ lastError: errorMessage\(error\) \}\)/);
});
