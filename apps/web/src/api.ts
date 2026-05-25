import type { ConversationsResponse, CustomerInfoResponse, ExportRequest, ExportResponse, MessagesResponse } from "@wangwang/shared";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {})
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json() as Promise<T>;
}

export function fetchConversations(refresh = false): Promise<ConversationsResponse> {
  return request<ConversationsResponse>(`/api/v1/conversations?refresh=${refresh ? "true" : "false"}`);
}

export function fetchMessages(conversationId: string, before: number | null, limit = 50): Promise<MessagesResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before) params.set("before", String(before));
  return request<MessagesResponse>(`/api/v1/conversations/${conversationId}/messages?${params.toString()}`);
}

export function fetchCustomerInfo(conversationId: string): Promise<CustomerInfoResponse> {
  return request<CustomerInfoResponse>(`/api/v1/conversations/${conversationId}/customer`);
}

export function exportMessages(body: ExportRequest): Promise<ExportResponse> {
  return request<ExportResponse>("/api/v1/export", {
    method: "POST",
    body: JSON.stringify(body)
  });
}
