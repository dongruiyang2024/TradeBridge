import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToString } from "react-dom/server";
import { DashboardView, isSessionForConfig, LoginView, SetupAdminView, UserManagementView } from "../src/App.tsx";
import {
  addTagToSelectedCustomer,
  createInitialDashboardState,
  createNoteForSelectedCustomer,
  createOutboundMessageForSelectedConversation,
  createTaskForSelectedCustomer,
  loadCustomerList,
  selectCustomer
} from "../src/dashboard-state.ts";
import type { DashboardState, InternalApiClient } from "../src/types.ts";

test("login view renders account login without developer token fallback", () => {
  const html = renderToString(
    <LoginView
      serverBaseUrl=""
      email="admin@example.com"
      password=""
      loading={false}
      error=""
      advancedOpen={false}
      onAdvancedOpenChange={() => undefined}
      onServerBaseUrlChange={() => undefined}
      onEmailChange={() => undefined}
      onPasswordChange={() => undefined}
      onPasswordLogin={() => undefined}
      onSetupMode={() => undefined}
    />
  );

  assert.match(html, /登录 TradeBridge/);
  assert.match(html, /邮箱/);
  assert.match(html, /密码/);
  assert.match(html, /初始化首个管理员/);
  assert.doesNotMatch(html, /开发 Token/);
});

test("login view hides raw org input and keeps API in advanced connection settings", () => {
  const html = renderToString(
    <LoginView
      serverBaseUrl=""
      email=""
      password=""
      loading={false}
      error=""
      advancedOpen={false}
      onAdvancedOpenChange={() => undefined}
      onServerBaseUrlChange={() => undefined}
      onEmailChange={() => undefined}
      onPasswordChange={() => undefined}
      onPasswordLogin={() => undefined}
      onSetupMode={() => undefined}
    />
  );

  assert.doesNotMatch(html, /Org/);
  assert.doesNotMatch(html, />API</);
  assert.match(html, /连接设置/);
});

test("setup admin view renders initialization fields", () => {
  const html = renderToString(
    <SetupAdminView
      serverBaseUrl=""
      email="admin@example.com"
      displayName="Admin User"
      password=""
      loading={false}
      error=""
      onServerBaseUrlChange={() => undefined}
      onEmailChange={() => undefined}
      onDisplayNameChange={() => undefined}
      onPasswordChange={() => undefined}
      onSetupAdmin={() => undefined}
      onLoginMode={() => undefined}
    />
  );

  assert.match(html, /初始化首个管理员/);
  assert.match(html, /显示名称/);
  assert.match(html, /创建管理员/);
  assert.doesNotMatch(html, /Org/);
  assert.doesNotMatch(html, /初始化 Token/);
  assert.doesNotMatch(html, /开发 Token/);
});

test("user management view renders internal user list and actions", () => {
  const html = renderToString(
    <UserManagementView
      users={[
        {
          id: "user-admin",
          email: "admin@example.com",
          displayName: "Admin User",
          roles: ["admin"],
          status: "active"
        },
        {
          id: "user-sales",
          email: "sales@example.com",
          displayName: "Sales User",
          roles: ["sales"],
          status: "disabled"
        }
      ]}
      loading={false}
      error=""
      onBack={() => undefined}
      onRefreshUsers={() => undefined}
      onCreateUser={async () => true}
      onDisableUser={() => undefined}
      onResetPassword={async () => true}
    />
  );

  assert.match(html, /用户管理/);
  assert.match(html, /创建用户/);
  assert.match(html, /admin@example.com/);
  assert.match(html, /Sales User/);
  assert.match(html, /禁用/);
  assert.match(html, /重置密码/);
});

