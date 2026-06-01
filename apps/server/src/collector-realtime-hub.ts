import {
  buildCollectorWsMessage,
  serializeCollectorWsMessage,
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
  socket: CollectorRealtimeSocket;
}

export interface CollectorRealtimeHubOptions {
  now?: () => Date;
  nextId?: () => string;
}

export interface CollectorRealtimeHub {
  addSession(session: CollectorRealtimeSession): void;
  removeSession(sessionId: string): void;
  notifyOutboundAvailable(sellerAccountExternalId: string, pendingCount: number): number;
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
    notifyOutboundAvailable(sellerAccountExternalId, pendingCount) {
      const message = buildCollectorWsMessage({
        id: nextId(),
        type: "outbound.available",
        sentAt: now().toISOString(),
        payload: { sellerAccountExternalId, pendingCount }
      });
      let delivered = 0;
      for (const session of sessions.values()) {
        if (session.sellerAccountExternalId !== sellerAccountExternalId) continue;
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

function send(socket: CollectorRealtimeSocket, message: CollectorWsMessage): boolean {
  if (socket.readyState !== SOCKET_OPEN) return false;
  socket.send(serializeCollectorWsMessage(message));
  return true;
}
