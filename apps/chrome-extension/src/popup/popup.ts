import { getChrome } from "../shared/chrome-api.js";
import type { SyncNowResponse } from "../shared/extension-messages.js";
import type { ExtensionStatus, SyncDiagnostics } from "../shared/sync-types.js";

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
    const diagnostics = diagnosticSummary(current.lastDiagnostics);
    status?.replaceChildren(`最近同步：${current.lastSyncedAt}${diagnostics ? `\n${diagnostics}` : ""}`);
    return;
  }
  status?.replaceChildren("未同步");
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
