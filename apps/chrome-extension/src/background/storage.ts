import type { ChromeStorageArea } from "../shared/chrome-api.js";
import type { ExtensionConfig, ExtensionStatus } from "../shared/sync-types.js";

export interface ExtensionState {
  config?: ExtensionConfig;
  status?: ExtensionStatus;
}

const CONFIG_KEY = "tradebridgeConfig";
const STATUS_KEY = "tradebridgeStatus";

export class ExtensionStateStore {
  constructor(private readonly storage: ChromeStorageArea) {}

  async getConfig(): Promise<ExtensionConfig | null> {
    const data = await this.storage.get(CONFIG_KEY);
    return isConfig(data[CONFIG_KEY]) ? data[CONFIG_KEY] : null;
  }

  async saveConfig(config: ExtensionConfig): Promise<void> {
    await this.storage.set({ [CONFIG_KEY]: config });
  }

  async getStatus(): Promise<ExtensionStatus> {
    const data = await this.storage.get(STATUS_KEY);
    return isRecord(data[STATUS_KEY]) ? (data[STATUS_KEY] as ExtensionStatus) : {};
  }

  async saveStatus(status: ExtensionStatus): Promise<void> {
    await this.storage.set({ [STATUS_KEY]: status });
  }
}

export function validateConfig(config: ExtensionConfig | null): asserts config is ExtensionConfig {
  if (!config?.serverUrl || !config.collectorToken || !config.sellerAccountExternalId || !config.deviceId) {
    throw new Error("config_required");
  }
}

function isConfig(value: unknown): value is ExtensionConfig {
  return (
    isRecord(value) &&
    typeof value.serverUrl === "string" &&
    typeof value.collectorToken === "string" &&
    typeof value.sellerAccountExternalId === "string" &&
    typeof value.deviceId === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
