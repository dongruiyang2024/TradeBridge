import type { OutboundMessage } from "./sync-types.js";
import type { ExtensionStatus } from "./sync-types.js";

export interface OneTalkCustomerProfileContact {
  buyerAccountId: string;
  buyerLoginId?: string;
}

export type ExtensionMessage =
  | { type: "onetalk-page-ready"; url: string }
  | { type: "onetalk-login-required"; url: string }
  | { type: "send-onetalk-message"; message: OutboundMessage }
  | { type: "get-onetalk-im-token"; appKey: string; deviceId: string }
  | { type: "get-onetalk-customer-profiles"; contacts: OneTalkCustomerProfileContact[] }
  | { type: "get-onetalk-conversations"; cursor: number; count: number }
  | { type: "sync-now" }
  | { type: "realtime-reconnect" }
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
