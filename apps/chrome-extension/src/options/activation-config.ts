import type { CollectorActivationResult, ExtensionConfig } from "../shared/sync-types.js";

const DEFAULT_SELLER_ACCOUNT_EXTERNAL_ID = "default-seller";
const DEFAULT_DEVICE_NAME = "Chrome Extension";

export interface CreateActivatedExtensionConfigInput {
  serverUrl: string;
  email: string;
  syncIntervalMinutes?: number;
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
    sellerAccountExternalId: input.activation.device.sellerAccountExternalId || DEFAULT_SELLER_ACCOUNT_EXTERNAL_ID,
    deviceId: input.activation.device.externalDeviceId || input.existingDeviceId || input.generatedDeviceId,
    deviceName: input.activation.device.deviceName || deviceName,
    collectorToken: input.activation.token,
    syncIntervalMinutes: input.syncIntervalMinutes,
    historyBackfillEnabled: input.historyBackfillEnabled,
    historyMessagesPerConversation: input.historyMessagesPerConversation
  };
}
