const boolStringSchema = {
  type: "string",
  enum: ["true", "false"]
} as const;

const nullableNumberSchema = {
  anyOf: [{ type: "number" }, { type: "null" }]
} as const;

const nullableStringSchema = {
  anyOf: [{ type: "string" }, { type: "null" }]
} as const;

const stringOrNumberSchema = {
  anyOf: [{ type: "string" }, { type: "number" }]
} as const;

const stringNumberOrNullSchema = {
  anyOf: [{ type: "string" }, { type: "number" }, { type: "null" }]
} as const;

export const errorResponseSchema = {
  type: "object",
  required: ["ok", "error"],
  additionalProperties: true,
  properties: {
    ok: { type: "boolean", const: false, description: "固定为 false，表示请求失败。" },
    error: { type: "string", description: "内部错误码或错误原因。" },
    message: { type: "string", description: "面向调用方的简短错误说明。" }
  }
} as const;

export const healthResponseSchema = {
  type: "object",
  required: ["ok", "service", "version", "time"],
  additionalProperties: false,
  properties: {
    ok: { type: "boolean", description: "服务是否正常响应。" },
    service: { type: "string", description: "服务名称。" },
    version: { type: "string", description: "当前 API 版本。" },
    time: { type: "string", format: "date-time", description: "服务端当前时间，ISO 8601 格式。" }
  }
} as const;

export const sessionStatusResponseSchema = {
  type: "object",
  required: [
    "ok",
    "cookieNames",
    "hasCtoken",
    "hasTbToken",
    "hasCookie2",
    "hasSgcookie",
    "logPathCount",
    "cookieDbPathCount",
    "tokenCachePathCount",
    "keychainTimeoutMs"
  ],
  additionalProperties: false,
  properties: {
    ok: { type: "boolean", description: "固定为 true，表示诊断接口可用。" },
    cookieNames: {
      type: "array",
      description: "当前本机可解析出的 Cookie 名称；不会返回 Cookie 值。",
      items: { type: "string" }
    },
    hasCtoken: { type: "boolean", description: "是否能从 xman_us_t 或缓存 URL 中得到 ctoken。" },
    hasTbToken: { type: "boolean", description: "是否能得到 _tb_token_。" },
    hasCookie2: { type: "boolean", description: "是否能得到 cookie2，通常需要 Keychain 解密 Chromium Cookies DB。" },
    hasSgcookie: { type: "boolean", description: "是否能得到 sgcookie，通常需要 Keychain 解密 Chromium Cookies DB。" },
    logPathCount: { type: "number", description: "当前配置的日志路径数量。" },
    cookieDbPathCount: { type: "number", description: "当前发现或配置的 Chromium Cookies DB 数量。" },
    tokenCachePathCount: { type: "number", description: "当前发现的 AliWorkbench 缓存文件数量。" },
    keychainTimeoutMs: { type: "number", description: "单次读取 macOS Keychain 的超时时间。" }
  }
} as const;

export const conversationListItemSchema = {
  type: "object",
  required: ["id", "source", "index", "displayName", "lastMessagePreview", "lastMessageTime", "unreadCount", "hasLatestMessage"],
  additionalProperties: false,
  properties: {
    id: { type: "string", description: "本机生成的会话 ID，用于后续拉取消息，不等同于阿里原始账号 ID。" },
    source: { type: "string", enum: ["vmfs_cache"], description: "会话来源，目前固定为 weblitePWA 页面缓存。" },
    index: { type: "number", description: "本次缓存列表中的序号，从 1 开始。" },
    displayName: { type: "string", description: "用于界面展示的联系人或会话名称。" },
    lastMessagePreview: { type: "string", description: "缓存里携带的最后一条消息预览。" },
    lastMessageTime: { ...nullableNumberSchema, description: "最后一条缓存消息的时间戳，单位毫秒；没有则为 null。" },
    unreadCount: { type: "number", description: "缓存里记录的未读数。" },
    hasLatestMessage: { type: "boolean", description: "缓存对象里是否存在 latestMessage。" },
    messageCountHint: { type: "number", description: "缓存里可能携带的消息数量提示，不保证存在。" }
  }
} as const;

