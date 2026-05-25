import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";
import { API_VERSION, LOCAL_API_TOKEN, SERVER_HOST, SERVER_PORT } from "./config.js";

export async function registerOpenApi(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "旺旺本机消息查看器 API",
        description:
          "仅监听本机的接口服务，用于读取 weblitePWA 缓存会话、分页拉取会话消息，并把可获取到的消息导出为本地 JSON 文件。接口不会向前端暴露 Cookie、ctoken、chatToken 等敏感凭据。",
        version: API_VERSION
      },
      servers: [
        {
          url: `http://${SERVER_HOST}:${SERVER_PORT}`,
          description: "本机 API 服务"
        }
      ],
      tags: [
        { name: "System", description: "本机服务状态。" },
        { name: "Conversations", description: "从 weblitePWA 启动数据里发现可探测的缓存会话。" },
        { name: "Messages", description: "基于缓存会话参数分页拉取聊天消息。" },
        { name: "Customers", description: "把聊天会话与客户资料、联系人快照和互动摘要对应起来。" },
        { name: "Export", description: "把缓存会话和已拉取消息导出到本机 JSON 文件。" }
      ],
      components: {
        securitySchemes: {
          localApiToken: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "local-api-token",
            description: "仅当配置了 WANGWANG_API_TOKEN 时需要填写，用于保护本机 API。"
          }
        }
      },
      security: LOCAL_API_TOKEN ? [{ localApiToken: [] }] : []
    }
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      deepLinking: true,
      displayRequestDuration: true,
      docExpansion: "list",
      tryItOutEnabled: true
    },
    staticCSP: true,
    transformSpecificationClone: true,
    theme: {
      title: "旺旺本机 API 文档"
    }
  });

  app.get(
    "/openapi.json",
    {
      schema: {
        hide: true
      }
    },
    async () => app.swagger()
  );
}

export function isOpenApiRoute(url: string): boolean {
  const rawPath = url.startsWith("http") ? new URL(url).pathname : url.split("?")[0];
  const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, "") : rawPath;
  return path === "/openapi.json" || path === "/docs" || path.startsWith("/docs/");
}
