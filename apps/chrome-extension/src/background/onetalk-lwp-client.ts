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
import { readLatestOnetalkPageSnapshot } from "./onetalk-page-snapshot.js";

export interface TokenProviderResult {
  accessToken: string;
  refreshToken?: string;
  expiresInMs?: number;
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
    const conversations = lwpConversationPageFromFrame(
      await transport.request(LWP_ROUTES.conversations, [this.options.now?.().getTime() || Date.now(), 100])
    );
    if (isRecord(state.body)) {
      await transport.request(LWP_ROUTES.ackDiff, [state.body]);
    }
    const pageSnapshot = await readLatestOnetalkPageSnapshot();
    return {
      html: "",
      bootstrap: this.bootstrap,
      conversations: conversations.conversations,
      pageSnapshot
    };
  }

  async getChatMessages(request: {
    conversation: Record<string, unknown>;
    bootstrap: Record<string, string>;
    before: number | null;
    pageSize: number;
  }): Promise<ChatMessageResponse> {
    const transport = await this.ensureTransport();
    const cid = conversationId(request.conversation);
    if (!cid) throw new Error("onetalk_conversation_id_missing");
    const cursor = request.before || Number.MAX_SAFE_INTEGER;
    const frame = await transport.request(LWP_ROUTES.messages, [cid, false, cursor, request.pageSize, false]);
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
      appKey: this.options.appKey,
      deviceId: this.options.deviceId,
      userAgent: this.options.userAgent,
      accessToken: token.accessToken
    });
    const registerState = lwpRegisterStateFromFrame(registerFrame);
    if (!registerState.ok) throw new Error("onetalk_lwp_register_failed");
    this.bootstrap = registerState.uid ? { aliId: registerState.uid } : {};
    this.transport = transport;
    return transport;
  }
}

async function registerWithTransport(
  transport: LwpTransport,
  input: { appKey: string; deviceId: string; userAgent: string; accessToken: string }
): Promise<ParsedLwpFrame> {
  return transport.requestFrame(
    buildRegisterFrame({
      mid: `tradebridge-reg-${Date.now()}`,
      appKey: input.appKey,
      deviceId: input.deviceId,
      userAgent: input.userAgent,
      accessToken: input.accessToken
    })
  );
}

function conversationId(conversation: Record<string, unknown>): string | undefined {
  return (
    firstString(conversation, ["cid", "conversationCode", "conversationId", "id"]) ||
    firstString(valueAtPath(conversation, ["singleChatUserConversation", "singleChatConversation"]), ["cid"])
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