export const conversationsResponseSchema = {
  type: "object",
  required: ["ok", "source", "conversationCacheCount", "conversations"],
  additionalProperties: false,
  properties: {
    ok: { type: "boolean", description: "请求是否成功。" },
    source: { type: "string", enum: ["vmfs_cache"], description: "会话来源，目前固定为 weblitePWA 页面缓存。" },
    conversationCacheCount: { type: "number", description: "页面缓存中可探测会话的数量。" },
    conversations: {
      type: "array",
      description: "可用于继续拉取消息的会话列表。",
      items: conversationListItemSchema
    }
  }
} as const;

export const messageItemSchema = {
  type: "object",
  required: ["id", "conversationId", "direction", "raw"],
  additionalProperties: false,
  properties: {
    id: { type: "string", description: "本机生成的消息 ID，用于前端渲染和去重。" },
    conversationId: { type: "string", description: "所属本机会话 ID。" },
    remoteMessageId: { type: "string", description: "消息接口返回的原始消息 ID，可能不存在。" },
    sendTime: { type: "number", description: "消息发送时间戳，单位毫秒。" },
    sendTimeUtc: { type: "string", format: "date-time", description: "消息发送时间的 UTC ISO 字符串。" },
    direction: { type: "string", enum: ["received", "sent", "unknown"], description: "消息方向：收到、发出或未知。" },
    messageType: { ...stringOrNumberSchema, description: "原始消息类型。" },
    subType: { ...stringOrNumberSchema, description: "原始消息子类型。" },
    content: { type: "string", description: "消息正文。图片、文件等富媒体消息可能仍是原始结构或占位内容。" },
    raw: {
      type: "object",
      description: "脱敏后的原始消息对象，便于后续调试字段映射。",
      additionalProperties: true
    }
  }
} as const;

export const messagesResponseSchema = {
  type: "object",
  required: ["ok", "conversationId", "messages", "nextBefore", "page"],
  additionalProperties: false,
  properties: {
    ok: { type: "boolean", description: "请求是否成功。" },
    conversationId: { type: "string", description: "本机会话 ID。" },
    messages: {
      type: "array",
      description: "本页消息列表。",
      items: messageItemSchema
    },
    nextBefore: { ...nullableNumberSchema, description: "下一页游标。继续拉更早消息时，把该值传入 before；没有更多则为 null。" },
    page: {
      type: "object",
      description: "本次上游消息接口调用的分页状态。",
      required: ["status", "code", "count"],
      additionalProperties: false,
      properties: {
        status: { type: "number", description: "HTTP 状态码。" },
        code: { ...stringNumberOrNullSchema, description: "上游接口返回的业务 code。" },
        count: { type: "number", description: "本页返回的消息数量。" }
      }
    }
  }
} as const;

export const exportRequestSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    maxPages: {
      type: "integer",
      minimum: 1,
      maximum: 200,
      default: 2,
      description: "每个会话最多向前翻多少页。数值越大，导出越完整，但请求也越多。"
    },
    pageSize: {
      type: "integer",
      minimum: 1,
      maximum: 100,
      default: 50,
      description: "每页拉取消息数量。默认 50，最大 100。"
    },
    conversationIds: {
      type: "array",
      description: "只导出指定会话 ID；不传则导出当前缓存列表中的全部可探测会话。",
      items: { type: "string" }
    }
  }
} as const;

