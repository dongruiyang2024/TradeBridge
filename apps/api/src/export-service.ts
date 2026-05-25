import fs from "node:fs/promises";
import path from "node:path";
import type { ExportResponse } from "@wangwang/shared";
import { EXPORTS_DIR } from "./config.js";
import { ConversationService } from "./conversation-service.js";

export class ExportService {
  constructor(private readonly conversations: ConversationService) {}

  async exportCachedMessages(options: {
    conversationIds?: string[];
    maxPages?: number;
    pageSize?: number;
  }): Promise<ExportResponse> {
    const maxPages = clampNumber(options.maxPages, 1, 50, 20);
    const pageSize = clampNumber(options.pageSize, 1, 100, 50);
    const exported = await this.conversations.exportMessages({
      conversationIds: options.conversationIds,
      maxPages,
      pageSize
    });
    await fs.mkdir(EXPORTS_DIR, { recursive: true });
    const fileName = `weblite_cached_messages_${timeStamp()}.json`;
    const output = path.join(EXPORTS_DIR, fileName);
    await fs.writeFile(
      output,
      JSON.stringify(
        {
          schema: "weblite_cached_messages.v2",
          generatedAtUtc: new Date().toISOString(),
          source: "node-fastify",
          options: { maxPages, pageSize },
          conversations: exported
        },
        null,
        2
      ),
      "utf8"
    );
    return {
      ok: true,
      output,
      exportedConversationCount: exported.length,
      exportedMessageCount: exported.reduce((total, item) => total + item.messageCount, 0),
      conversationMessageCounts: exported.map((item) => item.messageCount)
    };
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function timeStamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}
