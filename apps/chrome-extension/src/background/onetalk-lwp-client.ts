import {
  LWP_ROUTES,
  buildRegisterFrame,
  lwpConversationPageFromFrame,
  lwpMessagesPageFromFrame,
  lwpRegisterStateFromFrame,
  type ChatMessageResponse,
  type ParsedLwpFrame,
  type WebliteData
} from "@wangwang/onetalk-adapter/browser";
import { LwpRpcClient } from "./lwp-rpc-client.js";

export interface TokenProviderResult {
  accessToken: string;
  refreshToken?: string;
  expiresInMs?: number;
  appKey?: string;
  deviceId?: string;
}

export interface LwpTransport {
  connect(): Promise<void>;
  request(route: string, body: unknown): Promise<ParsedLwpFrame>;
  requestFrame(frameText: string): Promise<ParsedLwpFrame>;
  close(): void;
}

export interface BrowserOnetalkLwpClientOptions {
  appKey: string;
  deviceId: string;
  userAgent: string;
  tokenProvider(): Promise<TokenProviderResult>;
  conversationProvider?: () => Promise<Record<string, unknown>[]>;
  customerProfileProvider?: (conversations: Record<string, unknown>[]) => Promise<Record<string, unknown>[]>;
  rpcFactory?: () => LwpTransport;
  now?: () => Date;
}

export class BrowserOnetalkLwpClient {
  private transport: LwpTransport | null = null;
  private bootstrap: Record<string, string> = {};

  constructor(private readonly options: BrowserOnetalkLwpClientOptions) {}

  async fetchWeblite(): Promise<WebliteData> {
    const transport = await this.ensureTransport();
    const state = await transport.request(LWP_ROUTES.getState, [{ topic: "sync" }]);
    const lwpConversations = lwpConversationPageFromFrame(
      await transport.request(LWP_ROUTES.conversations, [this.options.now?.().getTime() || Date.now(), 100])
    );
    if (isRecord(state.body)) {
      await transport.request(LWP_ROUTES.ackDiff, [state.body]);
    }
    const conversations = await this.fetchConversations(lwpConversations.conversations);
    const customerProfiles = await this.fetchCustomerProfiles(conversations.conversations);
    return {
      html: "",
      bootstrap: this.bootstrap,
      conversations: conversations.conversations,
      customerProfiles
    };
  }

  async getChatMessages(request: {
    conversation: Record<string, unknown>;
    bootstrap: Record<string, string>;
    before: number | null;
    pageSize: number;
  }): Promise<ChatMessageResponse> {
    const cid = conversationId(request.conversation);
    if (!cid) throw new Error("onetalk_conversation_id_missing");
    const cursor = request.before || Number.MAX_SAFE_INTEGER;
    const body = [cid, false, cursor, request.pageSize, false];
    const frame = await this.requestWithReconnect(LWP_ROUTES.messages, body);
    const page = lwpMessagesPageFromFrame(frame);
    return {
      status: frame.code || 0,
      contentType: "application/lwp+json",
      code: frame.code || null,
      raw: frame.raw,
      messages: page.messages,
      diagnostics: {
        status: frame.code || 0,
        contentType: "application/lwp+json",
        code: frame.code || null,
        listLength: page.messages.length,
        listPath: "body.userMessageModels",
        topLevelKeys: Object.keys(frame.raw).sort(),
        dataKeys: isRecord(frame.body) ? Object.keys(frame.body).sort() : []
      }
    };
  }

  close(): void {
    this.transport?.close();
    this.transport = null;
  }

  private async ensureTransport(): Promise<LwpTransport> {
    if (this.transport) return this.transport;
    const token = await this.options.tokenProvider();
    const transport = this.options.rpcFactory?.() || new LwpRpcClient();
    await transport.connect();
    const registerFrame = await registerWithTransport(transport, {
      appKey: token.appKey || this.options.appKey,
      deviceId: token.deviceId || this.options.deviceId,
      userAgent: this.options.userAgent,
      accessToken: token.accessToken
    });
    const registerState = lwpRegisterStateFromFrame(registerFrame);
    if (!registerState.ok) throw new Error("onetalk_lwp_register_failed");
    this.bootstrap = registerState.uid ? { aliId: registerState.uid } : {};
    this.transport = transport;
    return transport;
  }

  private async requestWithReconnect(route: string, body: unknown): Promise<ParsedLwpFrame> {
    try {
      return await (await this.ensureTransport()).request(route, body);
    } catch (error) {
      if (!isRetryableTransportError(error)) throw error;
      this.close();
      return (await this.ensureTransport()).request(route, body);
    }
  }

  private async fetchCustomerProfiles(conversations: Record<string, unknown>[]): Promise<Record<string, unknown>[] | undefined> {
    if (!this.options.customerProfileProvider) return undefined;
    try {
      const profiles = await this.options.customerProfileProvider(conversations);
      return profiles.length ? profiles : undefined;
    } catch {
      return undefined;
    }
  }

  private async fetchConversations(fallback: Record<string, unknown>[]): Promise<{ conversations: Record<string, unknown>[] }> {
    if (!this.options.conversationProvider) return { conversations: fallback };
    try {
      const conversations = await this.options.conversationProvider();
      return { conversations: conversations.length ? conversations : fallback };
    } catch {
      return { conversations: fallback };
    }
  }
}

function isRetryableTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message === "lwp_socket_not_open" ||
    error.message === "lwp_socket_closed" ||
    error.message.startsWith("lwp_request_timeout:")
  );
}

async function registerWithTransport(
  transport: LwpTransport,
  input: { appKey: string; deviceId: string; userAgent: string; accessToken: string }
): Promise<ParsedLwpFrame> {
  return transport.requestFrame(
    buildRegisterFrame({
      mid: createLwpMid(),
      appKey: input.appKey,
      deviceId: input.deviceId,
      userAgent: input.userAgent,
      accessToken: input.accessToken
    })
  );
}

function createLwpMid(): string {
  return `${Math.floor(Math.random() * 1000)}${Date.now()} 0`;
}

function conversationId(conversation: Record<string, unknown>): string | undefined {
  return (
    firstString(valueAtPath(conversation, ["singleChatUserConversation", "singleChatConversation"]), ["cid"]) ||
    firstString(conversation, ["cid", "conversationCode", "conversationId", "id"])
  );
}

function firstString(source: unknown, keys: string[]): string | undefined {
  if (!isRecord(source)) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function valueAtPath(source: unknown, path: string[]): unknown {
  let current = source;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
