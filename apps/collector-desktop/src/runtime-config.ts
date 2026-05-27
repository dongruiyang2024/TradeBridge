import type { SyncDeviceInput, SyncSellerAccountInput } from "@wangwang/database";

export interface CollectorRuntimeConfig {
  serverUrl?: string;
  collectorToken?: string;
  sellerAccount: SyncSellerAccountInput;
  device: SyncDeviceInput;
}

const DEFAULT_SELLER_ACCOUNT_ID = "default-seller";
const DEFAULT_DEVICE_NAME = "Desktop Collector";

export function collectorRuntimeConfig(
  env: Record<string, string | undefined>,
  hostname: string
): CollectorRuntimeConfig {
  const deviceName = hostname || DEFAULT_DEVICE_NAME;
  return {
    serverUrl: env.WANGWANG_SERVER_URL,
    collectorToken: env.WANGWANG_COLLECTOR_TOKEN,
    sellerAccount: {
      externalAccountId: DEFAULT_SELLER_ACCOUNT_ID
    },
    device: {
      deviceId: `collector-desktop-${deviceName}`,
      deviceName
    }
  };
}
