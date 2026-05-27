import type { WeblitePageSnapshot } from "@wangwang/onetalk-adapter/browser";

export const ONETALK_PAGE_SNAPSHOT_STORAGE_KEY = "tradebridgeOnetalkPageSnapshot";

export interface StoredOnetalkPageSnapshot {
  url: string;
  savedAt: string;
  snapshot: WeblitePageSnapshot;
}

export function isStoredOnetalkPageSnapshot(value: unknown): value is StoredOnetalkPageSnapshot {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.url === "string" &&
    typeof record.savedAt === "string" &&
    !!record.snapshot &&
    typeof record.snapshot === "object"
  );
}
