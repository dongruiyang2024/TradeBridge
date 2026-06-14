import { ExtensionStateStore } from "../background/storage.js";
import { activateCollectorDevice } from "../background/tradebridge-client.js";
import { getChrome } from "../shared/chrome-api.js";
import { createActivatedExtensionConfig } from "./activation-config.js";
import { boundedInteger, normalizeServerUrl, serverHostPermissionPatterns } from "./server-url.js";
import type { ExtensionConfig } from "../shared/sync-types.js";

const chromeApi = getChrome();
const store = new ExtensionStateStore(chromeApi.storage.local);
const form = document.querySelector<HTMLFormElement>("#options-form");
const status = document.querySelector<HTMLParagraphElement>("#options-status");
const currentAccount = document.querySelector<HTMLElement>("#current-account");
const currentDevice = document.querySelector<HTMLElement>("#current-device");
const currentDeviceId = document.querySelector<HTMLElement>("#current-device-id");
const DEFAULT_DEVICE_NAME = "Chrome Extension";
const DEFAULT_SYNC_INTERVAL_MINUTES = 30;
const DEFAULT_HISTORY_MESSAGES_PER_CONVERSATION = 20;
let currentConfig: ExtensionConfig | null = null;

void hydrate();

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(form);

  try {
    const serverUrl = normalizeServerUrl(required(formData, "serverUrl"));
    const email = required(formData, "email");
    const syncIntervalMinutes = boundedInteger(formData.get("syncIntervalMinutes"), {
      fallback: currentConfig?.syncIntervalMinutes || DEFAULT_SYNC_INTERVAL_MINUTES,
      min: 5,
      max: 1440
    });
    const historyBackfillEnabled = formData.get("historyBackfillEnabled") === "on";
    const historyMessagesPerConversation = boundedInteger(formData.get("historyMessagesPerConversation"), {
      fallback: currentConfig?.historyMessagesPerConversation || DEFAULT_HISTORY_MESSAGES_PER_CONVERSATION,
      min: 1,
      max: 100
    });
    const deviceExternalId = currentConfig?.deviceId || createDeviceExternalId();
    const deviceName = currentConfig?.deviceName || DEFAULT_DEVICE_NAME;
    const tradeMindBindingToken = optional(formData, "tradeMindBindingToken");
    const sellerAccountExternalId = optional(formData, "sellerAccountExternalId");
    const channelAccountExternalId = optional(formData, "channelAccountExternalId");

    status?.replaceChildren("申请服务器权限...");
    await ensureServerHostPermission(serverUrl);
    status?.replaceChildren("激活中...");
    const activation = await activateCollectorDevice({
      serverUrl,
      email,
      password: required(formData, "password"),
      sellerAccountExternalId,
      tradeMindBindingToken,
      channelAccountExternalId,
      deviceExternalId,
      deviceName
    });
    const config = createActivatedExtensionConfig({
      serverUrl,
      email,
      tradeMindBindingToken,
      sellerAccountExternalId,
      channelAccountExternalId,
      syncIntervalMinutes,
      historyBackfillEnabled,
      historyMessagesPerConversation,
      existingDeviceId: currentConfig?.deviceId,
      existingDeviceName: currentConfig?.deviceName,
      generatedDeviceId: deviceExternalId,
      activation
    });
    await store.saveConfig(config);
    currentConfig = config;
    renderCurrentConfig(config);
    void chromeApi.runtime.sendMessage({ type: "config-updated" });
    status?.replaceChildren("已激活");
  } catch (error) {
    const message = error instanceof Error ? error.message : "collector_activation_failed";
    status?.replaceChildren(`激活失败：${activationErrorMessage(message)}`);
  }
});

async function hydrate(): Promise<void> {
  const config = await store.getConfig();
  currentConfig = config;
  setInput("syncIntervalMinutes", String(config?.syncIntervalMinutes || DEFAULT_SYNC_INTERVAL_MINUTES));
  setInput(
    "historyMessagesPerConversation",
    String(config?.historyMessagesPerConversation || DEFAULT_HISTORY_MESSAGES_PER_CONVERSATION)
  );
  setCheckbox("historyBackfillEnabled", config?.historyBackfillEnabled !== false);
  renderCurrentConfig(config);
  if (!form || !config) return;
  setInput("serverUrl", config.serverUrl);
  setInput("email", config.tradeBridgeAccountEmail);
  setInput("tradeMindBindingToken", config.tradeMindBindingToken);
  setInput("sellerAccountExternalId", config.sellerAccountExternalId);
  setInput("channelAccountExternalId", config.channelAccountExternalId);
}

function setInput(name: string, value?: string): void {
  const input = form?.elements.namedItem(name);
  if (input instanceof HTMLInputElement) input.value = value || "";
}

function setCheckbox(name: string, checked: boolean): void {
  const input = form?.elements.namedItem(name);
  if (input instanceof HTMLInputElement) input.checked = checked;
}

function required(formData: FormData, name: string): string {
  const value = String(formData.get(name) || "").trim();
  if (!value) throw new Error(`missing_${name}`);
  return value;
}

function optional(formData: FormData, name: string): string | undefined {
  const value = String(formData.get(name) || "").trim();
  return value || undefined;
}

async function ensureServerHostPermission(serverUrl: string): Promise<void> {
  if (!chromeApi.permissions) return;
  const origins = serverHostPermissionPatterns(serverUrl);
  const granted = await chromeApi.permissions.request({ origins });
  if (!granted) throw new Error("server_host_permission_denied");
}

function renderCurrentConfig(config: ExtensionConfig | null): void {
  currentAccount?.replaceChildren(config?.tradeBridgeAccountEmail || "未激活");
  currentDevice?.replaceChildren(config?.deviceName || config?.deviceId || "未创建");
  currentDeviceId?.replaceChildren(config?.deviceId || "未创建");
}

function activationErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    missing_serverUrl: "请填写 Server URL",
    missing_email: "请填写管理员邮箱",
    missing_password: "请填写管理员密码",
    invalid_server_url: "Server URL 必须是 http 或 https 地址",
    server_host_permission_denied: "未授予服务器访问权限，插件无法连接 TradeBridge 服务端",
    invalid_collector_login_request: "激活请求格式不匹配，请确认服务端已重启到最新版本",
    invalid_credentials: "管理员邮箱或密码不正确",
    forbidden: "当前账号不是管理员，不能激活采集端",
    collector_activation_failed: "采集端激活请求失败",
    collector_activation_response_invalid: "采集端激活响应格式不正确，请确认 Server URL 指向 TradeBridge 服务端"
  };
  if (code.startsWith("collector_activation_failed_")) {
    return `采集端激活请求失败（HTTP ${code.slice("collector_activation_failed_".length)}），请确认 Server URL 指向 TradeBridge 服务端`;
  }
  return messages[code] || code;
}

function createDeviceExternalId(): string {
  const randomId =
    globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `chrome-extension-${randomId}`;
}
