import { AutoSyncScheduler } from "./auto-sync-scheduler.js";
import { OneTalkHistoryMessageSource } from "./onetalk-history-message-source.js";
import { OneTalkMessageBuffer } from "./onetalk-message-buffer.js";
import { OneTalkPageWebliteSource } from "./onetalk-page-weblite-source.js";
import { runOutboundDelivery, sendOutboundMessagesViaOneTalk } from "./outbound-orchestrator.js";
import { OutboundPacer } from "./outbound-pacer.js";
import { createRealtimeOrchestrator } from "./realtime-orchestrator.js";
import { ExtensionStateStore, validateConfig } from "./storage.js";
import { runSyncOnce } from "./sync-orchestrator.js";
import {
  listOutboundMessages,
  markOutboundMessageDelivered,
  uploadSyncBatch,
  validateTradeBridgeAccount
} from "./tradebridge-client.js";
import { TradeBridgeWsClient, type TradeBridgeWsState } from "./tradebridge-ws-client.js";
import { getChrome } from "../shared/chrome-api.js";
import type { ExtensionMessage } from "../shared/extension-messages.js";
import type { ExtensionConfig, ExtensionRealtimeStatus, ExtensionStatus } from "../shared/sync-types.js";

const chromeApi = getChrome();
const stateStore = new ExtensionStateStore(chromeApi.storage.local);
const messageBuffer = new OneTalkMessageBuffer(chromeApi.storage.local);
// Single pacer shared by both delivery paths (alarm + realtime claim) so the
// per-account rate window is continuous, not reset per invocation.
const outboundPacer = new OutboundPacer();
const REALTIME_WATCHDOG_ALARM = "tradebridge-realtime-watchdog";
let realtimeClient: TradeBridgeWsClient | null = null;
let realtimeConnecting: Promise<void> | null = null;
let realtimeGeneration = 0;

const realtimeOrchestrator = createRealtimeOrchestrator({
  sendWsMessage: (message) => {
    if (!realtimeClient) throw new Error("collector_ws_not_connected");
    realtimeClient.send(message);
  },
  sendOutboundMessagesViaOneTalk: ({ messages }) =>
    sendOutboundMessagesViaOneTalk({ chromeApi, messages, pacer: outboundPacer }),
  runSyncNow: runDefaultSyncAndOutbound
});

// Coalesces inbound-triggered syncs: when the page tap observes new messages we
// schedule() instead of uploading on every burst. The periodic alarm stays as a
// backstop, but this is what makes captured messages reach the server within a
// couple of seconds without a manual sync.
const autoSyncScheduler = new AutoSyncScheduler({
  runSync: runDefaultSyncAndOutbound
});

chromeApi.runtime.onInstalled.addListener(() => {
  chromeApi.alarms.create("tradebridge-sync", { periodInMinutes: 30 });
  chromeApi.alarms.create("tradebridge-outbound", { periodInMinutes: 1 });
  chromeApi.alarms.create(REALTIME_WATCHDOG_ALARM, { periodInMinutes: 1 });
  void ensureRealtimeConnection();
});

chromeApi.runtime.onStartup?.addListener(() => {
  void ensureRealtimeConnection();
});

chromeApi.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "tradebridge-sync") {
    void runDefaultSyncAndOutbound();
  }
  if (alarm.name === "tradebridge-outbound") {
    void runDefaultOutboundDelivery();
  }
  if (alarm.name === REALTIME_WATCHDOG_ALARM) {
    void ensureRealtimeConnection();
  }
});

chromeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const typed = message as ExtensionMessage;
  if (typed.type === "onetalk-messages-observed") {
    void messageBuffer
      .add(typed.externalConversationId, typed.messages)
      .then(() => recordObservedMessages(typed.messages.length))
      .then(() => {
        // New messages buffered — push them to the server shortly. Debounced so
        // a burst of messages produces one upload, not one per message.
        if (typed.messages.length > 0) autoSyncScheduler.schedule();
      })
      .then(() => sendResponse({ ok: true }));
    return true;
  }
  if (typed.type === "onetalk-capture-diagnostics") {
    void recordSeenEventNames(typed.seenEventNames).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (typed.type === "sync-now") {
    void runDefaultSyncAndOutbound().then(sendResponse);
    return true;
  }
  if (typed.type === "read-status") {
    void stateStore.getStatus().then(sendResponse);
    return true;
  }
  if (typed.type === "read-dashboard") {
    void readDashboard().then(sendResponse);
    return true;
  }
  if (typed.type === "realtime-reconnect") {
    void startRealtimeConnection().then(sendResponse);
    return true;
  }
  return false;
});

void ensureRealtimeConnection();

async function runDefaultSync() {
  return runSyncOnce({
    stateStore,
    onetalkClient: new OneTalkPageWebliteSource({ chromeApi }),
    messageSource: messageBuffer,
    historyMessageSource: new OneTalkHistoryMessageSource({ chromeApi }),
    uploadSyncBatch
  });
}

async function runDefaultSyncAndOutbound() {
  const sync = await runDefaultSync();
  await runDefaultOutboundDelivery();
  return sync;
}

function runDefaultOutboundDelivery() {
  return runOutboundDelivery({
    stateStore,
    chromeApi,
    pacer: outboundPacer,
    listOutboundMessages,
    markOutboundMessageDelivered
  });
}

async function readDashboard() {
  const [config, status] = await Promise.all([stateStore.getConfig(), stateStore.getStatus()]);
  const validatedStatus = config ? await validateStoredTradeBridgeAccount(config, status) : status;
  return {
    tradeBridgeAccountEmail: validatedStatus.accountValidation?.email || config?.tradeBridgeAccountEmail,
    status: validatedStatus
  };
}

