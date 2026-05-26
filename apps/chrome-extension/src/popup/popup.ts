import { getChrome } from "../shared/chrome-api.js";
import type { SyncNowResponse } from "../shared/extension-messages.js";
import type { ExtensionStatus } from "../shared/sync-types.js";

const chromeApi = getChrome();
const status = document.querySelector<HTMLParagraphElement>("#status");

void renderStatus();

document.querySelector<HTMLButtonElement>("#sync-now")?.addEventListener("click", async () => {
  status?.replaceChildren("同步中...");
  const result = (await chromeApi.runtime.sendMessage({ type: "sync-now" })) as SyncNowResponse;
  if (result.ok) {
    status?.replaceChildren(`已同步 ${result.acceptedCount || 0} 条消息`);
  } else {
    status?.replaceChildren(`同步失败：${result.error || "sync_failed"}`);
  }
});

document.querySelector<HTMLButtonElement>("#open-options")?.addEventListener("click", () => {
  chromeApi.runtime.openOptionsPage();
});

async function renderStatus(): Promise<void> {
  const current = (await chromeApi.runtime.sendMessage({ type: "read-status" })) as ExtensionStatus;
  if (current.lastError) {
    status?.replaceChildren(`最近错误：${current.lastError.code}`);
    return;
  }
  if (current.lastSyncedAt) {
    status?.replaceChildren(`最近同步：${current.lastSyncedAt}`);
    return;
  }
  status?.replaceChildren("未同步");
}
