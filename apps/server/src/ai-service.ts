import type { CustomerScope, StoredConversation, StoredCustomer, StoredMessage } from "@wangwang/database";

export interface CustomerSummaryInput {
  scope: CustomerScope;
  customer: StoredCustomer | null;
  conversations: StoredConversation[];
  messages: StoredMessage[];
}

export interface GeneratedCustomerSummary {
  promptVersion: string;
  summary: string;
  intentLevel?: string;
  nextAction?: string;
}

export interface ReplySuggestionInput {
  scope: CustomerScope & { externalConversationId: string };
  customer: StoredCustomer | null;
  conversation: StoredConversation;
  messages: StoredMessage[];
  tone?: string;
}

export interface GeneratedReplySuggestion {
  promptVersion: string;
  suggestions: string[];
}

export interface AiProvider {
  generateCustomerSummary(input: CustomerSummaryInput): Promise<GeneratedCustomerSummary>;
  generateReplySuggestion(input: ReplySuggestionInput): Promise<GeneratedReplySuggestion>;
}

export function createDeterministicAiProvider(): AiProvider {
  return {
    async generateCustomerSummary(input) {
      const received = input.messages.filter((message) => message.direction === "received");
      const latest = received.at(-1)?.content || input.messages.at(-1)?.content || "暂无可总结消息";
      return {
        promptVersion: "deterministic-v1",
        summary: `最近客户诉求：${latest}`,
        intentLevel: latest.includes("?") || latest.includes("？") ? "medium" : "unknown",
        nextAction: "人工复核客户上下文"
      };
    },
    async generateReplySuggestion(input) {
      const latestReceived = input.messages.filter((message) => message.direction === "received").at(-1);
      const base = latestReceived?.content || "您的消息我已收到";
      return {
        promptVersion: "deterministic-v1",
        suggestions: [
          `已收到：${base}`,
          input.tone === "concise" ? "我会尽快确认并回复。" : "我会结合 MOQ、交期和物流条款尽快给您完整回复。"
        ]
      };
    }
  };
}
