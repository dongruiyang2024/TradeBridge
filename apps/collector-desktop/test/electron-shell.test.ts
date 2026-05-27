import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCollectorShellController,
  createCollectorShellViewModel,
  renderCollectorShellHtml
} from "../src/electron-shell.js";

test("createCollectorShellViewModel summarizes collector state for the desktop shell", () => {
  const viewModel = createCollectorShellViewModel({
    session: {
      hasCookie2: true,
      hasCtoken: true,
      hasTbToken: false,
      hasSgcookie: false
    },
    sellerAccountExternalId: "seller-1",
    sellerDisplayName: "Seller One",
    deviceName: "MacBook",
    deviceStatus: "registered",
    lastSyncAt: "2026-05-25T10:49:00.000Z",
    lastError: { code: "upload_failed", message: "network unavailable" },
    queuedFailedBatchCount: 2
  });

  assert.equal(viewModel.sessionStatus, "ready");
  assert.equal(viewModel.sellerLabel, "Seller One (seller-1)");
  assert.equal(viewModel.deviceLabel, "MacBook - registered");
  assert.equal(viewModel.lastSyncLabel, "2026-05-25 10:49");
  assert.equal(viewModel.lastErrorLabel, "upload_failed: network unavailable");
  assert.equal(viewModel.queuedFailedBatchLabel, "2 queued");
  assert.equal(viewModel.canManualSync, true);
});

test("renderCollectorShellHtml includes the desktop status surface and manual sync button", () => {
  const html = renderCollectorShellHtml(
    createCollectorShellViewModel({
      session: { hasCookie2: false, hasCtoken: false, hasTbToken: false, hasSgcookie: false },
      sellerAccountExternalId: "seller-1",
      deviceName: "MacBook",
      deviceStatus: "collector_activation_required"
    })
  );

  assert.match(html, /旺旺采集器/);
  assert.match(html, /Session/);
  assert.match(html, /Seller/);
  assert.match(html, /Device/);
  assert.match(html, /Last sync/);
  assert.match(html, /Last error/);
  assert.match(html, /Manual sync/);
  assert.match(html, /manual-sync/);
  assert.match(html, /collector_activation_required/);
});

test("createCollectorShellViewModel disables sync until the collector is activated", () => {
  const viewModel = createCollectorShellViewModel({
    session: {
      hasCookie2: true,
      hasCtoken: false,
      hasTbToken: false,
      hasSgcookie: false
    },
    sellerAccountExternalId: "seller-1",
    deviceName: "MacBook",
    deviceStatus: "collector_activation_required"
  });

  assert.equal(viewModel.sessionStatus, "ready");
  assert.equal(viewModel.deviceLabel, "MacBook - collector_activation_required");
  assert.equal(viewModel.canManualSync, false);
});

test("createCollectorShellController reloads state around manual sync actions", async () => {
  const events: string[] = [];
  const controller = createCollectorShellController({
    readStatus: async () => {
      events.push("read");
      return {
        session: { hasCookie2: true, hasCtoken: true, hasTbToken: true, hasSgcookie: false },
        sellerAccountExternalId: "seller-1",
        deviceName: "MacBook",
        deviceStatus: "registered"
      };
    },
    manualSync: async () => {
      events.push("sync");
      return { acceptedCount: 1, rejectedCount: 0, nextCursor: null, warnings: [] };
    }
  });

  const initial = await controller.load();
  const synced = await controller.manualSync();

  assert.equal(initial.sessionStatus, "ready");
  assert.equal(synced.lastRun?.acceptedCount, 1);
  assert.deepEqual(events, ["read", "sync", "read"]);
});
