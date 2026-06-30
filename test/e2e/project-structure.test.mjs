import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("project is scoped to a Chrome extension collector host", () => {
  const rootPackage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const scripts = JSON.stringify(rootPackage.scripts || {});

  assert.equal(scripts.includes("@wangwang/collector-desktop"), false);
  assert.equal(fs.existsSync(path.join(root, "apps/collector-desktop")), false);
});

test("runtime code and executable tests do not reference the removed desktop collector", () => {
  const files = listFiles(["apps", "packages", "test", "tools"]).filter((file) => {
    const relative = path.relative(root, file);
    return relative !== path.join("test", "e2e", "project-structure.test.mjs");
  });
  const offenders = files.filter((file) => fs.readFileSync(file, "utf8").includes("apps/collector-desktop"));

  assert.deepEqual(
    offenders.map((file) => path.relative(root, file)),
    []
  );
});

test("Chrome extension shared sync types come from collector protocol", () => {
  const syncTypes = fs.readFileSync(path.join(root, "apps/chrome-extension/src/shared/sync-types.ts"), "utf8");

  assert.match(syncTypes, /@wangwang\/collector-protocol/);
  assert.doesNotMatch(syncTypes, /@wangwang\/onetalk-adapter\/browser/);
});

test("OneTalk adapter contains only browser web channel code", () => {
  const files = listFiles(["packages/onetalk-adapter/src", "packages/onetalk-adapter/test"]);
  const forbidden = /AliWorkbench|AliSupplier Safe Storage|Safe Storage|keychain|cookieDbPaths|tokenCachePaths|extractAliWorkbench|discoverAliWorkbench/i;
  const offenders = files.filter((file) => forbidden.test(fs.readFileSync(file, "utf8")));

  assert.deepEqual(
    offenders.map((file) => path.relative(root, file)),
    []
  );
});

test("diagnostic tools do not target desktop clients or local browser profiles", () => {
  const files = listFiles(["tools"]);
  const forbidden =
    /AliWorkbenchTemp|AliWorkbench|AliSupplier|probe-uia|TradeManager|WangWang|Chromium Cookies|Cookie decrypt|Network\\Cookies/i;
  const offenders = files.filter((file) => forbidden.test(`${path.basename(file)}\n${fs.readFileSync(file, "utf8")}`));

  assert.deepEqual(
    offenders.map((file) => path.relative(root, file)),
    []
  );
});

test("diagnostic tools are limited to Chrome page and web endpoint research", () => {
  const allowed = new Set([
    "analyze_onetalk_har_name_sources.mjs",
    "fetch_js_api_summary.py",
    "fetch_js_context.py",
    "probe_alicrm_endpoints.py"
  ]);
  const offenders = listFiles(["tools"])
    .map((file) => path.basename(file))
    .filter((name) => !name.startsWith("probe_chrome_") && !allowed.has(name));

  assert.deepEqual(offenders.sort(), []);
});

test("product docs model TM and OneTalk as one Alibaba message channel", () => {
  const productDoc = fs.readFileSync(path.join(root, "docs/TradeBridge产品设计文档.md"), "utf8");
  const planDoc = fs.readFileSync(
    path.join(root, "docs/superpowers/plans/2026-06-02-Chrome插件多渠道消息桥重构实施方案.md"),
    "utf8"
  );
  const combined = `${productDoc}\n${planDoc}`;

  assert.match(combined, /渠道 ID：alibaba-im/);
  assert.doesNotMatch(combined, /TM Adapter|OneTalk Adapter/);
  assert.doesNotMatch(combined, /"onetalk"\s*\|\s*"tm"|"tm"\s*\|\s*"onetalk"/);
});

test("production Docker image includes database migration SQL files", () => {
  const dockerfile = fs.readFileSync(path.join(root, "Dockerfile"), "utf8");

  assert.match(dockerfile, /packages\/database\/dist \.\/packages\/database\/dist/);
  assert.match(dockerfile, /packages\/database\/migrations \.\/packages\/database\/migrations/);
});

function listFiles(directories) {
  return directories.flatMap((directory) => listFilesInDirectory(path.join(root, directory)));
}

function listFilesInDirectory(directory) {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listFilesInDirectory(fullPath);
    if (!entry.isFile()) return [];
    if (!/\.(?:c?m?js|tsx?|ps1|py)$/i.test(entry.name)) return [];
    return [fullPath];
  });
}
