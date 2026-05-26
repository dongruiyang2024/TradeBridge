export type ExtensionMessage =
  | { type: "onetalk-page-ready"; url: string }
  | { type: "sync-now" }
  | { type: "open-options" }
  | { type: "read-status" };

export interface SyncNowResponse {
  ok: boolean;
  acceptedCount?: number;
  rejectedCount?: number;
  nextCursor?: string | null;
  error?: string;
}
