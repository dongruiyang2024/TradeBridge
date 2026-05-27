import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadWorkspaceEnv } from "@wangwang/env";
import { collectOnce } from "./collector.js";
import {
  createCollectorShellController,
  renderCollectorShellHtml,
  type CollectorShellStatus,
  type CollectorShellViewModel
} from "./electron-shell.js";
import { JsonLocalStateStore } from "./local-state.js";
import { collectorRuntimeConfig } from "./runtime-config.js";

loadWorkspaceEnv();

const statePath =
  process.env.WANGWANG_COLLECTOR_STATE_PATH ||
  path.join(os.homedir(), ".wangwang-collector", "collector-state.json");
const state = new JsonLocalStateStore(statePath);
let mainWindow: any = null;
let appEventsRegistered = false;
let ipcHandlersRegistered = false;
const runtimeConfig = () => collectorRuntimeConfig(process.env, os.hostname());

const controller = createCollectorShellController({
  readStatus: async () => {
    const localState = await state.read();
    const config = runtimeConfig();
    return {
      session: {
        hasCookie2: Boolean(process.env.WANGWANG_COLLECTOR_HAS_COOKIE2),
        hasCtoken: Boolean(process.env.WANGWANG_COLLECTOR_HAS_CTOKEN),
        hasTbToken: Boolean(process.env.WANGWANG_COLLECTOR_HAS_TB_TOKEN),
        hasSgcookie: Boolean(process.env.WANGWANG_COLLECTOR_HAS_SGCOOKIE)
      },
      sellerAccountExternalId: config.sellerAccount.externalAccountId,
      deviceName: config.device.deviceName,
      deviceStatus: config.collectorToken ? "registered" : "collector_activation_required",
      lastSyncAt: localState.cursors[config.sellerAccount.externalAccountId],
      lastError: localState.lastError,
      queuedFailedBatchCount: localState.failedBatches.length
    } satisfies CollectorShellStatus;
  },
  manualSync: async () => {
    const config = runtimeConfig();
    return collectOnce({
      sellerAccount: config.sellerAccount,
      device: config.device,
      serverUrl: requiredEnv("WANGWANG_SERVER_URL"),
      collectorToken: requiredEnv("WANGWANG_COLLECTOR_TOKEN"),
      state
    });
  }
});

void startElectronShell().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function startElectronShell(): Promise<void> {
  const electron = await importElectron();
  const { app, BrowserWindow, ipcMain } = electron;

  await app.whenReady();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 920,
    height: 620,
    minWidth: 760,
    minHeight: 520,
    title: "Wangwang Collector",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  registerIpcHandlers(ipcMain);

  mainWindow.show();
  mainWindow.focus();
  await loadCollectorShell(mainWindow, await controller.load());
  mainWindow.focus();

  if (!appEventsRegistered) {
    app.on("activate", async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await startElectronShell();
      } else if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") app.quit();
    });
    appEventsRegistered = true;
  }
}

function registerIpcHandlers(ipcMain: any): void {
  if (ipcHandlersRegistered) return;
  ipcMain.handle("collector:manual-sync", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    await loadCollectorShell(mainWindow, await controller.manualSync());
    mainWindow.show();
    mainWindow.focus();
    return true;
  });
  ipcHandlersRegistered = true;
}

async function loadCollectorShell(window: any, viewModel: CollectorShellViewModel): Promise<void> {
  const html = renderCollectorShellHtml(viewModel);
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

async function importElectron(): Promise<any> {
  const moduleName = "electron";
  try {
    return await import(moduleName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`electron_runtime_unavailable: ${message}`);
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_required`);
  return value;
}

export function electronEntrypointUrl(): string {
  return pathToFileURL(process.argv[1] || "").href;
}
