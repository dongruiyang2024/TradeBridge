import type { WeblitePageSnapshot } from "@wangwang/onetalk-adapter/browser";

export type ExtensionMessage =
  | { type: "onetalk-page-ready"; url: string }
  | { type: "onetalk-login-required"; url: string }
  | { type: "onetalk-page-snapshot"; url: string; snapshot: WeblitePageSnapshot }
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
