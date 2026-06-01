import { getChrome } from "../shared/chrome-api.js";
import type { SyncNowResponse } from "../shared/extension-messages.js";
import type { ExtensionRealtimeStatus, ExtensionStatus, SyncDiagnostics } from "../shared/sync-types.js";

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
  const realtime = realtimeSummary(current.realtime);
  if (current.lastError) {
    status?.replaceChildren(`${realtime}\n最近错误：${current.lastError.code}`);
    return;
  }
  if (current.lastSyncedAt) {
    const diagnostics = diagnosticSummary(current.lastDiagnostics);
    status?.replaceChildren(`${realtime}\n最近同步：${current.lastSyncedAt}${diagnostics ? `\n${diagnostics}` : ""}`);
    return;
  }
  status?.replaceChildren(`${realtime}\n未同步`);
}

function realtimeSummary(realtime?: ExtensionRealtimeStatus): string {
  if (!realtime) return "实时连接：未启动";
  if (realtime.state === "connected") return "实时连接：已连接";
  if (realtime.state === "connecting") return "实时连接：连接中";
  if (realtime.state === "error") return `实时连接：异常（${realtime.lastError || "collector_ws_failed"}）`;
  if (realtime.state === "closed") return "实时连接：已断开";
  return "实时连接：未启动";
}

function diagnosticSummary(diagnostics?: SyncDiagnostics): string {
  if (!diagnostics) return "";
  const lines: string[] = [];
  const requests = diagnostics.messageRequests.length;
  const withMessages = diagnostics.messageRequests.filter((item) => item.listLength > 0).length;
  lines.push(`消息接口：${withMessages}/${requests || diagnostics.conversations} 个会话有消息`);
  const lwpRoutes = diagnostics.lwpRoutes || [];
  if (lwpRoutes.length) {
    lines.push(`LWP：${lwpRoutes.filter((item) => item.status === 200).length}/${lwpRoutes.length} 个请求成功`);
  }
  const failures = diagnostics.messageRequests
    .filter((item) => item.status !== 200 || isFailureCode(item.code))
    .map((item) => String(isFailureCode(item.code) ? item.code : `status_${item.status}`));
  if (failures.length) {
    lines.push(`消息失败：${Array.from(new Set(failures)).slice(0, 3).join("、")}`);
  }
  return lines.join("\n");
}

function isFailureCode(code: string | number | null | undefined): boolean {
  if (code == null) return false;
  if (typeof code === "number") return code !== 200;
  return code !== "200" && code.toLowerCase() !== "success";
}