test("dashboard renders customer list, selected timeline, and collaboration panel", () => {
  const state = sampleDashboardState();

  const html = renderToString(
    <DashboardView
      state={state}
      serverBaseUrl=""
      loading={false}
      onServerBaseUrlChange={() => undefined}
      currentUser={{
        id: "user-1",
        email: "admin@example.com",
        displayName: "Admin User",
        roles: ["admin"],
        status: "active"
      }}
      onOpenUserManagement={() => undefined}
      onRefresh={() => undefined}
      onSelectCustomer={() => undefined}
      onSelectConversation={() => undefined}
      onAddNote={() => undefined}
      onAddTag={() => undefined}
      onAddTask={() => undefined}
      onSendMessage={() => undefined}
    />
  );

  assert.match(html, /Buyer One/);
  assert.match(html, /hello from buyer/);
  assert.match(html, /Customer asked for updated MOQ/);
  assert.match(html, /hot-lead/);
  assert.match(html, /Send revised quotation/);
  assert.match(html, /Queued reply from web/);
  assert.match(html, /发送到 OneTalk/);
  assert.match(html, /客户外部 ID/);
  assert.match(html, /customer-1/);
  assert.match(html, /seller-1/);
  assert.match(html, /sales-user-42/);
  assert.match(html, /manager-user-7/);
});

test("dashboard hides user management entry for non-admin users", () => {
  const html = renderToString(
    <DashboardView
      state={sampleDashboardState()}
      serverBaseUrl=""
      loading={false}
      onServerBaseUrlChange={() => undefined}
      currentUser={{
        id: "user-sales",
        email: "sales@example.com",
        displayName: "Sales User",
        roles: ["sales"],
        status: "active"
      }}
      onRefresh={() => undefined}
      onSelectCustomer={() => undefined}
      onSelectConversation={() => undefined}
      onAddNote={() => undefined}
      onAddTag={() => undefined}
      onAddTask={() => undefined}
      onSendMessage={() => undefined}
    />
  );

  assert.doesNotMatch(html, />用户</);
});

test("session snapshots are only valid for the current API", () => {
  const session = {
    token: "session-token",
    serverBaseUrl: "/api",
    user: {
      id: "user-admin",
      email: "admin@example.com",
      displayName: "Admin User",
      roles: ["admin" as const],
      status: "active"
    }
  };

  assert.equal(isSessionForConfig(session, { serverBaseUrl: "/api" }), true);
  assert.equal(isSessionForConfig(session, { serverBaseUrl: "/other" }), false);
});

test("customer workflow loads selected customer conversations and updates collaboration state", async () => {
  const client = createFakeClient();
  let state = createInitialDashboardState();

  state = await loadCustomerList(state, client);
  assert.deepEqual(
    state.customers.map((customer) => customer.displayName),
    ["Buyer One", "Buyer Two"]
  );

  state = await selectCustomer(state, client, "customer-2");
  assert.equal(state.selectedCustomerId, "customer-2");
  assert.equal(state.assignment?.assignedToUserId, "sales-user-2");
  assert.deepEqual(
    state.conversations.map((conversation) => conversation.externalConversationId),
    ["conv-2"]
  );
  assert.deepEqual(
    state.messages.map((message) => message.content),
    ["Can you quote 500 units?"]
  );

  state = await createNoteForSelectedCustomer(state, client, "Needs export paperwork.");
  state = await addTagToSelectedCustomer(state, client, "export-ready");
  state = await createTaskForSelectedCustomer(state, client, "Send PI tomorrow");
  state = await createOutboundMessageForSelectedConversation(state, client, "Thanks, I will send it today.");

  assert.equal(state.notes.at(-1)?.body, "Needs export paperwork.");
  assert.equal(state.tags.at(-1)?.tag, "export-ready");
  assert.equal(state.tasks.at(-1)?.title, "Send PI tomorrow");
  assert.equal(state.outboundMessages.at(-1)?.content, "Thanks, I will send it today.");
  assert.equal(state.outboundMessages.at(-1)?.status, "queued");
});

