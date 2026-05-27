import type { ParsedLwpFrame } from "./lwp-protocol.js";

export interface LwpRegisterState {
  ok: boolean;
  uid?: string;
  unitName?: string;
}

export interface LwpConversationPage {
  conversations: Record<string, unknown>[];
  hasMore: boolean;
  nextCursor?: string | number;
}

export interface LwpMessagesPage {
  messages: Record<string, unknown>[];
  hasMore: boolean;
  nextCursor?: string | number;
}

export function lwpRegisterStateFromFrame(frame: ParsedLwpFrame): LwpRegisterState {
  const body = isRecord(frame.body) ? frame.body : {};
  return {
    ok: frame.code === 200,
    uid: stringValue(frame.headers["reg-uid"]),
    unitName: stringValue(body.unitName)
  };
}

export function lwpConversationPageFromFrame(frame: ParsedLwpFrame): LwpConversationPage {
  const body = isRecord(frame.body) ? frame.body : {};
  const conversations = Array.isArray(body.userConvs) ? body.userConvs.filter(isRecord) : [];
  return {
    conversations,
    hasMore: body.hasMore === true,
    nextCursor: cursorValue(body.nextCursor)
  };
}

export function lwpMessagesPageFromFrame(frame: ParsedLwpFrame): LwpMessagesPage {
  const body = isRecord(frame.body) ? frame.body : {};
  const messages = Array.isArray(body.userMessageModels) ? body.userMessageModels.filter(isRecord) : [];
  return {
    messages,
    hasMore: body.hasMore === true,
    nextCursor: cursorValue(body.nextCursor)
  };
}

function cursorValue(value: unknown): string | number | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
