import Fastify, { type FastifyInstance } from "fastify";
import { InMemorySyncStore, type SyncBatch } from "@wangwang/database";

export interface CreateServerOptions {
  store?: InMemorySyncStore;
  deviceTokens?: string[];
  logger?: boolean;
}

export async function createServer(options: CreateServerOptions = {}): Promise<FastifyInstance> {
  const store = options.store || new InMemorySyncStore();
  const deviceTokens = new Set(options.deviceTokens || envDeviceTokens());
  const app = Fastify({
    logger: options.logger ?? false
  });

  app.get("/health", async () => ({
    ok: true,
    service: "wangwang-internal-server",
    time: new Date().toISOString()
  }));

  app.post("/collector/v1/sync-batches", async (request, reply) => {
    const auth = request.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    if (!token || !deviceTokens.has(token)) {
      return reply.code(401).send({ ok: false, error: "unauthorized" });
    }

    const result = await store.acceptSyncBatch(request.body as SyncBatch);
    return {
      ok: true,
      ...result
    };
  });

  return app;
}

function envDeviceTokens(): string[] {
  return (process.env.WANGWANG_DEVICE_TOKENS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await createServer({ logger: true });
  const host = process.env.WANGWANG_SERVER_HOST || "127.0.0.1";
  const port = Number(process.env.WANGWANG_SERVER_PORT || 5032);
  await app.listen({ host, port });
}
