import type {
  CollectorActivationInput,
  CollectorActivationResult,
  OutboundMessage,
  SyncBatch,
  SyncBatchResult
} from "../shared/sync-types.js";

export interface UploadSyncBatchOptions {
  serverUrl: string;
  collectorToken: string;
  batch: SyncBatch;
}

export interface ListOutboundMessagesOptions {
  serverUrl: string;
  collectorToken: string;
}

export interface MarkOutboundMessageDeliveredOptions {
  serverUrl: string;
  collectorToken: string;
  outboundMessageId: string;
  status: "sent" | "failed";
  externalMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  deliveredAt?: string;
}

export async function uploadSyncBatch(options: UploadSyncBatchOptions): Promise<SyncBatchResult> {
  const response = await fetch(syncBatchUrl(options.serverUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.collectorToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(options.batch)
  });
  const body = await response.json().catch(() => null);

  if (response.status === 401) {
    throw new Error("tradebridge_unauthorized");
  }
  if (!response.ok || !isSyncBatchResponse(body)) {
    throw new Error("tradebridge_upload_failed");
  }

  return {
    acceptedCount: body.acceptedCount,
    rejectedCount: body.rejectedCount,
    nextCursor: body.nextCursor,
    warnings: body.warnings
  };
}

export async function activateCollectorDevice(input: CollectorActivationInput): Promise<CollectorActivationResult> {
  const response = await fetch(collectorAuthUrl(input.serverUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      sellerAccountExternalId: input.sellerAccountExternalId,
      deviceExternalId: input.deviceExternalId,
      deviceName: input.deviceName
    })
  });
  const body = await response.json().catch(() => null);

  if (response.status === 401) throw new Error("invalid_credentials");
  if (response.status === 403) throw new Error("forbidden");
  if (!response.ok) throw new Error(responseErrorCode(body, `collector_activation_failed_${response.status}`));
  if (!isActivationResponse(body)) {
    throw new Error("collector_activation_response_invalid");
  }

  return {
    token: body.token,
    device: body.device
  };
}

export async function listOutboundMessages(options: ListOutboundMessagesOptions): Promise<OutboundMessage[]> {
  const response = await fetch(outboundMessagesUrl(options.serverUrl), {
    headers: {
      Authorization: `Bearer ${options.collectorToken}`
    }
  });
  const body = await response.json().catch(() => null);

  if (response.status === 401) throw new Error("tradebridge_unauthorized");
  if (!response.ok || !isOutboundMessagesResponse(body)) {
    throw new Error("tradebridge_outbound_list_failed");
  }

  return body.messages;
}

export async function markOutboundMessageDelivered(
  options: MarkOutboundMessageDeliveredOptions
): Promise<OutboundMessage> {
  const response = await fetch(outboundDeliveryUrl(options.serverUrl, options.outboundMessageId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.collectorToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(
      stripUndefined({
        status: options.status,
        externalMessageId: options.externalMessageId,
        errorCode: options.errorCode,
        errorMessage: options.errorMessage,
        deliveredAt: options.deliveredAt
      })
    )
  });
  const body = await response.json().catch(() => null);

  if (response.status === 401) throw new Error("tradebridge_unauthorized");
  if (!response.ok || !isOutboundDeliveryResponse(body)) {
    throw new Error("tradebridge_outbound_delivery_failed");
  }

  return body.message;
}

function syncBatchUrl(serverUrl: string): string {
  return new URL("/collector/v1/sync-batches", serverUrl).toString();
}

function collectorAuthUrl(serverUrl: string): string {
  return new URL("/collector/v1/auth/login", serverUrl).toString();
}

function outboundMessagesUrl(serverUrl: string): string {
  return new URL("/collector/v1/outbound-messages", serverUrl).toString();
}

function outboundDeliveryUrl(serverUrl: string, outboundMessageId: string): string {
  return new URL(`/collector/v1/outbound-messages/${encodeURIComponent(outboundMessageId)}/delivery`, serverUrl).toString();
}

function responseErrorCode(body: unknown, fallback: string): string {
  if (isRecord(body) && typeof body.error === "string") return body.error;
  return fallback;
}

function isSyncBatchResponse(value: unknown): value is SyncBatchResult & { ok: true } {
  return (
    isRecord(value) &&
    value.ok === true &&
    typeof value.acceptedCount === "number" &&
    typeof value.rejectedCount === "number" &&
    (typeof value.nextCursor === "string" || value.nextCursor === null) &&
    Array.isArray(value.warnings) &&
    value.warnings.every((item) => typeof item === "string")
  );
}

function isActivationResponse(value: unknown): value is CollectorActivationResult & { ok: true } {
  if (!isRecord(value) || value.ok !== true || typeof value.token !== "string" || !isRecord(value.device)) {
    return false;
  }
  return (
    typeof value.device.id === "string" &&
    typeof value.device.externalDeviceId === "string" &&
    typeof value.device.status === "string" &&
    (value.device.sellerAccountExternalId === undefined ||
      typeof value.device.sellerAccountExternalId === "string") &&
    (value.device.deviceName === undefined || typeof value.device.deviceName === "string")
  );
}

function isOutboundMessagesResponse(value: unknown): value is { ok: true; messages: OutboundMessage[] } {
  return (
    isRecord(value) &&
    value.ok === true &&
    Array.isArray(value.messages) &&
    value.messages.every(isOutboundMessage)
  );
}

function isOutboundDeliveryResponse(value: unknown): value is { ok: true; message: OutboundMessage } {
  return isRecord(value) && value.ok === true && isOutboundMessage(value.message);
}

function isOutboundMessage(value: unknown): value is OutboundMessage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.sellerAccountExternalId === "string" &&
    typeof value.externalCustomerId === "string" &&
    typeof value.externalConversationId === "string" &&
    typeof value.content === "string" &&
    isOutboundStatus(value.status) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isOutboundStatus(value: unknown): value is OutboundMessage["status"] {
  return value === "queued" || value === "sent" || value === "failed";
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
