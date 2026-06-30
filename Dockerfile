FROM node:22-alpine AS base

WORKDIR /app

FROM base AS deps

ARG NPM_REGISTRY=https://registry.npmmirror.com

RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories \
  && apk add --no-cache libc6-compat \
  && npm config set registry "$NPM_REGISTRY"

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/collector-protocol/package.json packages/collector-protocol/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/env/package.json packages/env/package.json
COPY packages/onetalk-adapter/package.json packages/onetalk-adapter/package.json

RUN npm ci

FROM deps AS builder

COPY tsconfig.base.json ./
COPY apps/server apps/server
COPY packages/collector-protocol packages/collector-protocol
COPY packages/database packages/database
COPY packages/env packages/env
COPY packages/onetalk-adapter packages/onetalk-adapter

RUN npm run build -w @wangwang/env \
  && npm run build -w @wangwang/collector-protocol \
  && npm run build -w @wangwang/onetalk-adapter \
  && npm run build -w @wangwang/database \
  && npm run build -w @wangwang/server

RUN npm prune --omit=dev

FROM node:22-alpine AS server-runner

ENV NODE_ENV=production
ENV WANGWANG_SERVER_HOST=0.0.0.0
ENV WANGWANG_SERVER_PORT=5032

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 tradebridge

COPY --from=builder --chown=tradebridge:nodejs /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=tradebridge:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=tradebridge:nodejs /app/apps/server/package.json ./apps/server/package.json
COPY --from=builder --chown=tradebridge:nodejs /app/apps/server/dist ./apps/server/dist
COPY --from=builder --chown=tradebridge:nodejs /app/packages/collector-protocol/package.json ./packages/collector-protocol/package.json
COPY --from=builder --chown=tradebridge:nodejs /app/packages/collector-protocol/dist ./packages/collector-protocol/dist
COPY --from=builder --chown=tradebridge:nodejs /app/packages/database/package.json ./packages/database/package.json
COPY --from=builder --chown=tradebridge:nodejs /app/packages/database/dist ./packages/database/dist
COPY --from=builder --chown=tradebridge:nodejs /app/packages/database/migrations ./packages/database/migrations
COPY --from=builder --chown=tradebridge:nodejs /app/packages/env/package.json ./packages/env/package.json
COPY --from=builder --chown=tradebridge:nodejs /app/packages/env/dist ./packages/env/dist
COPY --from=builder --chown=tradebridge:nodejs /app/packages/onetalk-adapter/package.json ./packages/onetalk-adapter/package.json
COPY --from=builder --chown=tradebridge:nodejs /app/packages/onetalk-adapter/dist ./packages/onetalk-adapter/dist

USER tradebridge

EXPOSE 5032

CMD ["node", "apps/server/dist/server.js"]
