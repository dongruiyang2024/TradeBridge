import type {
  CollectorAccountValidationResult,
  CollectorActivationInput,
  CollectorActivationResult,
  OutboundMessage,
  SyncBatch,
  SyncBatchResult,
  TradeMindBindingValidationResult
} from "../shared/sync-types.js";

export interface UploadSyncBatchOptions {
  serverUrl: string;
  collectorToken: string;
  batch: SyncBatch;
}

export interface ListOutboundMessagesOptions {
  serverUrl: string;
  collectorToken: string;
  channel?: string;
  channelAccountExternalId?: string;
}

export interface MarkOutboundMessageDeliveredOptions {
  serverUrl: string;
  collectorToken: string;
  outboundMessageId: string;
  channel?: string;
  channelAccountExternalId?: string;
  status: "sent" | "failed";
  externalMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  deliveredAt?: string;
}

export interface ValidateTradeBridgeAccountOptions {
  serverUrl: string;
  collectorToken: string;
  timeoutMs?: number;
}

export interface ValidateTradeMindBindingOptions {
  serverUrl: string;
  collectorToken: string;
  tmAliId?: string;
  tmLoginId?: string;
  timeoutMs?: number;
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
  const usingActivationToken = Boolean(input.activationToken);
  const response = await fetch(usingActivationToken ? collectorActivationUrl(input.serverUrl) : collectorAuthUrl(input.serverUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      usingActivationToken
        ? {
            activationToken: input.activationToken,
            sellerAccountExternalId: input.sellerAccountExternalId,
            channelAccountExternalId: input.channelAccountExternalId,
            deviceExternalId: input.deviceExternalId,
            deviceName: input.deviceName
          }
        : {
            email: input.email,
            password: input.password,
            sellerAccountExternalId: input.sellerAccountExternalId,
            tradeMindBindingToken: input.tradeMindBindingToken,
            channelAccountExternalId: input.channelAccountExternalId,
            deviceExternalId: input.deviceExternalId,
            deviceName: input.deviceName
          }
    )
  });
  const body = await response.json().catch(() => null);

  if (response.status === 401) throw new Error(responseErrorCode(body, usingActivationToken ? "activation_token_invalid" : "invalid_credentials"));
  if (response.status === 403) throw new Error("forbidden");
  if (!response.ok) throw new Error(responseErrorCode(body, `collector_activation_failed_${response.status}`));
  if (!isActivationResponse(body)) {
    throw new Error("collector_activation_response_invalid");
  }

  return {
    token: body.token,
    account: body.account,
    device: body.device
  };
}

export async function sendCollectorHeartbeat(options: {
  serverUrl: string;
  collectorToken: string;
  lastSyncAt?: string;
  lastError?: string;
}): Promise<CollectorActivationResult["device"]> {
  const response = await fetch(collectorHeartbeatUrl(options.serverUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.collectorToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      lastSyncAt: options.lastSyncAt,
      lastError: options.lastError
    })
  });
  const body = await response.json().catch(() => null);

  if (response.status === 401) throw new Error("tradebridge_unauthorized");
  if (!response.ok || !isRecord(body) || body.ok !== true || !isCollectorDevice(body.device)) {
    throw new Error("collector_heartbeat_failed");
  }
  return body.device;
}