function sampleDashboardState(): DashboardState {
  return {
    status: "已加载",
    customers: [
      {
        sellerAccountExternalId: "seller-1",
        externalCustomerId: "customer-1",
        displayName: "Buyer One",
        country: "US",
        stage: "qualified"
      }
    ],
    selectedCustomerId: "customer-1",
    conversations: [
      {
        sellerAccountExternalId: "seller-1",
        externalConversationId: "conv-1",
        externalCustomerId: "customer-1",
        lastMessageAt: "2026-05-25T09:30:00.000Z"
      }
    ],
    selectedConversationId: "conv-1",
    assignment: {
      id: "assignment-1",
      sellerAccountExternalId: "seller-1",
      externalCustomerId: "customer-1",
      assignedToUserId: "sales-user-42",
      assignedByUserId: "manager-user-7",
      assignedAt: "2026-05-25T08:30:00.000Z",
      updatedAt: "2026-05-25T08:30:00.000Z"
    },
    messages: [
      {
        sellerAccountExternalId: "seller-1",
        externalConversationId: "conv-1",
        direction: "received",
        content: "hello from buyer",
        sentAt: "2026-05-25T09:00:00.000Z",
        contentHash: "hash-1",
        uniqueKey: "msg-1"
      }
    ],
    outboundMessages: [
      {
        id: "outbound-1",
        sellerAccountExternalId: "seller-1",
        externalCustomerId: "customer-1",
        externalConversationId: "conv-1",
        content: "Queued reply from web",
        status: "queued",
        createdAt: "2026-05-25T09:05:00.000Z",
        updatedAt: "2026-05-25T09:05:00.000Z"
      }
    ],
    notes: [
      {
        id: "note-1",
        sellerAccountExternalId: "seller-1",
        externalCustomerId: "customer-1",
        body: "Customer asked for updated MOQ.",
        createdAt: "2026-05-25T09:10:00.000Z",
        updatedAt: "2026-05-25T09:10:00.000Z"
      }
    ],
    tags: [
      {
        id: "tag-1",
        sellerAccountExternalId: "seller-1",
        externalCustomerId: "customer-1",
        tag: "hot-lead",
        createdAt: "2026-05-25T09:11:00.000Z"
      }
    ],
    tasks: [
      {
        id: "task-1",
        sellerAccountExternalId: "seller-1",
        externalCustomerId: "customer-1",
        title: "Send revised quotation",
        status: "open",
        createdAt: "2026-05-25T09:12:00.000Z",
        updatedAt: "2026-05-25T09:12:00.000Z"
      }
    ]
  };
}

