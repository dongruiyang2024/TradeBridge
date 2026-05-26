import type {
  CustomerScope,
  InternalApiClient,
  StoredConversation,
  StoredCustomer,
  StoredCustomerNote,
  StoredCustomerTag,
  StoredFollowUpTask,
  StoredMessage
} from "./types";

export interface CreateInternalApiClientOptions {
  baseUrl?: string;
  token: string;
  fetchImpl?: typeof fetch;
}

interface ApiEnvelope<T> {
  ok: boolean;
  error?: string;
  customers?: StoredCustomer[];
  conversations?: StoredConversation[];
  messages?: StoredMessage[];
  notes?: StoredCustomerNote[];
  note?: StoredCustomerNote;
  tags?: StoredCustomerTag[];
  tag?: StoredCustomerTag;
  tasks?: StoredFollowUpTask[];
  task?: StoredFollowUpTask;
}

export function createInternalApiClient(options: CreateInternalApiClientOptions): InternalApiClient {
  const baseUrl = trimTrailingSlash(options.baseUrl || "");
  const fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);

  async function request<T>(
    path: string,
    init: {
      method?: string;
      query?: Record<string, string | undefined>;
      body?: Record<string, unknown>;
    } = {}
  ): Promise<ApiEnvelope<T>> {
    const response = await fetchImpl(buildUrl(baseUrl, path, init.query), {
      method: init.method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.token}`
      },
      body: init.body ? JSON.stringify(init.body) : undefined
    });
    const text = await response.text();
    const data = text ? (JSON.parse(text) as ApiEnvelope<T>) : ({ ok: response.ok } as ApiEnvelope<T>);
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || response.statusText || "internal_api_error");
    }
    return data;
  }

  return {
    async listCustomers(orgId) {
      const data = await request<StoredCustomer[]>("/internal/v1/customers", { query: { orgId } });
      return data.customers || [];
    },
    async listConversations(orgId) {
      const data = await request<StoredConversation[]>("/internal/v1/conversations", { query: { orgId } });
      return data.conversations || [];
    },
    async listMessages(orgId, externalConversationId) {
      const data = await request<StoredMessage[]>(
        `/internal/v1/conversations/${encodeURIComponent(externalConversationId)}/messages`,
        { query: { orgId } }
      );
      return data.messages || [];
    },
    async listCustomerNotes(scope) {
      const data = await request<StoredCustomerNote[]>(customerPath(scope, "notes"), { query: scopeQuery(scope) });
      return data.notes || [];
    },
    async createCustomerNote(scope, input) {
      const data = await request<StoredCustomerNote>(customerPath(scope, "notes"), {
        method: "POST",
        query: scopeQuery(scope),
        body: input
      });
      return requireField(data.note, "note");
    },
    async listCustomerTags(scope) {
      const data = await request<StoredCustomerTag[]>(customerPath(scope, "tags"), { query: scopeQuery(scope) });
      return data.tags || [];
    },
    async addCustomerTag(scope, input) {
      const data = await request<StoredCustomerTag>(customerPath(scope, "tags"), {
        method: "POST",
        query: scopeQuery(scope),
        body: input
      });
      return requireField(data.tag, "tag");
    },
    async listFollowUpTasks(scope) {
      const data = await request<StoredFollowUpTask[]>(customerPath(scope, "follow-up-tasks"), {
        query: scopeQuery(scope)
      });
      return data.tasks || [];
    },
    async createFollowUpTask(scope, input) {
      const data = await request<StoredFollowUpTask>(customerPath(scope, "follow-up-tasks"), {
        method: "POST",
        query: scopeQuery(scope),
        body: input
      });
      return requireField(data.task, "task");
    }
  };
}

function customerPath(scope: CustomerScope, child: string): string {
  return `/internal/v1/customers/${encodeURIComponent(scope.externalCustomerId)}/${child}`;
}

function scopeQuery(scope: CustomerScope): Record<string, string> {
  return {
    orgId: scope.orgId,
    sellerAccountExternalId: scope.sellerAccountExternalId
  };
}

function buildUrl(baseUrl: string, path: string, query: Record<string, string | undefined> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  const search = params.toString();
  return `${baseUrl}${path}${search ? `?${search}` : ""}`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function requireField<T>(value: T | undefined, field: string): T {
  if (!value) throw new Error(`missing_${field}`);
  return value;
}
