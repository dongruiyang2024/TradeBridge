import { getChrome } from "../shared/chrome-api.js";
import { createPopupViewModel } from "./popup-view.js";
import type { ExtensionDashboardResponse, SyncNowResponse } from "../shared/extension-messages.js";

const chromeApi = getChrome();
const account = document.querySelector<HTMLParagraphElement>("#account");
const accountValidation = document.querySelector<HTMLParagraphElement>("#account-validation");
const headline = document.querySelector<HTMLSpanElement>("#headline");
const realtime = document.querySelector<HTMLParagraphElement>("#realtime");
const sync = document.querySelector<HTMLParagraphElement>("#sync");
const capture = document.querySelector<HTMLParagraphElement>("#capture");
const error = document.querySelector<HTMLParagraphElement>("#error");

void renderStatus();

document.querySelector<HTMLButtonElement>("#sync-now")?.addEventListener("click", async () => {
  sync?.replaceChildren("最近同步：同步中...");
  const result = (await chromeApi.runtime.sendMessage({ type: "sync-now" })) as SyncNowResponse;
  if (result.ok) {
    sync?.replaceChildren(`最近同步：已同步 ${result.acceptedCount || 0} 条消息`);
    await renderStatus();
  } else {
    error?.replaceChildren(`最近错误：${result.error || "sync_failed"}`);
  }
});

document.querySelector<HTMLButtonElement>("#reconnect")?.addEventListener("click", async () => {
  realtime?.replaceChildren("实时连接：重新连接中...");
  const result = (await chromeApi.runtime.sendMessage({ type: "realtime-reconnect" })) as {
    ok: boolean;
    error?: string;
  };
  if (result.ok) {
    await renderStatus();
  } else {
    error?.replaceChildren(`最近错误：${result.error || "collector_ws_failed"}`);
  }
});

document.querySelector<HTMLButtonElement>("#open-options")?.addEventListener("click", () => {
  chromeApi.runtime.openOptionsPage();
});

async function renderStatus(): Promise<void> {
  const dashboard = (await chromeApi.runtime.sendMessage({ type: "read-dashboard" })) as ExtensionDashboardResponse;
  const view = createPopupViewModel(dashboard);
  account?.replaceChildren(view.accountLabel);
  accountValidation?.replaceChildren(view.accountValidationLabel);
  headline?.replaceChildren(view.headlineLabel);
  realtime?.replaceChildren(view.realtimeLabel);
  sync?.replaceChildren(view.syncLabel);
  capture?.replaceChildren(view.captureLabel);
  error?.replaceChildren(view.errorLabel);
  document.querySelector<HTMLButtonElement>("#reconnect")?.replaceChildren(view.reconnectActionLabel);
}
