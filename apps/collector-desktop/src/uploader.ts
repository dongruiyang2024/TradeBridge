import type { SyncBatch, SyncBatchResult } from "@wangwang/database";

export interface UploadSyncBatchOptions {
  serverUrl: string;
  token: string;
  batch: SyncBatch;
}

export async function uploadSyncBatch(options: UploadSyncBatchOptions): Promise<SyncBatchResult> {
  const response = await fetch(syncBatchUrl(options.serverUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(options.batch)
  });
  const body = await response.json().catch(() => null);

  if (!response.ok || !isSyncBatchResponse(body)) {
    const error = isRecord(body) && typeof body.error === "string" ? body.error : `upload_failed_${response.status}`;
    throw new Error(error);
  }

  return {
    acceptedCount: body.acceptedCount,
    rejectedCount: body.rejectedCount,
    nextCursor: body.nextCursor,
    warnings: body.warnings
  };
}

function syncBatchUrl(serverUrl: string): string {
  return new URL("/collector/v1/sync-batches", serverUrl).toString();
}

function isSyncBatchResponse(value: unknown): value is SyncBatchResult & { ok: boolean } {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
