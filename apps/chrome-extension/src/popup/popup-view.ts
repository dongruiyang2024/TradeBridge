import type { ExtensionStatus, ExtensionTradeMindBindingStatus, LwpRouteDiagnostic } from "../shared/sync-types.js";

export interface PopupViewInput {
  tradeBridgeAccountEmail?: string;
  status: ExtensionStatus;
  technicalDetails?: {
    serverUrl?: string;
    sellerAccountExternalId?: string;
    deviceId?: string;
  };
}

export interface PopupViewModel {
  accountLabel: string;
  accountValidationLabel: string;
  realtimeLabel: string;
  syncLabel: string;
  captureLabel: string;
  historyLabel: string;
  errorLabel: string;
  headlineLabel: string;
  reconnectActionLabel: string;
  reconnectActionHidden: boolean;
}

export function createPopupViewModel(input: PopupViewInput): PopupViewModel {
  const realtimeLabel = realtimeSummary(input.status);
  return {
    accountLabel: input.tradeBridgeAccountEmail || "未激活",
    accountValidationLabel: accountValidationSummary(input.status),
    realtimeLabel,
    syncLabel: input.status.lastSyncedAt ? `最近同步：${formatTimestamp(input.status.lastSyncedAt)}` : "最近同步：未同步",
    captureLabel: captureSummary(input.status),
    historyLabel: historySummary(input.status),
    errorLabel: input.status.lastError ? `最近错误：${input.status.lastError.code}` : "最近错误：无",
    headlineLabel: realtimeLabel.replace(/^实时(?:连接|同步)：/, ""),
    reconnectActionLabel: "重新连接",
    reconnectActionHidden: reconnectActionHidden(input)
  };
}

function captureSummary(status: ExtensionStatus): string {
  const capture = status.captureDiagnostics;
  if (!capture || (!capture.observedMessageCount && !capture.seenEventNames.length)) return "抓取诊断：未抓取";
  const parts = [`已抓取 ${capture.observedMessageCount} 条`];
  if (capture.seenEventNames.length) parts.push(`${capture.seenEventNames.length} 类事件`);
  return `抓取诊断：${parts.join(" / ")}`;
}

function historySummary(status: ExtensionStatus): string {
  const diagnostics = status.lastDiagnostics;
  if (!diagnostics) return "历史回补：暂无诊断";
  const historyCount = routeTotal(diagnostics.lwpRoutes, "page-sdk-history");
  const liveCount = routeTotal(diagnostics.lwpRoutes, "page-socket-tap");
  return `历史回补：本轮 ${historyCount} 条 / 实时 ${liveCount} 条 / 会话 ${diagnostics.conversations} 个`;
}

function routeTotal(routes: LwpRouteDiagnostic[] | undefined, route: string): number {
  return (routes || [])
    .filter((item) => item.route === route)
    .reduce((total, item) => total + (item.listLength || 0), 0);
}

function accountValidationSummary(status: ExtensionStatus): string {
  const binding = status.tradeMindBinding;
  if (binding) {
    if (needsTradeMindRebind(binding)) return `平台绑定：需要重新绑定${binding.reason ? `（${binding.reason}）` : ""}`;
    if (binding.runtimeStatus === "error" || binding.status === "error") {
      return `平台绑定：校验异常（${binding.reason || "trademind_binding_validation_failed"}）`;
    }
    if (binding.bindingStatus === "unbound") return "平台绑定：未绑定";
    if (binding.bindingStatus === "bound") return "平台绑定：已绑定";
  }

  const validation = status.accountValidation;
  if (!validation || validation.state === "unknown") return "账号校验：未验证";
  if (validation.state === "valid") return "账号校验：已验证";
  return `账号校验：失效（${validation.error || "tradebridge_account_validation_failed"}）`;
}

function reconnectActionHidden(input: PopupViewInput): boolean {
  if (!input.tradeBridgeAccountEmail) return true;
  const binding = input.status.tradeMindBinding;
  if (binding) {
    if (needsTradeMindRebind(binding)) return true;
    if (binding.runtimeStatus === "online") return true;
  }
  const realtime = input.status.realtime;
  if (!realtime) return false;
  return realtime.state === "connected" || realtime.state === "connecting";
}

function realtimeSummary(status: ExtensionStatus): string {
  const binding = status.tradeMindBinding;
  if (binding) {
    if (needsTradeMindRebind(binding)) return "实时同步：未连接";
    if (binding.runtimeStatus === "online" || binding.status === "connected") return "实时同步：已连接";
    if (binding.runtimeStatus === "stale" || binding.status === "stale") return "实时同步：等待 OneTalk 同步";
    if (binding.runtimeStatus === "offline" || binding.status === "disconnected") return "实时同步：等待插件上线";
    return `实时同步：异常（${binding.reason || "trademind_binding_validation_failed"}）`;
  }

  const realtime = status.realtime;
  if (!realtime) return "实时连接：未启动";
  if (realtime.state === "connected") return "实时连接：已连接";
  if (realtime.state === "connecting") return "实时连接：连接中";
  if (realtime.state === "error") return `实时连接：异常（${realtime.lastError || "collector_ws_failed"}）`;
  if (realtime.state === "closed") return "实时连接：已断开";
  return "实时连接：未启动";
}

function needsTradeMindRebind(binding: ExtensionTradeMindBindingStatus): boolean {
  return binding.recommendedAction === "rebind" || binding.bindingStatus === "revoked" || binding.tokenStatus === "invalid";
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (item: number) => String(item).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}
