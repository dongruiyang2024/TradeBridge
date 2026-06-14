import type { CollectorActivationResult, ExtensionConfig } from "../shared/sync-types.js";

const DEFAULT_SELLER_ACCOUNT_EXTERNAL_ID = "default-seller";
const DEFAULT_DEVICE_NAME = "Chrome Extension";
const DEFAULT_SYNC_INTERVAL_SECONDS = 10;

export interface CreateActivatedExtensionConfigInput {
  serverUrl: string;
  email: string;
  tradeMindBindingToken?: string;
  sellerAccountExternalId?: string;
  sellerAccountDisplayName?: string;
  channelAccountExternalId?: string;
  syncIntervalMinutes?: number;
  syncIntervalSeconds?: number;
  historyBackfillEnabled?: boolean;
  historyMessagesPerConversation?: number;
  existingDeviceId?: string;
  existingDeviceName?: string;
  generatedDeviceId: string;
  activation: CollectorActivationResult;
}

export function createActivatedExtensionConfig(input: CreateActivatedExtensionConfigInput): ExtensionConfig {
  const deviceName = input.existingDeviceName || DEFAULT_DEVICE_NAME;
  return {
    serverUrl: input.serverUrl,
    tradeBridgeAccountEmail: input.email.trim(),
    sellerAccountExternalId:
      input.activation.device.sellerAccountExternalId ||
      input.sellerAccountExternalId ||
      DEFAULT_SELLER_ACCOUNT_EXTERNAL_ID,
    sellerAccountDisplayName: input.sellerAccountDisplayName,
    channelAccountExternalId: input.channelAccountExternalId,
    tradeMindBindingToken: input.tradeMindBindingToken,
    deviceId: input.activation.device.externalDeviceId || input.existingDeviceId || input.generatedDeviceId,
    deviceName: input.activation.device.deviceName || deviceName,
    collectorToken: input.activation.token,
    syncIntervalMinutes: input.syncIntervalMinutes,
    syncIntervalSeconds: input.syncIntervalSeconds ?? DEFAULT_SYNC_INTERVAL_SECONDS,
    historyBackfillEnabled: input.historyBackfillEnabled,
    historyMessagesPerConversation: input.historyMessagesPerConversation
  };
}
