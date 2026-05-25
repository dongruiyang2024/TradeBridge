import cors from "@fastify/cors";
import Fastify from "fastify";
import type { ExportRequest, HealthResponse, SessionStatusResponse } from "@wangwang/shared";
import { API_VERSION, COOKIE_DB_PATHS, LOCAL_API_TOKEN, LOG_PATHS, SERVER_HOST, SERVER_PORT } from "./config.js";
import { ConversationService } from "./conversation-service.js";
import { ExportService } from "./export-service.js";
import {
  conversationsRouteSchema,
  customerRouteSchema,
  exportRouteSchema,
  healthRouteSchema,
  messagesRouteSchema,
  sessionStatusRouteSchema
} from "./api-schemas.js";
import { isOpenApiRoute, registerOpenApi } from "./openapi.js";
import {
  discoverAliWorkbenchCookieDbs,
  discoverAliWorkbenchTokenCacheFiles,
  extractAliWorkbenchCookies,
  getCtoken
} from "./session.js";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
    redact: ["req.headers.authorization", "req.headers.cookie"]
  }
});

const conversationService = new ConversationService();
const exportService = new ExportService(conversationService);

await app.register(cors, {
  origin(origin, callback) {
    if (!origin || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("origin_not_allowed"), false);
  }
});

await registerOpenApi(app);

app.addHook("preHandler", async (request, reply) => {
  if (!LOCAL_API_TOKEN || request.url === "/health" || isOpenApiRoute(request.url)) return;
  const auth = request.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (token !== LOCAL_API_TOKEN) {
    await reply.code(401).send({ ok: false, error: "unauthorized" });
  }
});

app.get("/health", { schema: healthRouteSchema }, async (): Promise<HealthResponse> => ({
  ok: true,
  service: "wangwang-local-viewer-api",
  version: API_VERSION,
  time: new Date().toISOString()
}));

app.get("/api/v1/session/status", { schema: sessionStatusRouteSchema }, async (): Promise<SessionStatusResponse> => {
  const cookieDbPaths = COOKIE_DB_PATHS.length ? COOKIE_DB_PATHS : discoverAliWorkbenchCookieDbs();
  const tokenCachePaths = discoverAliWorkbenchTokenCacheFiles();
  const cookies = extractAliWorkbenchCookies(LOG_PATHS, { cookieDbPaths, tokenCachePaths });
  const keychainTimeoutMs = Number(process.env.WANGWANG_KEYCHAIN_TIMEOUT_MS || 10000);
  return {
    ok: true,
    cookieNames: Object.keys(cookies).sort(),
    hasCtoken: Boolean(getCtoken(cookies)),
    hasTbToken: Boolean(cookies._tb_token_),
    hasCookie2: Boolean(cookies.cookie2),
    hasSgcookie: Boolean(cookies.sgcookie),
    logPathCount: LOG_PATHS.length,
    cookieDbPathCount: cookieDbPaths.length,
    tokenCachePathCount: tokenCachePaths.length,
    keychainTimeoutMs: Number.isFinite(keychainTimeoutMs) && keychainTimeoutMs > 0 ? keychainTimeoutMs : 10000
  };
});

app.get("/api/v1/conversations", { schema: conversationsRouteSchema }, async (request) => {
  const refresh = (request.query as { refresh?: string }).refresh === "true";
  const result = await conversationService.list(refresh);
  return {
    ok: true,
    source: "vmfs_cache",
    conversationCacheCount: result.cacheCount,
    conversations: result.conversations
  };
});

app.get("/api/v1/conversations/:id/messages", { schema: messagesRouteSchema }, async (request) => {
  const params = request.params as { id: string };
  const query = request.query as { before?: string; limit?: string };
  const before = query.before ? Number(query.before) : null;
  const limit = query.limit ? Number(query.limit) : 50;
  return conversationService.messages(params.id, Number.isFinite(before) ? before : null, Number.isFinite(limit) ? limit : 50);
});

app.get("/api/v1/conversations/:id/customer", { schema: customerRouteSchema }, async (request) => {
  const params = request.params as { id: string };
  return conversationService.customer(params.id);
});

app.post("/api/v1/export", { schema: exportRouteSchema }, async (request) => {
  const body = (request.body || {}) as ExportRequest;
  return exportService.exportCachedMessages(body);
});

app.setErrorHandler(async (error: Error, _request, reply) => {
  const statusCode = error.message === "conversation_not_found" ? 404 : 500;
  await reply.code(statusCode).send({
    ok: false,
    error: error.message,
    message: statusCode === 500 ? "internal_error" : error.message
  });
});

await app.listen({ host: SERVER_HOST, port: SERVER_PORT });
