import { ExtensionStateStore } from "../background/storage.js";
import { activateCollectorDevice } from "../background/tradebridge-client.js";
import { getChrome } from "../shared/chrome-api.js";
import type { ExtensionConfig } from "../shared/sync-types.js";

const store = new ExtensionStateStore(getChrome().storage.local);
const form = document.querySelector<HTMLFormElement>("#options-form");
const status = document.querySelector<HTMLParagraphElement>("#options-status");

void hydrate();

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(form);

  try {
    const serverUrl = required(formData, "serverUrl");
    const sellerAccountExternalId = required(formData, "sellerAccountExternalId");
    const deviceExternalId = required(formData, "deviceExternalId");
    const deviceName = optional(formData, "deviceName");

    status?.replaceChildren("激活中...");
    const activation = await activateCollectorDevice({
      serverUrl,
      email: required(formData, "email"),
      password: required(formData, "password"),
      sellerAccountExternalId,
      deviceExternalId,
      deviceName
    });
    const config: ExtensionConfig = {
      serverUrl,
      sellerAccountExternalId,
      deviceId: activation.device.externalDeviceId,
      deviceName: activation.device.deviceName || deviceName,
      collectorToken: activation.token
    };
    await store.saveConfig(config);
    status?.replaceChildren("已激活");
  } catch (error) {
    const message = error instanceof Error ? error.message : "collector_activation_failed";
    status?.replaceChildren(`激活失败：${activationErrorMessage(message)}`);
  }
});

async function hydrate(): Promise<void> {
  const config = await store.getConfig();
  if (!form || !config) return;
  setInput("serverUrl", config.serverUrl);
  setInput("sellerAccountExternalId", config.sellerAccountExternalId);
  setInput("deviceExternalId", config.deviceId);
  setInput("deviceName", config.deviceName);
}

function setInput(name: string, value?: string): void {
  const input = form?.elements.namedItem(name);
  if (input instanceof HTMLInputElement) input.value = value || "";
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

function activationErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    missing_serverUrl: "请填写 Server URL",
    missing_email: "请填写管理员邮箱",
    missing_password: "请填写管理员密码",
    missing_sellerAccountExternalId: "请填写卖家账号 ID，例如 seller-demo",
    missing_deviceExternalId: "请填写设备 ID，例如 chrome-extension-demo",
    invalid_credentials: "管理员邮箱或密码不正确",
    forbidden: "当前账号不是管理员，不能激活采集端",
    collector_activation_failed: "采集端激活请求失败"
  };
  return messages[code] || code;
}
