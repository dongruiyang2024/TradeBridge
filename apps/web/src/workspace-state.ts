import type {
  CustomerScope,
  InternalApiClient,
  StoredConversation,
  StoredCustomer,
  WorkspaceState
} from "./types";

export function createInitialWorkspaceState(input: { orgId: string }): WorkspaceState {
  return {
    orgId: input.orgId,
    status: "等待连接",
    customers: [],
    conversations: [],
    assignment: null,
    messages: [],
    notes: [],
    tags: [],
    tasks: []
  };
}

export async function loadCustomerList(state: WorkspaceState, client: InternalApiClient): Promise<WorkspaceState> {
  const customers = sortCustomers(await client.listCustomers(state.orgId));
  const nextCustomerId = selectedCustomerExists(customers, state.selectedCustomerId)
    ? state.selectedCustomerId
    : customers[0]?.externalCustomerId;
  const nextState: WorkspaceState = {
    ...state,
    customers,
    selectedCustomerId: nextCustomerId,
    status: `已加载 ${customers.length} 个客户`,
    error: undefined
  };
  return nextCustomerId ? selectCustomer(nextState, client, nextCustomerId) : clearSelection(nextState);
}

export async function selectCustomer(
  state: WorkspaceState,
  client: InternalApiClient,
  externalCustomerId: string
): Promise<WorkspaceState> {
  const selectedCustomer = state.customers.find((customer) => customer.externalCustomerId === externalCustomerId);
  if (!selectedCustomer) {
    return {
      ...state,
      selectedCustomerId: undefined,
      selectedConversationId: undefined,
      conversations: [],
      assignment: null,
      messages: [],
      notes: [],
      tags: [],
      tasks: [],
      status: "未找到客户"
    };
  }

  const scope = customerScope(state.orgId, selectedCustomer);
  const allConversations = await client.listConversations(state.orgId);
  const conversations = sortConversations(
    allConversations.filter((conversation) => conversation.externalCustomerId === externalCustomerId)
  );
  const selectedConversationId = conversations[0]?.externalConversationId;
  const [messages, assignment, notes, tags, tasks] = await Promise.all([
    selectedConversationId ? client.listMessages(state.orgId, selectedConversationId) : Promise.resolve([]),
    client.getCustomerAssignment(scope),
    client.listCustomerNotes(scope),
    client.listCustomerTags(scope),
    client.listFollowUpTasks(scope)
  ]);

  return {
    ...state,
    selectedCustomerId: externalCustomerId,
    conversations,
    selectedConversationId,
    assignment,
    messages: sortMessages(messages),
    notes,
    tags,
    tasks,
    status: `${selectedCustomer.displayName || selectedCustomer.externalCustomerId} 已就绪`,
    error: undefined
  };
}

export async function selectConversation(
  state: WorkspaceState,
  client: InternalApiClient,
  externalConversationId: string
): Promise<WorkspaceState> {
  const messages = await client.listMessages(state.orgId, externalConversationId);
  return {
    ...state,
    selectedConversationId: externalConversationId,
    messages: sortMessages(messages),
    status: `已加载 ${messages.length} 条消息`,
    error: undefined
  };
}

export async function createNoteForSelectedCustomer(
  state: WorkspaceState,
  client: InternalApiClient,
  body: string
): Promise<WorkspaceState> {
  const scope = selectedCustomerScope(state);
  const trimmed = body.trim();
  if (!scope || !trimmed) return state;
  const note = await client.createCustomerNote(scope, { body: trimmed });
  return {
    ...state,
    notes: [...state.notes, note],
    status: "笔记已保存",
    error: undefined
  };
}

export async function addTagToSelectedCustomer(
  state: WorkspaceState,
  client: InternalApiClient,
  tag: string
): Promise<WorkspaceState> {
  const scope = selectedCustomerScope(state);
  const trimmed = tag.trim();
  if (!scope || !trimmed) return state;
  const created = await client.addCustomerTag(scope, { tag: trimmed });
  const tags = state.tags.some((item) => item.id === created.id || item.tag === created.tag)
    ? state.tags.map((item) => (item.id === created.id || item.tag === created.tag ? created : item))
    : [...state.tags, created];
  return {
    ...state,
    tags,
    status: "标签已更新",
    error: undefined
  };
}

export async function createTaskForSelectedCustomer(
  state: WorkspaceState,
  client: InternalApiClient,
  title: string
): Promise<WorkspaceState> {
  const scope = selectedCustomerScope(state);
  const trimmed = title.trim();
  if (!scope || !trimmed) return state;
  const task = await client.createFollowUpTask(scope, { title: trimmed });
  return {
    ...state,
    tasks: [...state.tasks, task],
    status: "跟进任务已创建",
    error: undefined
  };
}

function selectedCustomerScope(state: WorkspaceState): CustomerScope | null {
  const customer = state.customers.find((item) => item.externalCustomerId === state.selectedCustomerId);
  return customer ? customerScope(state.orgId, customer) : null;
}

function customerScope(orgId: string, customer: StoredCustomer): CustomerScope {
  return {
    orgId,
    sellerAccountExternalId: customer.sellerAccountExternalId,
    externalCustomerId: customer.externalCustomerId
  };
}

function selectedCustomerExists(customers: StoredCustomer[], selectedCustomerId?: string): boolean {
  return Boolean(selectedCustomerId && customers.some((customer) => customer.externalCustomerId === selectedCustomerId));
}

function clearSelection(state: WorkspaceState): WorkspaceState {
  return {
    ...state,
    selectedCustomerId: undefined,
    selectedConversationId: undefined,
    conversations: [],
    assignment: null,
    messages: [],
    notes: [],
    tags: [],
    tasks: []
  };
}

function sortCustomers(customers: StoredCustomer[]): StoredCustomer[] {
  return [...customers].sort((left, right) =>
    (left.displayName || left.externalCustomerId).localeCompare(right.displayName || right.externalCustomerId)
  );
}

function sortConversations(conversations: StoredConversation[]): StoredConversation[] {
  return [...conversations].sort((left, right) => timestamp(right.lastMessageAt) - timestamp(left.lastMessageAt));
}

function sortMessages<T extends { sentAt?: string }>(messages: T[]): T[] {
  return [...messages].sort((left, right) => timestamp(left.sentAt) - timestamp(right.sentAt));
}

function timestamp(value?: string): number {
  return value ? new Date(value).getTime() : 0;
}
