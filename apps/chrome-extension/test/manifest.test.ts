import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const manifestPath = path.resolve("public/manifest.json");

test("manifest uses minimal permissions for internal OneTalk collector", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    manifest_version: number;
    minimum_chrome_version?: string;
    permissions?: string[];
    host_permissions?: string[];
    background?: { service_worker?: string; type?: string };
    content_scripts?: Array<{ run_at?: string }>;
    web_accessible_resources?: Array<{ resources?: string[]; matches?: string[] }>;
  };

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, "116");
  assert.deepEqual(manifest.permissions?.sort(), ["alarms", "cookies", "scripting", "storage"]);
  assert.ok(manifest.host_permissions?.includes("https://onetalk.alibaba.com/*"));
  assert.ok(manifest.host_permissions?.includes("http://127.0.0.1:5032/*"));
  assert.ok(manifest.host_permissions?.includes("ws://127.0.0.1:5032/*"));
  assert.equal(manifest.host_permissions?.includes("<all_urls>"), false);
  assert.equal(manifest.permissions?.includes("webRequest"), false);
  assert.equal(manifest.background?.service_worker, "background/index.js");
  assert.equal(manifest.background?.type, "module");
  assert.equal(manifest.content_scripts?.[0]?.run_at, "document_start");
  assert.equal(manifest.web_accessible_resources?.[0]?.resources?.includes("content/onetalk-page-script.js"), true);
});

test("OneTalk content bridge stays classic-script compatible", () => {
  const bridgeSource = fs.readFileSync(path.resolve("src/content/onetalk-page-bridge.ts"), "utf8");
  const runtimeImports = bridgeSource
    .split("\n")
    .filter((line) => line.startsWith("import ") && !line.startsWith("import type "));

  assert.deepEqual(runtimeImports, []);
  assert.equal(/^export\s/m.test(bridgeSource), false);
});

test("OneTalk content bridge does not collect business data from the page DOM", () => {
  const bridgeSource = fs.readFileSync(path.resolve("src/content/onetalk-page-bridge.ts"), "utf8");

  assert.equal(bridgeSource.includes("querySelectorAll"), false);
  assert.equal(bridgeSource.includes("innerText"), false);
  assert.equal(bridgeSource.includes("textContent"), false);
  assert.equal(bridgeSource.includes("getBoundingClientRect"), false);
  assert.equal(bridgeSource.includes("MutationObserver"), false);
  assert.equal(bridgeSource.includes("tradebridgeOnetalkPageSnapshot"), false);
  assert.equal(bridgeSource.includes("onetalk-page-snapshot"), false);
});
