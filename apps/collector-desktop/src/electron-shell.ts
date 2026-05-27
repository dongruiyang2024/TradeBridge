import type { SyncBatchResult } from "@wangwang/database";
import type { CollectorLastError } from "./local-state.js";

export interface CollectorShellSessionStatus {
  hasCookie2: boolean;
  hasCtoken: boolean;
  hasTbToken: boolean;
  hasSgcookie: boolean;
}

export interface CollectorShellStatus {
  session: CollectorShellSessionStatus;
  sellerAccountExternalId?: string;
  sellerDisplayName?: string;
  deviceName?: string;
  deviceStatus?: string;
  lastSyncAt?: string;
  lastError?: CollectorLastError;
  queuedFailedBatchCount?: number;
}

export interface CollectorShellViewModel {
  sessionStatus: "ready" | "missing-session";
  sellerLabel: string;
  deviceLabel: string;
  lastSyncLabel: string;
  lastErrorLabel: string;
  queuedFailedBatchLabel: string;
  canManualSync: boolean;
  lastRun?: SyncBatchResult;
}

export interface CollectorShellControllerOptions {
  readStatus: () => Promise<CollectorShellStatus>;
  manualSync: () => Promise<SyncBatchResult>;
}

export interface CollectorShellController {
  load(): Promise<CollectorShellViewModel>;
  manualSync(): Promise<CollectorShellViewModel>;
}

export function createCollectorShellViewModel(
  status: CollectorShellStatus,
  lastRun?: SyncBatchResult
): CollectorShellViewModel {
  const hasSession = status.session.hasCookie2 || status.session.hasCtoken || status.session.hasTbToken || status.session.hasSgcookie;
  return {
    sessionStatus: hasSession ? "ready" : "missing-session",
    sellerLabel: sellerLabel(status),
    deviceLabel: [status.deviceName || "Unregistered device", status.deviceStatus].filter(Boolean).join(" - "),
    lastSyncLabel: formatDateMinute(status.lastSyncAt),
    lastErrorLabel: status.lastError ? `${status.lastError.code}: ${status.lastError.message}` : "No error",
    queuedFailedBatchLabel: `${status.queuedFailedBatchCount || 0} queued`,
    canManualSync: hasSession && status.deviceStatus === "registered",
    ...(lastRun ? { lastRun } : {})
  };
}

export function createCollectorShellController(options: CollectorShellControllerOptions): CollectorShellController {
  let lastRun: SyncBatchResult | undefined;
  return {
    async load() {
      return createCollectorShellViewModel(await options.readStatus(), lastRun);
    },
    async manualSync() {
      lastRun = await options.manualSync();
      return createCollectorShellViewModel(await options.readStatus(), lastRun);
    }
  };
}

export function renderCollectorShellHtml(viewModel: CollectorShellViewModel): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>旺旺采集器</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #182026;
      --muted: #61707d;
      --line: #d6dde2;
      --paper: #f7f4ee;
      --panel: #ffffff;
      --accent: #0f7b6c;
      --warn: #aa3f25;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--paper);
      color: var(--ink);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      letter-spacing: 0;
    }
    main {
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr auto;
    }
    header, footer {
      padding: 18px 22px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    footer {
      border-top: 1px solid var(--line);
      border-bottom: 0;
      color: var(--muted);
      font-size: 12px;
    }
    h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
    }
    .status-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1px;
      background: var(--line);
      border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
    }
    .cell {
      min-height: 118px;
      padding: 18px 22px;
      background: var(--panel);
      display: grid;
      align-content: space-between;
      gap: 16px;
    }
    .label {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
    }
    .value {
      font-size: 20px;
      overflow-wrap: anywhere;
    }
    .value[data-state="missing-session"],
    .value[data-state="error"] {
      color: var(--warn);
    }
    .toolbar {
      padding: 22px;
      background: var(--panel);
      display: flex;
      gap: 12px;
      align-items: center;
    }
    button {
      min-height: 42px;
      border: 1px solid #0b5f54;
      background: var(--accent);
      color: #fff;
      padding: 0 18px;
      font: inherit;
      cursor: pointer;
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.48;
    }
    .run {
      color: var(--muted);
      font-size: 13px;
    }
  </style>
</head>
<body>
  <main>
    <header><h1>旺旺采集器</h1></header>
    <section class="status-grid">
      ${statusCell("Session", viewModel.sessionStatus, viewModel.sessionStatus)}
      ${statusCell("Seller", viewModel.sellerLabel)}
      ${statusCell("Device", viewModel.deviceLabel)}
      ${statusCell("Last sync", viewModel.lastSyncLabel)}
      ${statusCell("Last error", viewModel.lastErrorLabel, viewModel.lastErrorLabel === "No error" ? undefined : "error")}
      ${statusCell("Failed queue", viewModel.queuedFailedBatchLabel)}
    </section>
    <section class="toolbar">
      <button id="manual-sync" ${viewModel.canManualSync ? "" : "disabled"}>Manual sync</button>
      <span class="run">${lastRunLabel(viewModel.lastRun)}</span>
    </section>
    <footer>Collector desktop shell</footer>
  </main>
  <script>
    const button = document.getElementById("manual-sync");
    button?.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const electron = typeof require === "function" ? require("electron") : null;
        await electron?.ipcRenderer?.invoke("collector:manual-sync");
      } finally {
        button.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

function statusCell(label: string, value: string, state?: string): string {
  return `<div class="cell"><div class="label">${escapeHtml(label)}</div><div class="value"${state ? ` data-state="${escapeHtml(state)}"` : ""}>${escapeHtml(value)}</div></div>`;
}

function sellerLabel(status: CollectorShellStatus): string {
  if (status.sellerDisplayName && status.sellerAccountExternalId) {
    return `${status.sellerDisplayName} (${status.sellerAccountExternalId})`;
  }
  return status.sellerDisplayName || status.sellerAccountExternalId || "Unknown seller";
}

function formatDateMinute(value: string | undefined): string {
  if (!value) return "Never";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toISOString().slice(0, 16).replace("T", " ");
}

function lastRunLabel(result: SyncBatchResult | undefined): string {
  if (!result) return "Idle";
  return `Accepted ${result.acceptedCount}, rejected ${result.rejectedCount}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