function createFakeClient(): InternalApiClient {
  return {
    async login() {
      return {
        token: "internal-token",
        user: {
          id: "user-1",
          email: "admin@example.com",
          displayName: "Admin User",
          status: "active",
          roles: ["admin"]
        }
      };
    },
    async logout() {
      return undefined;
    },
    async setupAdmin() {
      return {
        id: "user-1",
        email: "admin@example.com",
        displayName: "Admin User",
        status: "active",
        roles: ["admin"]
      };
    },
    async listInternalUsers() {
      return [];
    },
    async createInternalUser(input) {
      return {
        id: "user-created",
        email: input.email,
        displayName: input.displayName,
        status: "active",
        roles: input.roles
      };
    },
    async disableInternalUser(input) {
      return {
        id: input.userId,
        email: "disabled@example.com",
        displayName: "Disabled User",
        status: "disabled",
        roles: ["sales"]
      };
    },
    async resetInternalUserPassword(input) {
      return {
        id: input.userId,
        email: "reset@example.com",
        displayName: "Reset User",
        status: "active",
        roles: ["sales"]
      };
    },
    async createInvitation(input) {
      return {
        id: "invitation-1",
        email: input.email,
        displayName: input.displayName,
        roles: input.roles,
        expiresAt: "2026-05-27T00:00:00.000Z",
        createdAt: "2026-05-25T10:00:00.000Z"
      };
    },
    async getInvitation(token) {
      return {
        id: "invitation-1",
        email: "invited@example.com",
        displayName: "Invited User",
        roles: ["sales"],
        token,
        expiresAt: "2026-05-27T00:00:00.000Z",
        createdAt: "2026-05-25T10:00:00.000Z"
      };
    },
    async acceptInvitation(input) {
      return {
        token: "accepted-token",
        user: {
          id: "user-invited",
          email: "invited@example.com",
          displayName: "Invited User",
          status: "active",
          roles: ["sales"]
        },
        invitation: {
          id: "invitation-1",
          email: "invited@example.com",
          displayName: "Invited User",
          roles: ["sales"],
          token: input.token,
          expiresAt: "2026-05-27T00:00:00.000Z",
          acceptedAt: "2026-05-25T10:00:00.000Z",
          createdAt: "2026-05-25T10:00:00.000Z"
        }
      };
    },
    async listCustomers() {
      return [
        {
          sellerAccountExternalId: "seller-1",
          externalCustomerId: "customer-1",
          displayName: "Buyer One"
        },
        {
          sellerAccountExternalId: "seller-1",
          externalCustomerId: "customer-2",
          displayName: "Buyer Two"
        }
      ];
    },
    async listConversations() {
      return [
        {
          sellerAccountExternalId: "seller-1",
          externalConversationId: "conv-1",
          externalCustomerId: "customer-1"
        },
        {
          sellerAccountExternalId: "seller-1",
          externalConversationId: "conv-2",
          externalCustomerId: "customer-2"
        }
      ];
    },
    async listMessages(externalConversationId) {
      return [
        {
          sellerAccountExternalId: "seller-1",
          externalConversationId,
          direction: "received",
          content: externalConversationId === "conv-2" ? "Can you quote 500 units?" : "hello",
          contentHash: `hash-${externalConversationId}`,
          uniqueKey: `message-${externalConversationId}`
        }
      ];
    },
    async listOutboundMessages(scope, externalConversationId) {
      return externalConversationId === "conv-2"
        ? [
            {
              id: "outbound-existing",
              ...scope,
              externalConversationId,
              content: "Existing queued reply",
              status: "queued" as const,
              createdAt: "2026-05-25T10:00:00.000Z",
              updatedAt: "2026-05-25T10:00:00.000Z"
            }
          ]
        : [];
    },
    async createOutboundMessage(scope, externalConversationId, input) {
      return {
        id: "outbound-created",
        ...scope,
        externalConversationId,
        content: input.content,
        status: "queued" as const,
        createdAt: "2026-05-25T10:00:00.000Z",
        updatedAt: "2026-05-25T10:00:00.000Z"
      };
    },
    async listCustomerNotes() {
      return [];
    },
    async getCustomerAssignment(scope) {
      return {
        id: `assignment-${scope.externalCustomerId}`,
        ...scope,
        assignedToUserId: scope.externalCustomerId === "customer-2" ? "sales-user-2" : "sales-user-1",
        assignedByUserId: "manager-user-1",
        assignedAt: "2026-05-25T10:00:00.000Z",
        updatedAt: "2026-05-25T10:00:00.000Z"
      };
    },
    async createCustomerNote(scope, input) {
      return {
        id: "note-created",
        ...scope,
        body: input.body,
        createdAt: "2026-05-25T10:00:00.000Z",
        updatedAt: "2026-05-25T10:00:00.000Z"
      };
    },
    async listCustomerTags() {
      return [];
    },
    async addCustomerTag(scope, input) {
      return {
        id: "tag-created",
        ...scope,
        tag: input.tag,
        createdAt: "2026-05-25T10:00:00.000Z"
      };
    },
    async listFollowUpTasks() {
      return [];
    },
    async createFollowUpTask(scope, input) {
      return {
        id: "task-created",
        ...scope,
        title: input.title,
        status: "open",
        createdAt: "2026-05-25T10:00:00.000Z",
        updatedAt: "2026-05-25T10:00:00.000Z"
      };
    }
  };
}
