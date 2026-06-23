import {
  buildCollectorWsMessage,
  serializeCollectorWsMessage,
  type ChannelAccountRef,
  type CollectorWsMessage
} from "@wangwang/collector-protocol";

const SOCKET_OPEN = 1;

export interface CollectorRealtimeSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface CollectorRealtimeSession {
  sessionId: string;
  sellerAccountExternalId: string;
  deviceId: string;
  capabilities?: string[];
  channelAccounts?: ChannelAccountRef[];
  socket: CollectorRealtimeSocket;
}

export interface CollectorRealtimeHubOptions {
  now?: () => Date;
  nextId?: () => string;
}

export interface CollectorRealtimeHub {
  addSession(session: CollectorRealtimeSession): void;
  removeSession(sessionId: string): void;
  notifyOutboundAvailable(input: {
    sellerAccountExternalId: string;
    pendingCount: number;
    channel?: string;
    channelAccountExternalId?: string;
  }): number;
  sendToSession(sessionId: string, message: CollectorWsMessage): boolean;
}

export function createCollectorRealtimeHub(options: CollectorRealtimeHubOptions = {}): CollectorRealtimeHub {
  const sessions = new Map<string, CollectorRealtimeSession>();
  const now = options.now || (() => new Date());
  const nextId = options.nextId || (() => crypto.randomUUID());

  return {
    addSession(session) {
      sessions.set(session.sessionId, session);
    },
    removeSession(sessionId) {
      sessions.delete(sessionId);
    },
    notifyOutboundAvailable(input) {
      const message = buildCollectorWsMessage({
        id: nextId(),
        type: "outbound.available",
        sentAt: now().toISOString(),
        payload: {
          sellerAccountExternalId: input.sellerAccountExternalId,
          pendingCount: input.pendingCount,
          channel: input.channel,
          channelAccountExternalId: input.channelAccountExternalId
        }
      });
      let delivered = 0;
      for (const session of sessions.values()) {
        if (session.sellerAccountExternalId !== input.sellerAccountExternalId) continue;
        if (input.channel && !sessionSupportsChannel(session, input.channel)) continue;
        if (
          input.channel &&
          input.channelAccountExternalId &&
          !sessionSupportsChannelAccount(session, input.channel, input.channelAccountExternalId)
        ) {
          continue;
        }
        if (send(session.socket, message)) delivered += 1;
      }
      return delivered;
    },
    sendToSession(sessionId, message) {
      const session = sessions.get(sessionId);
      return session ? send(session.socket, message) : false;
    }
  };
}

function sessionSupportsChannel(session: CollectorRealtimeSession, channel: string): boolean {
  if (session.channelAccounts?.some((account) => account.channel === channel)) return true;
  return !session.capabilities?.length || session.capabilities.includes(`channel:${channel}`);
}

function sessionSupportsChannelAccount(
  session: CollectorRealtimeSession,
  channel: string,
  channelAccountExternalId: string
): boolean {
  if (!session.channelAccounts?.length) return true;
  return session.channelAccounts.some(
    (account) => account.channel === channel && account.externalAccountId === channelAccountExternalId
  );
}

function send(socket: CollectorRealtimeSocket, message: CollectorWsMessage): boolean {
  if (socket.readyState !== SOCKET_OPEN) return false;
  socket.send(serializeCollectorWsMessage(message));
  return true;
}
