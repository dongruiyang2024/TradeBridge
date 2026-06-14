import { detectOneTalkAccount } from "../background/onetalk-account-client.js";
import { ExtensionStateStore } from "../background/storage.js";
import { activateCollectorDevice } from "../background/tradebridge-client.js";
import { getChrome } from "../shared/chrome-api.js";
import type { ExtensionConfig } from "../shared/sync-types.js";
import { createActivatedExtensionConfig } from "./activation-config.js";
import { boundedInteger, normalizeServerUrl, serverHostPermissionPatterns } from "./server-url.js";

const chromeApi = getChrome();
const store = new ExtensionStateStore(chromeApi.storage.local);
const form = document.querySelector<HTMLFormElement>("#options-form");
const status = document.querySelector<HTMLParagraphElement>("#options-status");
const currentAccount = document.querySelector<HTMLElement>("#current-account");
const currentDevice = document.querySelector<HTMLElement>("#current-device");
const currentDeviceId = document.querySelector<HTMLElement>("#current-device-id");
const detectedLoginId = document.querySelector<HTMLElement>("#detected-login-id");
const detectedAliId = document.querySelector<HTMLElement>("#detected-ali-id");
const serverUrlDisplay = document.querySelector<HTMLElement>("#server-url");
const DEFAULT_SERVER_URL = "http://localhost:3001";
const DEFAULT_DEVICE_NAME = "Chrome Extension";
const DEFAULT_SYNC_INTERVAL_SECONDS = 10;
const DEFAULT_HISTORY_MESSAGES_PER_CONVERSATION = 20;
let currentConfig: ExtensionConfig | null = null;

void hydrate();

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(form);

  try {
    const serverUrl = normalizeServerUrl(DEFAULT_SERVER_URL);
    const email = required(formData, "email");
    const historyBackfillEnabled = formData.get("historyBackfillEnabled") === "on";
    const historyMessagesPerConversation = boundedInteger(formData.get("historyMessagesPerConversation"), {
      fallback: currentConfig?.historyMessagesPerConversation || DEFAULT_HISTORY_MESSAGES_PER_CONVERSATION,
      min: 1,
      max: 100
    });
    const deviceExternalId = currentConfig?.deviceId || createDeviceExternalId();
    const deviceName = currentConfig?.deviceName || DEFAULT_DEVICE_NAME;
    const tradeMindBindingToken = optional(formData, "tradeMindBindingToken");

    status?.replaceChildren("检测 OneTalk 账号...");
    const oneTalkAccount = await detectOneTalkAccount(chromeApi);
    renderDetectedOneTalkAccount(oneTalkAccount.loginId, oneTalkAccount.aliId);

    status?.replaceChildren("申请本地服务权限...");
    await ensureServerHostPermission(serverUrl);
    status?.replaceChildren("激活中...");
    const activation = await activateCollectorDevice({
      serverUrl,
      email,
      password: required(formData, "password"),
      sellerAccountExternalId: oneTalkAccount.aliId,
      tradeMindBindingToken,
      channelAccountExternalId: oneTalkAccount.loginId,
      deviceExternalId,
      deviceName
    });
    const config = createActivatedExtensionConfig({
      serverUrl,
      email,
      tradeMindBindingToken,
      sellerAccountExternalId: oneTalkAccount.aliId,
      channelAccountExternalId: oneTalkAccount.loginId,
      syncIntervalSeconds: DEFAULT_SYNC_INTERVAL_SECONDS,
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
    status?.replaceChildren("激活失败：" + activationErrorMessage(message));
  }
});

async function hydrate(): Promise<void> {
  const config = await store.getConfig();
  currentConfig = config;
  serverUrlDisplay?.replaceChildren("本地服务 " + DEFAULT_SERVER_URL);
  setInput(
    "historyMessagesPerConversation",
    String(config?.historyMessagesPerConversation || DEFAULT_HISTORY_MESSAGES_PER_CONVERSATION)
  );
  setCheckbox("historyBackfillEnabled", config?.historyBackfillEnabled !== false);
  renderCurrentConfig(config);
  renderDetectedOneTalkAccount(config?.channelAccountExternalId, config?.sellerAccountExternalId);
  if (!form || !config) return;
  setInput("email", config.tradeBridgeAccountEmail);
  setInput("tradeMindBindingToken", config.tradeMindBindingToken);
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
  if (!value) throw new Error("missing_" + name);
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

function renderDetectedOneTalkAccount(loginId?: string, aliId?: string): void {
  detectedLoginId?.replaceChildren(loginId || "保存时自动检测");
  detectedAliId?.replaceChildren(aliId || "保存时自动检测");
}

function activationErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    missing_email: "请填写管理员邮箱",
    missing_password: "请填写管理员密码",
    invalid_server_url: "本地 TradeBridge 服务地址无效",
    server_host_permission_denied: "未授予本地服务访问权限，插件无法连接 TradeBridge 服务端",
    onetalk_tab_required: "请先打开并登录 OneTalk 页面，再回到这里保存",
    chrome_tabs_unavailable: "浏览器标签页权限不可用，无法检测 OneTalk 账号",
    missing_onetalk_account_identity: "未检测到 OneTalk Login ID 或 Ali ID，请确认 OneTalk 已登录后重试",
    invalid_collector_login_request: "激活请求格式不匹配，请确认服务端已重启到最新版本",
    invalid_credentials: "管理员邮箱或密码不正确",
    forbidden: "当前账号不是管理员，不能激活采集端",
    missing_trademind_channel_account: "未检测到 OneTalk Login ID，无法完成 Trade-Mind 绑定",
    collector_activation_failed: "采集端激活请求失败",
    collector_activation_response_invalid: "采集端激活响应格式不正确，请确认本地 TradeBridge 服务已启动"
  };
  if (code.startsWith("collector_activation_failed_")) {
    return "采集端激活请求失败（HTTP " + code.slice("collector_activation_failed_".length) + "），请确认本地 TradeBridge 服务已启动";
  }
  return messages[code] || code;
}

function createDeviceExternalId(): string {
  const randomId =
    globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  return "chrome-extension-" + randomId;
}
