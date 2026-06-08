import type { OutboundMessage } from "./sync-types.js";
import type { ExtensionStatus } from "./sync-types.js";

export interface OneTalkCustomerProfileContact {
  buyerAccountId: string;
  buyerLoginId?: string;
}

export type ExtensionMessage =
  | { type: "onetalk-page-ready"; url: string }
  | { type: "onetalk-login-required"; url: string }
  | { type: "onetalk-messages-observed"; externalConversationId: string; messages: Record<string, unknown>[] }
  | { type: "onetalk-capture-diagnostics"; seenEventNames: string[] }
  | { type: "send-onetalk-message"; message: OutboundMessage }
  | { type: "get-onetalk-customer-profiles"; contacts: OneTalkCustomerProfileContact[] }
  | { type: "get-onetalk-conversations"; cursor: number; count: number }
  | { type: "get-onetalk-history-messages"; conversations: Record<string, unknown>[]; count: number }
  | { type: "sync-now" }
  | { type: "realtime-reconnect" }
  | { type: "config-updated" }
  | { type: "open-options" }
  | { type: "read-status" }
  | { type: "read-dashboard" };

export interface SyncNowResponse {
  ok: boolean;
  acceptedCount?: number;
  rejectedCount?: number;
  nextCursor?: string | null;
  error?: string;
}

export interface ExtensionDashboardResponse {
  tradeBridgeAccountEmail?: string;
  status: ExtensionStatus;
}
