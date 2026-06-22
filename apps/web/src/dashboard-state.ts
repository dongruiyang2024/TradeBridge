import type {
  CustomerScope,
  InternalApiClient,
  StoredConversation,
  StoredCustomer,
  StoredMessage,
  StoredOutboundMessage,
  DashboardState
} from "./types";

export function createInitialDashboardState(): DashboardState {
  return {
    status: "等待连接",
    customers: [],
    conversations: [],
    assignment: null,
    messages: [],
    outboundMessages: [],
    notes: [],
    tags: [],
    tasks: []
  };
}

export async function loadCustomerList(state: DashboardState, client: InternalApiClient): Promise<DashboardState> {
  const customers = sortCustomers(await client.listCustomers());
  const nextCustomerId = selectedCustomerExists(customers, state.selectedCustomerId)
    ? state.selectedCustomerId
    : customers[0] ? customerKey(customers[0]) : undefined;
  const nextState: DashboardState = {
    ...state,
    customers,
    selectedCustomerId: nextCustomerId,
    status: `已加载 ${customers.length} 个客户`,
    error: undefined
  };
  return nextCustomerId ? selectCustomer(nextState, client, nextCustomerId) : clearSelection(nextState);
}

// Silent background refresh used by the dashboard poll. Unlike loadCustomerList
// it preserves the user's current customer/conversation selection and does not
// rewrite the status line, so newly captured messages appear without the view
// jumping or flickering. Only the inbound-changing surfaces (customers,
// conversations, messages, outbound) are re-fetched; locally-edited surfaces
// (notes, tags, tasks, assignment) are carried over untouched.
export async function refreshDashboard(state: DashboardState, client: InternalApiClient): Promise<DashboardState> {
  const customers = sortCustomers(await client.listCustomers());
  const selectedCustomerId = selectedCustomerExists(customers, state.selectedCustomerId)
    ? state.selectedCustomerId
    : customers[0]?.externalCustomerId;

  const selectedCustomer = customers.find((customer) => isCustomerSelection(customer, selectedCustomerId));
  if (!selectedCustomer) {
    return { ...clearSelection({ ...state, customers }), error: undefined };
  }

  const scope = customerScope(selectedCustomer);
  const allConversations = await client.listConversations();
  const conversations = sortConversations(
    allConversations.filter((conversation) => isSameCustomerConversation(conversation, selectedCustomer))
  );
  const selectedConversationId = conversations.some(
    (conversation) => conversation.externalConversationId === state.selectedConversationId
  )
    ? state.selectedConversationId
    : conversations[0]?.externalConversationId;

  const [messages, outboundMessages] = await Promise.all([
    selectedConversationId ? listMessagesForConversation(client, scope, selectedConversationId) : Promise.resolve([]),
    selectedConversationId ? client.listOutboundMessages(scope, selectedConversationId) : Promise.resolve([])
  ]);

  return {
    ...state,
    customers,
    selectedCustomerId,
    conversations,
    selectedConversationId,
    messages: sortMessages(messages),
    outboundMessages: visibleOutboundMessages(messages, outboundMessages),
    error: undefined
  };
}

export async function selectCustomer(
  state: DashboardState,
  client: InternalApiClient,
  selectedCustomerKey: string
): Promise<DashboardState> {
  const selectedCustomer = state.customers.find((customer) => isCustomerSelection(customer, selectedCustomerKey));
  if (!selectedCustomer) {
    return {
      ...state,
      selectedCustomerId: undefined,
      selectedConversationId: undefined,
      conversations: [],
      assignment: null,
      messages: [],
      outboundMessages: [],
      notes: [],
      tags: [],
      tasks: [],
      status: "未找到客户"
    };
  }

  const scope = customerScope(selectedCustomer);
  const allConversations = await client.listConversations();
  const conversations = sortConversations(
    allConversations.filter((conversation) => isSameCustomerConversation(conversation, selectedCustomer))
  );
  const selectedConversationId = conversations[0]?.externalConversationId;
  const [messages, outboundMessages, assignment, notes, tags, tasks] = await Promise.all([
    selectedConversationId ? listMessagesForConversation(client, scope, selectedConversationId) : Promise.resolve([]),
    selectedConversationId ? client.listOutboundMessages(scope, selectedConversationId) : Promise.resolve([]),
    client.getCustomerAssignment(scope),
    client.listCustomerNotes(scope),
    client.listCustomerTags(scope),
    client.listFollowUpTasks(scope)
  ]);

  return {
    ...state,
    selectedCustomerId: selectedCustomerKey,
    conversations,
    selectedConversationId,
    assignment,
    messages: sortMessages(messages),
    outboundMessages: visibleOutboundMessages(messages, outboundMessages),
    notes,
    tags,
    tasks,
    status: `${selectedCustomer.displayName || selectedCustomer.externalCustomerId} 已就绪`,
    error: undefined
  };
}

export async function selectConversation(
  state: DashboardState,
  client: InternalApiClient,
  externalConversationId: string
): Promise<DashboardState> {
  const scope = selectedCustomerScope(state);
  const [messages, outboundMessages] = await Promise.all([
    scope ? listMessagesForConversation(client, scope, externalConversationId) : Promise.resolve([]),
    scope ? client.listOutboundMessages(scope, externalConversationId) : Promise.resolve([])
  ]);
  return {
    ...state,
    selectedConversationId: externalConversationId,
    messages: sortMessages(messages),
    outboundMessages: visibleOutboundMessages(messages, outboundMessages),
    status: `已加载 ${messages.length} 条消息`,
    error: undefined
  };
}