export const exportResponseSchema = {
  type: "object",
  required: ["ok", "output", "exportedConversationCount", "exportedMessageCount", "conversationMessageCounts"],
  additionalProperties: false,
  properties: {
    ok: { type: "boolean", description: "导出是否成功。" },
    output: { type: "string", description: "生成的本地 JSON 文件路径。" },
    exportedConversationCount: { type: "number", description: "实际导出的会话数量。" },
    exportedMessageCount: { type: "number", description: "实际导出的消息总数。" },
    conversationMessageCounts: {
      type: "array",
      description: "每个导出会话对应的消息数量。",
      items: { type: "number" }
    }
  }
} as const;

export const customerInfoResponseSchema = {
  type: "object",
  required: [
    "ok",
    "conversationId",
    "identity",
    "mtopProfile",
    "accountTokenProfile",
    "contactExtInfo",
    "chatSummary",
    "detailStatus",
    "matchedSources"
  ],
  additionalProperties: false,
  properties: {
    ok: { type: "boolean", description: "请求是否成功。" },
    conversationId: { type: "string", description: "本机会话 ID。" },
    identity: {
      type: "object",
      additionalProperties: false,
      required: ["conversationId", "displayName"],
      properties: {
        conversationId: { type: "string", description: "本机会话 ID。" },
        displayName: { type: "string", description: "会话展示名。" },
        contactAccountId: { type: "string", description: "联系人账号 ID。" },
        contactAccountIdEncrypt: { type: "string", description: "联系人加密账号 ID，可用于 alicrm/chatManager 参数。" },
        contactAliId: { type: "string", description: "联系人 AliId。" },
        contactAliIdEncrypt: { type: "string", description: "联系人加密 AliId。" },
        buyerLoginId: { type: "string", description: "买家 loginId，来自本机 MTOP 日志或 alicrm 上下文。" }
      }
    },
    mtopProfile: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            aliId: stringOrNumberSchema,
            loginId: { type: "string" },
            countryCode: { type: "string" },
            countryIcon: { type: "string" },
            joiningYears: { type: "number" },
            available: { type: "boolean" },
            recentContact: { type: "boolean" },
            potentialScore: { type: "number" },
            emailValidation: { type: "boolean" }
          }
        },
        { type: "null" }
      ],
      description: "从本机 MTOP getUserInfoByParams 日志解析出的联系人快照。"
    },
    accountTokenProfile: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            accountId: stringOrNumberSchema,
            accountIdEncrypted: { type: "string" },
            targetAliId: stringOrNumberSchema,
            targetAliIdEncrypted: { type: "string" },
            targetLoginId: { type: "string" },
            targetLoginIdEncrypted: { type: "string" },
            checkResult: { type: "boolean" }
          }
        },
        { type: "null" }
      ],
      description: "从本机 MTOP getAccountInfoByToken 日志解析出的 chatToken 到账号映射。"
    },
    contactExtInfo: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            accountIdEncrypt: { type: "string" },
            accountStatus: stringOrNumberSchema,
            aliId: stringOrNumberSchema,
            avatarUrl: { type: "string" },
            companyName: { type: "string" },
            country: { type: "string" },
            firstName: { type: "string" },
            lastName: { type: "string" },
            loginId: { type: "string" },
            vaccountId: stringOrNumberSchema
          }
        },
        { type: "null" }
      ],
      description: "Parsed from local MTOP contact.extinfo.get logs; fills stable company/contact basics."
    },
    chatSummary: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            productCardNum: { type: "number" },
            inquiryCardNum: { type: "number" },
            quotationCardNum: { type: "number" },
            unPayOrderNum: { type: "number" },
            unshippedOrderNum: { type: "number" },
            unConfirmShipmentOrderNum: { type: "number" }
          }
        },
        { type: "null" }
      ],
      description: "chatManager/getChatDataSummary.htm 返回的客户互动摘要。"
    },
    detailStatus: {
      type: "object",
      required: ["available", "source"],
      additionalProperties: false,
      properties: {
        available: { type: "boolean", description: "完整 alicrm 客户详情当前是否可直接获取。" },
        source: { type: "string", enum: ["alicrm_jsonp"] },
        reason: { type: "string", description: "不可用原因。" }
      }
    },
    matchedSources: {
      type: "array",
      description: "本次成功匹配到的本机数据来源。",
      items: { type: "string" }
    }
  }
} as const;

