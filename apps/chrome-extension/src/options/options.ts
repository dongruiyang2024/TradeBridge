import { ExtensionStateStore } from "../background/storage.js";
import { getChrome } from "../shared/chrome-api.js";
import type { ExtensionConfig } from "../shared/sync-types.js";

const store = new ExtensionStateStore(getChrome().storage.local);
const form = document.querySelector<HTMLFormElement>("#options-form");
const status = document.querySelector<HTMLParagraphElement>("#options-status");

void hydrate();

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const config: ExtensionConfig = {
    serverUrl: required(formData, "serverUrl"),
    sellerAccountExternalId: required(formData, "sellerAccountExternalId"),
    deviceId: required(formData, "deviceId"),
    collectorToken: required(formData, "collectorToken")
  };
  await store.saveConfig(config);
  status?.replaceChildren("已保存");
});

async function hydrate(): Promise<void> {
  const config = await store.getConfig();
  if (!form || !config) return;
  setInput("serverUrl", config.serverUrl);
  setInput("sellerAccountExternalId", config.sellerAccountExternalId);
  setInput("deviceId", config.deviceId);
  setInput("collectorToken", config.collectorToken);
}

function setInput(name: string, value: string): void {
  const input = form?.elements.namedItem(name);
  if (input instanceof HTMLInputElement) input.value = value;
}

function required(formData: FormData, name: string): string {
  const value = String(formData.get(name) || "").trim();
  if (!value) throw new Error(`missing_${name}`);
  return value;
}
