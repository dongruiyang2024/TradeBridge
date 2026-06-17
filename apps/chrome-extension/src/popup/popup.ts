import { getChrome } from "../shared/chrome-api.js";
import { createPopupViewModel } from "./popup-view.js";
import type { ExtensionDashboardResponse } from "../shared/extension-messages.js";

const chromeApi = getChrome();
const account = document.querySelector<HTMLParagraphElement>("#account");
const accountValidation = document.querySelector<HTMLParagraphElement>("#account-validation");
const headline = document.querySelector<HTMLSpanElement>("#headline");
const realtime = document.querySelector<HTMLParagraphElement>("#realtime");
const sync = document.querySelector<HTMLParagraphElement>("#sync");
const capture = document.querySelector<HTMLParagraphElement>("#capture");
const history = document.querySelector<HTMLParagraphElement>("#history");
const error = document.querySelector<HTMLParagraphElement>("#error");
const reconnectButton = document.querySelector<HTMLButtonElement>("#reconnect");

void renderStatus();

reconnectButton?.addEventListener("click", async () => {
  headline?.replaceChildren("检测中");
  realtime?.replaceChildren("实时同步：重新检测中...");
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
  history?.replaceChildren(view.historyLabel);
  error?.replaceChildren(view.errorLabel);
  if (reconnectButton) {
    reconnectButton.hidden = view.reconnectActionHidden;
    reconnectButton.title = view.reconnectActionLabel;
    reconnectButton.setAttribute("aria-label", view.reconnectActionLabel);
  }
}