export async function validateTradeBridgeAccount(
  options: ValidateTradeBridgeAccountOptions
): Promise<CollectorAccountValidationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
  let response: Response;
  try {
    response = await fetch(collectorMeUrl(options.serverUrl), {
      headers: {
        Authorization: `Bearer ${options.collectorToken}`
      },
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("tradebridge_account_validation_timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const body = await response.json().catch(() => null);

  if (response.status === 401) throw new Error("tradebridge_unauthorized");
  if (!response.ok || !isAccountValidationResponse(body)) {
    throw new Error("tradebridge_account_validation_failed");
  }

  return {
    account: body.account,
    device: body.device
  };
}

export async function validateTradeMindBinding(
  options: ValidateTradeMindBindingOptions
): Promise<TradeMindBindingValidationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
  let response: Response;
  try {
    response = await fetch(tradeMindBindingValidateUrl(options.serverUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.collectorToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(
        stripUndefined({
          tmAliId: options.tmAliId,
          tmLoginId: options.tmLoginId
        })
      ),
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("trademind_binding_validation_timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const body = await response.json().catch(() => null);

  if (response.status === 401) throw new Error("tradebridge_unauthorized");
  if (!response.ok) throw new Error(responseErrorCode(body, "trademind_binding_validation_failed"));
  if (!isTradeMindBindingValidationResponse(body)) {
    throw new Error("trademind_binding_validation_response_invalid");
  }

  return body.validation;
}

export async function listOutboundMessages(options: ListOutboundMessagesOptions): Promise<OutboundMessage[]> {
  const response = await fetch(outboundMessagesUrl(options.serverUrl, options), {
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
        channel: options.channel,
        channelAccountExternalId: options.channelAccountExternalId,
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

function collectorActivationUrl(serverUrl: string): string {
  return new URL("/collector/v1/auth/activate", serverUrl).toString();
}

function collectorHeartbeatUrl(serverUrl: string): string {
  return new URL("/collector/v1/heartbeat", serverUrl).toString();
}

function collectorMeUrl(serverUrl: string): string {
  return new URL("/collector/v1/me", serverUrl).toString();
}

function tradeMindBindingValidateUrl(serverUrl: string): string {
  return new URL("/collector/v1/trademind/validate", serverUrl).toString();
}

function outboundMessagesUrl(serverUrl: string, input: { channel?: string; channelAccountExternalId?: string } = {}): string {
  const url = new URL("/collector/v1/outbound-messages", serverUrl);
  if (input.channel) url.searchParams.set("channel", input.channel);
  if (input.channelAccountExternalId) url.searchParams.set("channelAccountExternalId", input.channelAccountExternalId);
  return url.toString();
}

function outboundDeliveryUrl(serverUrl: string, outboundMessageId: string): string {
  return new URL(`/collector/v1/outbound-messages/${encodeURIComponent(outboundMessageId)}/delivery`, serverUrl).toString();
}

function responseErrorCode(body: unknown, fallback: string): string {
  if (isRecord(body) && typeof body.error === "string") {
    const detail = typeof body.detail === "string" && body.detail.trim() ? body.detail.trim() : "";
    return detail ? `${body.error}:${detail}` : body.error;
  }
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
  return (
    isRecord(value) &&
    value.ok === true &&
    typeof value.token === "string" &&
    isCollectorDevice(value.device) &&
    (value.account === undefined || isTradeBridgeAccount(value.account))
  );
}

function isAccountValidationResponse(value: unknown): value is CollectorAccountValidationResult & { ok: true } {
  return isRecord(value) && value.ok === true && isTradeBridgeAccount(value.account) && isCollectorDevice(value.device);
}

function isTradeMindBindingValidationResponse(value: unknown): value is { ok: true; validation: TradeMindBindingValidationResult } {
  return isRecord(value) && value.ok === true && isTradeMindBindingValidation(value.validation);
}

function isTradeMindBindingValidation(value: unknown): value is TradeMindBindingValidationResult {
  return (
    isRecord(value) &&
    typeof value.valid === "boolean" &&
    isTradeMindConnectionStatus(value.status) &&
    isTradeMindBindingStatus(value.bindingStatus) &&
    isTradeMindTokenStatus(value.tokenStatus) &&
    isTradeMindRuntimeStatus(value.runtimeStatus) &&
    isTradeMindRecommendedAction(value.recommendedAction) &&
    (value.reason === undefined || typeof value.reason === "string") &&
    (value.tmAliId === undefined || value.tmAliId === null || typeof value.tmAliId === "string") &&
    (value.tmLoginId === undefined || typeof value.tmLoginId === "string") &&
    (value.userId === undefined || typeof value.userId === "string") &&
    (value.workspaceId === undefined || typeof value.workspaceId === "string") &&
    (value.lastError === undefined || value.lastError === null || typeof value.lastError === "string") &&
    (value.lastHeartbeatAt === undefined || value.lastHeartbeatAt === null || typeof value.lastHeartbeatAt === "string") &&
    (value.lastSyncAt === undefined || value.lastSyncAt === null || typeof value.lastSyncAt === "string") &&
    (value.checkedAt === undefined || typeof value.checkedAt === "string")
  );
}

function isTradeMindBindingStatus(value: unknown): value is TradeMindBindingValidationResult["bindingStatus"] {
  return value === "unbound" || value === "bound" || value === "revoked";
}

function isTradeMindTokenStatus(value: unknown): value is TradeMindBindingValidationResult["tokenStatus"] {
  return value === "valid" || value === "invalid" || value === "unknown";
}

function isTradeMindRuntimeStatus(value: unknown): value is TradeMindBindingValidationResult["runtimeStatus"] {
  return value === "online" || value === "offline" || value === "stale" || value === "error";
}

function isTradeMindRecommendedAction(value: unknown): value is TradeMindBindingValidationResult["recommendedAction"] {
  return value === "none" || value === "open_plugin" || value === "open_onetalk" || value === "rebind" || value === "retry";
}

function isTradeMindConnectionStatus(value: unknown): value is TradeMindBindingValidationResult["status"] {
  return value === "connected" || value === "disconnected" || value === "error" || value === "stale";
}

function isTradeBridgeAccount(value: unknown): value is CollectorAccountValidationResult["account"] {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.email === "string" &&
    typeof value.displayName === "string" &&
    Array.isArray(value.roles) &&
    value.roles.every((role) => typeof role === "string")
  );
}

function isCollectorDevice(value: unknown): value is CollectorActivationResult["device"] {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.externalDeviceId === "string" &&
    typeof value.status === "string" &&
    (value.sellerAccountExternalId === undefined || typeof value.sellerAccountExternalId === "string") &&
    (value.deviceName === undefined || typeof value.deviceName === "string") &&
    (value.lastHeartbeatAt === undefined || typeof value.lastHeartbeatAt === "string") &&
    (value.lastSyncAt === undefined || typeof value.lastSyncAt === "string") &&
    (value.lastError === undefined || typeof value.lastError === "string")
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
	    (value.channel === undefined || typeof value.channel === "string") &&
	    (value.channelAccountExternalId === undefined || typeof value.channelAccountExternalId === "string") &&
	    (value.channelSurface === undefined || typeof value.channelSurface === "string") &&
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