async function recordObservedMessages(count: number): Promise<void> {
  if (count <= 0) return;
  const previous = await stateStore.getStatus();
  const capture = previous.captureDiagnostics || { observedMessageCount: 0, seenEventNames: [] };
  await stateStore.saveStatus({
    ...previous,
    captureDiagnostics: {
      ...capture,
      observedMessageCount: capture.observedMessageCount + count,
      lastObservedAt: new Date().toISOString()
    }
  });
}

async function recordSeenEventNames(names: string[]): Promise<void> {
  if (!names.length) return;
  const previous = await stateStore.getStatus();
  const capture = previous.captureDiagnostics || { observedMessageCount: 0, seenEventNames: [] };
  const merged = Array.from(new Set([...capture.seenEventNames, ...names])).slice(0, 60);
  await stateStore.saveStatus({
    ...previous,
    captureDiagnostics: { ...capture, seenEventNames: merged }
  });
}

async function validateStoredTradeBridgeAccount(
  config: ExtensionConfig,
  previousStatus: ExtensionStatus
): Promise<ExtensionStatus> {
  try {
    const result = await validateTradeBridgeAccount({
      serverUrl: config.serverUrl,
      collectorToken: config.collectorToken,
      timeoutMs: 3000
    });
    const accountEmail = result.account.email;
    const isMismatched =
      !!config.tradeBridgeAccountEmail &&
      config.tradeBridgeAccountEmail.trim().toLowerCase() !== accountEmail.trim().toLowerCase();
    const nextStatus: ExtensionStatus = {
      ...previousStatus,
      accountValidation: {
        state: isMismatched ? "invalid" : "valid",
        email: accountEmail,
        checkedAt: new Date().toISOString(),
        error: isMismatched ? "tradebridge_account_mismatch" : undefined
      }
    };
    await stateStore.saveStatus(nextStatus);
    return nextStatus;
  } catch (error) {
    const nextStatus: ExtensionStatus = {
      ...previousStatus,
      accountValidation: {
        state: "invalid",
        email: config.tradeBridgeAccountEmail,
        checkedAt: new Date().toISOString(),
        error: errorMessage(error)
      }
    };
    await stateStore.saveStatus(nextStatus);
    return nextStatus;
  }
}

function ensureRealtimeConnection(): Promise<{ ok: boolean; error?: string }> {
  if (realtimeConnecting || realtimeClient?.state.kind === "connecting" || realtimeClient?.state.kind === "connected") {
    return realtimeConnecting?.then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error: errorMessage(error) })
    ) || Promise.resolve({ ok: true });
  }
  return startRealtimeConnection();
}

async function startRealtimeConnection(): Promise<{ ok: boolean; error?: string }> {
  if (realtimeConnecting) {
    return realtimeConnecting.then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error: errorMessage(error) })
    );
  }

  const config = await stateStore.getConfig();
  try {
    validateConfig(config);
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }

  realtimeGeneration += 1;
  const generation = realtimeGeneration;
  realtimeClient?.close();
  const client = new TradeBridgeWsClient({
    onMessage: (message) => realtimeOrchestrator.handleMessage(message),
    onStateChange: (state) => {
      if (generation !== realtimeGeneration) return undefined;
      return saveRealtimeState(state);
    }
  });
  realtimeClient = client;

  realtimeConnecting = client
    .connect(config)
    .then(() => undefined)
    .catch(async (error) => {
      if (generation === realtimeGeneration) await saveRealtimeError(errorMessage(error));
      throw error;
    })
    .finally(() => {
      if (generation === realtimeGeneration) realtimeConnecting = null;
    });

  return realtimeConnecting.then(
    () => ({ ok: true }),
    (error) => ({ ok: false, error: errorMessage(error) })
  );
}

async function saveRealtimeState(state: TradeBridgeWsState): Promise<void> {
  const previous = await stateStore.getStatus();
  const timestamp = new Date().toISOString();
  const previousRealtime = previous.realtime;
  const realtime: ExtensionRealtimeStatus = {
    state: state.kind,
    lastChangedAt: timestamp,
    reconnectCount: previousRealtime?.reconnectCount || 0,
    sessionId: previousRealtime?.sessionId,
    connectedAt: previousRealtime?.connectedAt,
    disconnectedAt: previousRealtime?.disconnectedAt,
    lastError: previousRealtime?.lastError
  };

  if (state.kind === "connecting") {
    realtime.reconnectCount = (previousRealtime?.reconnectCount || 0) + 1;
    realtime.lastError = undefined;
  }
  if (state.kind === "connected") {
    realtime.sessionId = state.sessionId;
    realtime.connectedAt = timestamp;
    realtime.disconnectedAt = undefined;
    realtime.lastError = undefined;
  }
  if (state.kind === "closed") {
    realtime.disconnectedAt = timestamp;
  }
  if (state.kind === "error") {
    realtime.lastError = state.error;
  }

  await stateStore.saveStatus({ ...previous, realtime });
}

async function saveRealtimeError(message: string): Promise<void> {
  const previous = await stateStore.getStatus();
  await stateStore.saveStatus({
    ...previous,
    realtime: {
      ...previous.realtime,
      state: "error",
      lastChangedAt: new Date().toISOString(),
      lastError: message,
      reconnectCount: previous.realtime?.reconnectCount || 0
    }
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "collector_ws_failed";
}
