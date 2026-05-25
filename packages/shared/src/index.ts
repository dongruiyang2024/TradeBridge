export type SourceKind = "vmfs_cache";

export interface HealthResponse {
  ok: boolean;
  service: string;
  version: string;
  time: string;
}

export interface SessionStatusResponse {
  ok: boolean;
  cookieNames: string[];
  hasCtoken: boolean;
  hasTbToken: boolean;
  hasCookie2: boolean;
  hasSgcookie: boolean;
  logPathCount: number;
  cookieDbPathCount: number;
  tokenCachePathCount: number;
  keychainTimeoutMs: number;
}

export interface ConversationListItem {
  id: string;
  source: SourceKind;
  index: number;
  displayName: string;
  lastMessagePreview: string;
  lastMessageTime: number | null;
  unreadCount: number;
  hasLatestMessage: boolean;
  messageCountHint?: number;
}

export interface MessageItem {
  id: string;
  conversationId: string;
  remoteMessageId?: string;
  sendTime?: number;
  sendTimeUtc?: string;
  direction: "received" | "sent" | "unknown";
  messageType?: string | number;
  subType?: string | number;
  content?: string;
  raw: Record<string, unknown>;
}

export interface ConversationsResponse {
  ok: boolean;
  source: SourceKind;
  conversationCacheCount: number;
  conversations: ConversationListItem[];
}

export interface MessagesResponse {
  ok: boolean;
  conversationId: string;
  messages: MessageItem[];
  nextBefore: number | null;
  page: {
    status: number;
    code: string | number | null;
    count: number;
  };
}

export interface ExportRequest {
  maxPages?: number;
  pageSize?: number;
  conversationIds?: string[];
}

export interface ExportResponse {
  ok: boolean;
  output: string;
  exportedConversationCount: number;
  exportedMessageCount: number;
  conversationMessageCounts: number[];
}

export interface CustomerIdentity {
  conversationId: string;
  displayName: string;
  contactAccountId?: string;
  contactAccountIdEncrypt?: string;
  contactAliId?: string;
  contactAliIdEncrypt?: string;
  buyerLoginId?: string;
}

export interface CustomerMtopProfile {
  aliId?: number | string;
  loginId?: string;
  countryCode?: string;
  countryIcon?: string;
  joiningYears?: number;
  available?: boolean;
  recentContact?: boolean;
  potentialScore?: number;
  emailValidation?: boolean;
}

export interface CustomerAccountTokenProfile {
  accountId?: number | string;
  accountIdEncrypted?: string;
  targetAliId?: number | string;
  targetAliIdEncrypted?: string;
  targetLoginId?: string;
  targetLoginIdEncrypted?: string;
  checkResult?: boolean;
}

export interface CustomerContactExtInfo {
  accountIdEncrypt?: string;
  accountStatus?: string | number;
  aliId?: number | string;
  avatarUrl?: string;
  companyName?: string;
  country?: string;
  firstName?: string;
  lastName?: string;
  loginId?: string;
  vaccountId?: number | string;
}

export interface CustomerChatSummary {
  productCardNum?: number;
  inquiryCardNum?: number;
  quotationCardNum?: number;
  unPayOrderNum?: number;
  unshippedOrderNum?: number;
  unConfirmShipmentOrderNum?: number;
}

export interface CustomerDetailStatus {
  available: boolean;
  source: "alicrm_jsonp";
  reason?: string;
}

export interface CustomerInfoResponse {
  ok: boolean;
  conversationId: string;
  identity: CustomerIdentity;
  mtopProfile: CustomerMtopProfile | null;
  accountTokenProfile: CustomerAccountTokenProfile | null;
  contactExtInfo: CustomerContactExtInfo | null;
  chatSummary: CustomerChatSummary | null;
  detailStatus: CustomerDetailStatus;
  matchedSources: string[];
}
