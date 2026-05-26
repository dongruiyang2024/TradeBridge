import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const manifestPath = path.resolve("public/manifest.json");

test("manifest uses minimal permissions for internal OneTalk collector", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    manifest_version: number;
    permissions?: string[];
    host_permissions?: string[];
    background?: { service_worker?: string; type?: string };
  };

  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions?.sort(), ["alarms", "cookies", "storage"]);
  assert.ok(manifest.host_permissions?.includes("https://onetalk.alibaba.com/*"));
  assert.ok(manifest.host_permissions?.includes("http://127.0.0.1:5032/*"));
  assert.equal(manifest.host_permissions?.includes("<all_urls>"), false);
  assert.equal(manifest.permissions?.includes("webRequest"), false);
  assert.equal(manifest.background?.service_worker, "background/index.js");
  assert.equal(manifest.background?.type, "module");
});
