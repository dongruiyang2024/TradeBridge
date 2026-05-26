import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToString } from "react-dom/server";
import { LoginView, WorkspaceView } from "../src/App.tsx";
import {
  addTagToSelectedCustomer,
  createInitialWorkspaceState,
  createNoteForSelectedCustomer,
  createTaskForSelectedCustomer,
  loadCustomerList,
  selectCustomer
} from "../src/workspace-state.ts";
import type { InternalApiClient, WorkspaceState } from "../src/types.ts";

test("login view renders account login and developer token fallback", () => {
  const html = renderToString(
    <LoginView
      orgId="org_internal"
      serverBaseUrl=""
      email="admin@example.com"
      password=""
      developerToken=""
      loading={false}
      error=""
      onOrgIdChange={() => undefined}
      onServerBaseUrlChange={() => undefined}
      onEmailChange={() => undefined}
      onPasswordChange={() => undefined}
      onDeveloperTokenChange={() => undefined}
      onPasswordLogin={() => undefined}
      onDeveloperTokenLogin={() => undefined}
    />
  );

  assert.match(html, /登录 TradeBridge/);
  assert.match(html, /邮箱/);
  assert.match(html, /密码/);
  assert.match(html, /开发 Token/);
});

test("workspace renders customer list, selected timeline, and collaboration panel", () => {
  const state = sampleWorkspaceState();

  const html = renderToString(
    <WorkspaceView
      state={state}
      serverBaseUrl=""
      orgId="org_internal"
      loading={false}
      onServerBaseUrlChange={() => undefined}
      onOrgIdChange={() => undefined}
      onRefresh={() => undefined}
      onSelectCustomer={() => undefined}
      onSelectConversation={() => undefined}
      onAddNote={() => undefined}
      onAddTag={() => undefined}
      onAddTask={() => undefined}
    />
  );

  assert.match(html, /Buyer One/);
  assert.match(html, /hello from buyer/);
  assert.match(html, /Customer asked for updated MOQ/);
  assert.match(html, /hot-lead/);
  assert.match(html, /Send revised quotation/);
  assert.match(html, /客户外部 ID/);
  assert.match(html, /customer-1/);
  assert.match(html, /seller-1/);
  assert.match(html, /sales-user-42/);
  assert.match(html, /manager-user-7/);
});

test("customer workflow loads selected customer conversations and updates collaboration state", async () => {
  const client = createFakeClient();
  let state = createInitialWorkspaceState({ orgId: "org_internal" });

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

  assert.equal(state.notes.at(-1)?.body, "Needs export paperwork.");
  assert.equal(state.tags.at(-1)?.tag, "export-ready");
  assert.equal(state.tasks.at(-1)?.title, "Send PI tomorrow");
});

function sampleWorkspaceState(): WorkspaceState {
  return {
    orgId: "org_internal",
    status: "已加载",
    customers: [
      {
        orgId: "org_internal",
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
        orgId: "org_internal",
        sellerAccountExternalId: "seller-1",
        externalConversationId: "conv-1",
        externalCustomerId: "customer-1",
        lastMessageAt: "2026-05-25T09:30:00.000Z"
      }
    ],
    selectedConversationId: "conv-1",
    assignment: {
      id: "assignment-1",
      orgId: "org_internal",
      sellerAccountExternalId: "seller-1",
      externalCustomerId: "customer-1",
      assignedToUserId: "sales-user-42",
      assignedByUserId: "manager-user-7",
      assignedAt: "2026-05-25T08:30:00.000Z",
      updatedAt: "2026-05-25T08:30:00.000Z"
    },
    messages: [
      {
        orgId: "org_internal",
        sellerAccountExternalId: "seller-1",
        externalConversationId: "conv-1",
        direction: "received",
        content: "hello from buyer",
        sentAt: "2026-05-25T09:00:00.000Z",
        contentHash: "hash-1",
        uniqueKey: "msg-1"
      }
    ],
    notes: [
      {
        id: "note-1",
        orgId: "org_internal",
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
        orgId: "org_internal",
        sellerAccountExternalId: "seller-1",
        externalCustomerId: "customer-1",
        tag: "hot-lead",
        createdAt: "2026-05-25T09:11:00.000Z"
      }
    ],
    tasks: [
      {
        id: "task-1",
        orgId: "org_internal",
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
          orgId: "org_internal",
          email: "admin@example.com",
          roles: ["admin"]
        }
      };
    },
    async listCustomers() {
      return [
        {
          orgId: "org_internal",
          sellerAccountExternalId: "seller-1",
          externalCustomerId: "customer-1",
          displayName: "Buyer One"
        },
        {
          orgId: "org_internal",
          sellerAccountExternalId: "seller-1",
          externalCustomerId: "customer-2",
          displayName: "Buyer Two"
        }
      ];
    },
    async listConversations() {
      return [
        {
          orgId: "org_internal",
          sellerAccountExternalId: "seller-1",
          externalConversationId: "conv-1",
          externalCustomerId: "customer-1"
        },
        {
          orgId: "org_internal",
          sellerAccountExternalId: "seller-1",
          externalConversationId: "conv-2",
          externalCustomerId: "customer-2"
        }
      ];
    },
    async listMessages(_orgId, externalConversationId) {
      return [
        {
          orgId: "org_internal",
          sellerAccountExternalId: "seller-1",
          externalConversationId,
          direction: "received",
          content: externalConversationId === "conv-2" ? "Can you quote 500 units?" : "hello",
          contentHash: `hash-${externalConversationId}`,
          uniqueKey: `message-${externalConversationId}`
        }
      ];
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