export const healthRouteSchema = {
  tags: ["System"],
  summary: "检查本机 API 服务是否可用",
  description: "用于前端或调试脚本快速确认 Fastify 服务已经启动。该接口不读取阿里会话，也不需要本机 Bearer token。",
  response: {
    200: healthResponseSchema
  }
} as const;

export const sessionStatusRouteSchema = {
  tags: ["System"],
  summary: "检查当前可解析的阿里登录态字段",
  description:
    "读取本机 AliWorkbench 日志、缓存 URL 和 Chromium Cookies DB，只返回 Cookie 名称和布尔状态，不返回任何 Cookie/token 值。用于判断会话接口重定向是否因为登录 Cookie 不完整。",
  response: {
    200: sessionStatusResponseSchema,
    500: errorResponseSchema
  }
} as const;

export const conversationsRouteSchema = {
  tags: ["Conversations"],
  summary: "获取缓存会话列表",
  description:
    "读取本机日志中提取到的有效 Cookie，访问 weblitePWA.htm，并解析页面启动数据里的缓存会话。返回值只包含本机生成的会话 ID、展示名称、最后消息预览等前端需要的字段。",
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: {
      refresh: {
        ...boolStringSchema,
        description: "传 true 时重新请求 weblitePWA.htm；默认使用 API 进程内存里的缓存。"
      }
    }
  },
  response: {
    200: conversationsResponseSchema,
    500: errorResponseSchema
  }
} as const;

export const messagesRouteSchema = {
  tags: ["Messages"],
  summary: "分页拉取指定会话消息",
  description:
    "根据会话列表返回的本机会话 ID，调用 getChatMessageList.htm 拉取一页消息。默认从当前时间往前取；如果要继续拉更早消息，把上一次响应里的 nextBefore 作为 before 参数传入。",
  params: {
    type: "object",
    required: ["id"],
    additionalProperties: false,
    properties: {
      id: { type: "string", description: "会话列表接口返回的本机会话 ID。" }
    }
  },
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: {
      before: {
        type: "string",
        description: "毫秒时间戳游标。不传时从当前时间开始向前拉取。"
      },
      limit: {
        type: "string",
        description: "每页消息数量。默认 50。"
      }
    }
  },
  response: {
    200: messagesResponseSchema,
    404: errorResponseSchema,
    500: errorResponseSchema
  }
} as const;

export const customerRouteSchema = {
  tags: ["Customers"],
  summary: "获取会话对应的客户信息",
  description:
    "根据会话缓存里的联系人账号 ID，把聊天记录和本机 MTOP 联系人快照、chatManager 互动摘要对应起来。完整 alicrm 客户详情 JSONP 目前需要更完整的浏览器运行态，接口会返回 detailStatus 说明当前状态。",
  params: {
    type: "object",
    required: ["id"],
    additionalProperties: false,
    properties: {
      id: { type: "string", description: "会话列表接口返回的本机会话 ID。" }
    }
  },
  response: {
    200: customerInfoResponseSchema,
    404: errorResponseSchema,
    500: errorResponseSchema
  }
} as const;

export const exportRouteSchema = {
  tags: ["Export"],
  summary: "导出缓存会话消息到本地 JSON",
  description:
    "遍历当前缓存会话，按 maxPages/pageSize 分页拉取消息并写入 exports 目录。导出文件会保留消息正文和脱敏后的 raw 字段，不会写出 Cookie、ctoken、chatToken 等敏感凭据。",
  body: exportRequestSchema,
  response: {
    200: exportResponseSchema,
    500: errorResponseSchema
  }
} as const;
