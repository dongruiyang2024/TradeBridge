import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import zlib from "node:zlib";

const manifestPath = path.resolve("public/manifest.json");

test("manifest uses minimal permissions for internal OneTalk collector", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    manifest_version: number;
    minimum_chrome_version?: string;
    version?: string;
    permissions?: string[];
    host_permissions?: string[];
    optional_host_permissions?: string[];
    background?: { service_worker?: string; type?: string };
    icons?: Record<string, string>;
    action?: { default_icon?: Record<string, string>; default_popup?: string };
    content_scripts?: Array<{ run_at?: string }>;
    web_accessible_resources?: Array<{ resources?: string[]; matches?: string[] }>;
  };

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, "116");
  assert.equal(manifest.version, "0.1.1");
  assert.deepEqual(manifest.permissions?.sort(), ["alarms", "scripting", "storage"]);
  assert.deepEqual(manifest.host_permissions, ["https://onetalk.alibaba.com/*"]);
  assert.deepEqual(manifest.optional_host_permissions?.sort(), ["http://*/*", "https://*/*"]);
  assert.equal(manifest.host_permissions?.includes("http://127.0.0.1:5032/*"), false);
  assert.equal(manifest.host_permissions?.includes("ws://127.0.0.1:5032/*"), false);
  assert.equal(manifest.host_permissions?.includes("<all_urls>"), false);
  assert.equal(manifest.optional_host_permissions?.includes("<all_urls>"), false);
  assert.equal(manifest.host_permissions?.includes("https://*.alibaba.com/*"), false);
  assert.equal(manifest.permissions?.includes("cookies"), false);
  assert.equal(manifest.permissions?.includes("webRequest"), false);
  assert.equal(manifest.background?.service_worker, "background/index.js");
  assert.equal(manifest.background?.type, "module");
  assert.deepEqual(manifest.icons, {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  });
  assert.deepEqual(manifest.action?.default_icon, {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png"
  });
  assert.equal(manifest.action?.default_popup, "popup/popup.html");
  assert.equal(manifest.content_scripts?.[0]?.run_at, "document_start");
  assert.equal(
    manifest.web_accessible_resources?.[0]?.resources?.includes("channels/alibaba-im/onetalk-page-script.js"),
    true
  );
});

test("extension icons are real non-empty PNG assets", () => {
  for (const size of [16, 32, 48, 128]) {
    const file = path.resolve(`public/icons/icon-${size}.png`);
    const png = fs.readFileSync(file);
    const image = parsePng(png);

    assert.equal(image.width, size);
    assert.equal(image.height, size);
    assert.ok(image.visiblePixels > 0, `${file} should contain visible pixels`);
    assert.ok(image.colorCount > 1, `${file} should not be a flat blank image`);
  }
});

test("OneTalk content bridge stays classic-script compatible", () => {
  const bridgeSource = fs.readFileSync(path.resolve("src/channels/alibaba-im/onetalk-page-bridge.ts"), "utf8");
  const runtimeImports = bridgeSource
    .split("\n")
    .filter((line) => line.startsWith("import ") && !line.startsWith("import type "));

  assert.deepEqual(runtimeImports, []);
  assert.equal(/^export\s/m.test(bridgeSource), false);
});

test("OneTalk content bridge does not collect business data from the page DOM", () => {
  const bridgeSource = fs.readFileSync(path.resolve("src/channels/alibaba-im/onetalk-page-bridge.ts"), "utf8");

  assert.equal(bridgeSource.includes("querySelectorAll"), false);
  assert.equal(bridgeSource.includes("innerText"), false);
  assert.equal(bridgeSource.includes("textContent"), false);
  assert.equal(bridgeSource.includes("getBoundingClientRect"), false);
  assert.equal(bridgeSource.includes("MutationObserver"), false);
  assert.equal(bridgeSource.includes("tradebridgeOnetalkPageSnapshot"), false);
  assert.equal(bridgeSource.includes("onetalk-page-snapshot"), false);
});

function parsePng(buffer: Buffer): { width: number; height: number; visiblePixels: number; colorCount: number } {
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idatChunks: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    }
    if (type === "IDAT") idatChunks.push(data);
    offset += 12 + length;
  }
  assert.equal(colorType, 6, "icons should be RGBA PNGs");

  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const previous = Buffer.alloc(stride);
  const colors = new Set<string>();
  let visiblePixels = 0;
  let readOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[readOffset];
    readOffset += 1;
    const row = Buffer.from(inflated.subarray(readOffset, readOffset + stride));
    readOffset += stride;
    unfilterRow(row, previous, filter, bytesPerPixel);
    for (let x = 0; x < width; x += 1) {
      const pixelOffset = x * bytesPerPixel;
      const alpha = row[pixelOffset + 3];
      if (alpha > 0) {
        visiblePixels += 1;
        colors.add(`${row[pixelOffset]},${row[pixelOffset + 1]},${row[pixelOffset + 2]},${alpha}`);
      }
    }
    row.copy(previous);
  }

  return { width, height, visiblePixels, colorCount: colors.size };
}

function unfilterRow(row: Buffer, previous: Buffer, filter: number, bytesPerPixel: number): void {
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
    const up = previous[index] || 0;
    const upLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] || 0 : 0;
    if (filter === 1) row[index] = (row[index] + left) & 0xff;
    else if (filter === 2) row[index] = (row[index] + up) & 0xff;
    else if (filter === 3) row[index] = (row[index] + Math.floor((left + up) / 2)) & 0xff;
    else if (filter === 4) row[index] = (row[index] + paeth(left, up, upLeft)) & 0xff;
    else assert.equal(filter, 0, `unsupported PNG filter ${filter}`);
  }
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}
