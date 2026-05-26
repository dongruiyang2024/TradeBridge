import type {
  AcceptInvitationResult,
  CustomerScope,
  InternalApiClient,
  InternalInvitation,
  InternalUser,
  InternalWorkspaceSummary,
  StoredConversation,
  StoredCustomer,
  StoredCustomerAssignment,
  StoredCustomerNote,
  StoredCustomerTag,
  StoredFollowUpTask,
  LoginResult,
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
  assignment?: StoredCustomerAssignment | null;
  notes?: StoredCustomerNote[];
  note?: StoredCustomerNote;
  tags?: StoredCustomerTag[];
  tag?: StoredCustomerTag;
  tasks?: StoredFollowUpTask[];
  task?: StoredFollowUpTask;
  token?: string;
  expiresAt?: string;
  user?: LoginResult["user"];
  workspaces?: InternalWorkspaceSummary[];
  users?: InternalUser[];
  invitation?: InternalInvitation;
}

export class WorkspaceSelectionRequiredError extends Error {
  readonly workspaces: InternalWorkspaceSummary[];

  constructor(workspaces: InternalWorkspaceSummary[]) {
    super("workspace_selection_required");
    this.name = "WorkspaceSelectionRequiredError";
    this.workspaces = workspaces;
  }
}

export function createInternalApiClient(options: CreateInternalApiClientOptions): InternalApiClient {
  const baseUrl = trimTrailingSlash(options.baseUrl || "");
  const fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);

  async function request<T>(
    path: string,
    init: {
      method?: string;
      query?: Record<string, string | undefined>;
      body?: object;
      auth?: boolean;
      bearerToken?: string;
    } = {}
  ): Promise<ApiEnvelope<T>> {
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };
    const token = init.bearerToken ?? (init.auth !== false ? options.token : "");
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    const response = await fetchImpl(buildUrl(baseUrl, path, init.query), {
      method: init.method,
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined
    });
    const text = await response.text();
    const data = text ? (JSON.parse(text) as ApiEnvelope<T>) : ({ ok: response.ok } as ApiEnvelope<T>);
    if (!response.ok || data.ok === false) {
      if (response.status === 409 && data.error === "workspace_selection_required") {
        throw new WorkspaceSelectionRequiredError(data.workspaces || []);
      }
      throw new Error(data.error || response.statusText || "internal_api_error");
    }
    return data;
  }

  return {
    async login(input) {
      const data = await request<LoginResult>("/internal/v1/auth/login", {
        method: "POST",
        auth: false,
        body: input
      });
      return {
        token: requireField(data.token, "token"),
        expiresAt: data.expiresAt,
        user: requireField(data.user, "user")
      };
    },
    async logout() {
      await request<void>("/internal/v1/auth/logout", { method: "POST" });
    },
    async listWorkspaces() {
      const data = await request<InternalWorkspaceSummary[]>("/internal/v1/workspaces");
      return data.workspaces || [];
    },
    async switchWorkspace(orgId) {
      const data = await request<InternalUser>("/internal/v1/workspaces/active", {
        method: "PATCH",
        body: { orgId }
      });
      return requireField(data.user, "user");
    },
    async setupAdmin(input) {
      const data = await request<InternalUser>("/internal/v1/setup/admin", {
        method: "POST",
        auth: false,
        body: input
      });
      return requireField(data.user, "user");
    },
    async listInternalUsers(orgId) {
      const data = await request<InternalUser[]>("/internal/v1/users", { query: { orgId } });
      return data.users || [];
    },
    async createInternalUser(input) {
      const data = await request<InternalUser>("/internal/v1/users", {
        method: "POST",
        body: input
      });
      return requireField(data.user, "user");
    },
    async disableInternalUser(input) {
      const data = await request<InternalUser>(`/internal/v1/users/${encodeURIComponent(input.userId)}/disable`, {
        method: "POST",
        body: { orgId: input.orgId }
      });
      return requireField(data.user, "user");
    },
    async resetInternalUserPassword(input) {
      const data = await request<InternalUser>(
        `/internal/v1/users/${encodeURIComponent(input.userId)}/reset-password`,
        {
          method: "POST",
          body: { orgId: input.orgId, password: input.password }
        }
      );
      return requireField(data.user, "user");
    },
    async createInvitation(input) {
      const data = await request<InternalInvitation>("/internal/v1/invitations", {
        method: "POST",
        body: input
      });
      return requireField(data.invitation, "invitation");
    },
    async getInvitation(token) {
      const data = await request<InternalInvitation>(`/internal/v1/invitations/${encodeURIComponent(token)}`, {
        auth: false
      });
      return requireField(data.invitation, "invitation");
    },
    async acceptInvitation(input) {
      const data = await request<AcceptInvitationResult>(
        `/internal/v1/invitations/${encodeURIComponent(input.token)}/accept`,
        {
          method: "POST",
          auth: false,
          body: { password: input.password }
        }
      );
      return {
        invitation: requireField(data.invitation, "invitation"),
        token: requireField(data.token, "token"),
        expiresAt: data.expiresAt,
        user: requireField(data.user, "user")
      };
    },
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
    async getCustomerAssignment(scope) {
      const data = await request<StoredCustomerAssignment>(customerPath(scope, "assignment"), {
        query: scopeQuery(scope)
      });
      return data.assignment || null;
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
