import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { SyncBatch } from "@wangwang/database";

export interface CollectorLastError {
  code: string;
  message: string;
}

export interface QueuedFailedBatch {
  id: string;
  batch: SyncBatch;
  reason: string;
  createdAt: string;
}

export interface CollectorLocalState {
  cursors: Record<string, string>;
  failedBatches: QueuedFailedBatch[];
  lastError?: CollectorLastError;
}

export interface CollectorStateStore {
  read(): Promise<CollectorLocalState>;
  getCursor(sellerAccountExternalId: string): Promise<string | null>;
  saveCursor(sellerAccountExternalId: string, cursor: string): Promise<void>;
  recordFailedBatch(batch: SyncBatch, reason: string): Promise<QueuedFailedBatch>;
  listFailedBatches(): Promise<QueuedFailedBatch[]>;
  clearFailedBatch(id: string): Promise<void>;
  setLastError(error: CollectorLastError): Promise<void>;
  clearLastError(): Promise<void>;
}

const EMPTY_STATE: CollectorLocalState = {
  cursors: {},
  failedBatches: []
};

export class JsonLocalStateStore implements CollectorStateStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<CollectorLocalState> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY_STATE, cursors: {}, failedBatches: [] };
      throw error;
    }
  }

  async getCursor(sellerAccountExternalId: string): Promise<string | null> {
    const state = await this.read();
    return state.cursors[sellerAccountExternalId] || null;
  }

  async saveCursor(sellerAccountExternalId: string, cursor: string): Promise<void> {
    const state = await this.read();
    state.cursors[sellerAccountExternalId] = cursor;
    await this.write(state);
  }

  async recordFailedBatch(batch: SyncBatch, reason: string): Promise<QueuedFailedBatch> {
    const state = await this.read();
    const failed: QueuedFailedBatch = {
      id: crypto.randomUUID(),
      batch,
      reason,
      createdAt: new Date().toISOString()
    };
    state.failedBatches.push(failed);
    await this.write(state);
    return failed;
  }

  async listFailedBatches(): Promise<QueuedFailedBatch[]> {
    const state = await this.read();
    return state.failedBatches;
  }

  async clearFailedBatch(id: string): Promise<void> {
    const state = await this.read();
    state.failedBatches = state.failedBatches.filter((batch) => batch.id !== id);
    await this.write(state);
  }

  async setLastError(error: CollectorLastError): Promise<void> {
    const state = await this.read();
    state.lastError = error;
    await this.write(state);
  }

  async clearLastError(): Promise<void> {
    const state = await this.read();
    delete state.lastError;
    await this.write(state);
  }

  private async write(state: CollectorLocalState): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
}

function normalizeState(value: unknown): CollectorLocalState {
  const record = isRecord(value) ? value : {};
  return {
    cursors: isRecord(record.cursors) ? Object.fromEntries(Object.entries(record.cursors).filter(([, item]) => typeof item === "string")) as Record<string, string> : {},
    failedBatches: Array.isArray(record.failedBatches) ? record.failedBatches.filter(isQueuedFailedBatch) : [],
    ...(isLastError(record.lastError) ? { lastError: record.lastError } : {})
  };
}

function isQueuedFailedBatch(value: unknown): value is QueuedFailedBatch {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isRecord(value.batch) &&
    typeof value.reason === "string" &&
    typeof value.createdAt === "string"
  );
}

function isLastError(value: unknown): value is CollectorLastError {
  return isRecord(value) && typeof value.code === "string" && typeof value.message === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