export async function createOutboundMessageForSelectedConversation(
  state: DashboardState,
  client: InternalApiClient,
  content: string
): Promise<DashboardState> {
  const scope = selectedCustomerScope(state);
  const externalConversationId = state.selectedConversationId;
  const trimmed = content.trim();
  if (!scope || !externalConversationId || !trimmed) return state;

  const outboundMessage = await client.createOutboundMessage(scope, externalConversationId, { content: trimmed });
  return {
    ...state,
    outboundMessages: [...state.outboundMessages, outboundMessage],
    status: "消息已加入发送队列",
    error: undefined
  };
}

export async function createNoteForSelectedCustomer(
  state: DashboardState,
  client: InternalApiClient,
  body: string
): Promise<DashboardState> {
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
  state: DashboardState,
  client: InternalApiClient,
  tag: string
): Promise<DashboardState> {
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
  state: DashboardState,
  client: InternalApiClient,
  title: string
): Promise<DashboardState> {
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

function selectedCustomerScope(state: DashboardState): CustomerScope | null {
  const customer = state.customers.find((item) => isCustomerSelection(item, state.selectedCustomerId));
  return customer ? customerScope(customer) : null;
}

function customerScope(customer: StoredCustomer): CustomerScope {
  return {
    sellerAccountExternalId: customer.sellerAccountExternalId,
    externalCustomerId: customer.externalCustomerId,
    channel: customer.channel,
    channelAccountExternalId: customer.channelAccountExternalId,
    channelSurface: customer.channelSurface
  };
}

function listMessagesForConversation(
  client: InternalApiClient,
  scope: CustomerScope,
  externalConversationId: string
): Promise<StoredMessage[]> {
  return client.listMessages.length <= 1
    ? client.listMessages(externalConversationId)
    : client.listMessages(scope, externalConversationId);
}

// A conversation belongs to the selected customer only when it matches the full
// identity, not just externalCustomerId — otherwise two customers that share a
// numeric id across different sellers/channels would merge their conversations.
function isSameCustomerConversation(conversation: StoredConversation, customer: StoredCustomer): boolean {
  return (
    conversation.externalCustomerId === customer.externalCustomerId &&
    conversation.sellerAccountExternalId === customer.sellerAccountExternalId &&
    (conversation.channel ?? undefined) === (customer.channel ?? undefined) &&
    (conversation.channelAccountExternalId ?? undefined) === (customer.channelAccountExternalId ?? undefined)
  );
}

function selectedCustomerExists(customers: StoredCustomer[], selectedCustomerId?: string): boolean {
  return Boolean(selectedCustomerId && customers.some((customer) => isCustomerSelection(customer, selectedCustomerId)));
}

export function customerKey(customer: StoredCustomer): string {
  return [
    customer.sellerAccountExternalId,
    customer.channel || "",
    customer.channelAccountExternalId || "",
    customer.externalCustomerId
  ].join("::");
}

export function isCustomerSelection(customer: StoredCustomer, selectedCustomerId?: string): boolean {
  return Boolean(
    selectedCustomerId &&
      (customerKey(customer) === selectedCustomerId || customer.externalCustomerId === selectedCustomerId)
  );
}

function clearSelection(state: DashboardState): DashboardState {
  return {
    ...state,
    selectedCustomerId: undefined,
    selectedConversationId: undefined,
    conversations: [],
    assignment: null,
    messages: [],
    outboundMessages: [],
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

function sortMessages<T extends { sentAt?: string; createdAt?: string; deliveredAt?: string }>(messages: T[]): T[] {
  return [...messages].sort((left, right) => messageTimestamp(left) - messageTimestamp(right));
}

function visibleOutboundMessages(
  messages: StoredMessage[],
  outboundMessages: StoredOutboundMessage[]
): StoredOutboundMessage[] {
  return sortMessages(outboundMessages).filter((outbound) => !isSyncedOutboundMessage(outbound, messages));
}

function isSyncedOutboundMessage(outbound: StoredOutboundMessage, messages: StoredMessage[]): boolean {
  if (outbound.status !== "sent") return false;
  return messages.some((message) => isSameSentMessage(message, outbound));
}

function isSameSentMessage(message: StoredMessage, outbound: StoredOutboundMessage): boolean {
  if (message.direction !== "sent") return false;
  if (message.externalConversationId !== outbound.externalConversationId) return false;
  if (outbound.externalMessageId && message.externalMessageId === outbound.externalMessageId) return true;
  if (normalizedContent(message.content) !== normalizedContent(outbound.content)) return false;
  return Math.abs(messageTimestamp(message) - messageTimestamp(outbound)) <= 5000;
}

function normalizedContent(value?: string): string {
  return (value || "").trim();
}

function messageTimestamp(message: { sentAt?: string; createdAt?: string; deliveredAt?: string }): number {
  return timestamp(message.sentAt || message.deliveredAt || message.createdAt);
}

function timestamp(value?: string): number {
  return value ? new Date(value).getTime() : 0;
}
