# OneTalk 增强同步实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 尽量从 `onetalk.alibaba.com` 同步客户名称、会话列表、聊天记录和接口诊断信息，先解决当前“会话有但消息为空”的问题。

**架构：** 第一阶段保持现有同步协议和数据库 schema，不做大规模扩表。Chrome 插件在调用 OneTalk 消息接口时补充 CSRF 查询参数，并兼容多种消息列表响应路径；同步状态保存每个会话的消息接口诊断，便于判断是接口参数、响应结构、登录态还是空数据。adapter 映射层增强客户名、最近消息时间和消息正文的字段别名。

**技术栈：** Chrome Extension Manifest V3、Vite、`@wangwang/onetalk-adapter`、Node test runner、TypeScript。

---

## 文件结构

- 修改：`apps/chrome-extension/src/shared/chrome-api.ts`
  - 增加 `chrome.cookies.getAll` 类型。
- 修改：`apps/chrome-extension/src/background/onetalk-client.ts`
  - 为 `getChatMessageList.htm` 拼接 `ctoken` / `_tb_token_` 查询参数。
  - 兼容 `data.list` 之外的消息列表路径。
  - 返回去敏诊断信息。
- 修改：`apps/chrome-extension/src/background/sync-orchestrator.ts`
  - 收集每个会话消息接口诊断并写入插件状态。
- 修改：`apps/chrome-extension/src/shared/sync-types.ts`
  - 增加同步诊断状态类型。
- 修改：`apps/chrome-extension/src/popup/popup.ts`
  - 在弹窗里展示最近一次消息接口诊断摘要。
- 修改：`packages/onetalk-adapter/src/onetalk-client.ts`
  - 给 `ChatMessageResponse` 增加可选诊断类型定义。
- 修改：`packages/onetalk-adapter/src/sync-mapper.ts`
  - 增强客户名称、最近消息时间、消息 ID、正文和时间字段别名。
- 测试：`apps/chrome-extension/test/onetalk-client.test.ts`
- 测试：`apps/chrome-extension/test/sync-orchestrator.test.ts`
- 测试：`packages/onetalk-adapter/test/sync-mapper.test.ts`

## 任务 1：消息接口补 CSRF 并兼容响应结构

- [x] **步骤 1：编写失败测试**

在 `apps/chrome-extension/test/onetalk-client.test.ts` 增加两个测试：

```ts
test("getChatMessages appends csrf query from Chrome cookies", async () => {
  // chrome.cookies.getAll 返回 xman_us_t 和 _tb_token_
  // 断言请求 URL 包含 ctoken 和 _tb_token_
});

test("getChatMessages parses alternate message list paths", async () => {
  // 响应使用 data.messages 或 result.list
  // 断言 result.messages 可读出消息
});
```

- [x] **步骤 2：运行测试确认失败**

```bash
npm test -w @wangwang/chrome-extension
```

预期：新增测试失败，原因是 URL 没有 CSRF 查询参数，且只读取 `data.list`。

- [x] **步骤 3：实现最少代码**

在 `BrowserOnetalkClient` 中：

```ts
const query = await this.csrfQuery();
const endpoint = MESSAGE_URL + (query ? `?${query}` : "");
```

消息列表解析按顺序尝试：

```ts
data.list
data.messages
data.messageList
result.list
result.messages
list
messages
```

- [x] **步骤 4：运行测试确认通过**

```bash
npm test -w @wangwang/chrome-extension
```

- [x] **步骤 5：Commit**

```bash
git add apps/chrome-extension/src/background/onetalk-client.ts apps/chrome-extension/src/shared/chrome-api.ts apps/chrome-extension/test/onetalk-client.test.ts
git commit -m "fix(chrome-extension): 补全 OneTalk 消息接口参数"
```

## 任务 2：记录消息接口诊断

- [ ] **步骤 1：编写失败测试**

在 `apps/chrome-extension/test/sync-orchestrator.test.ts` 断言同步成功后 `store.status.lastDiagnostics` 包含：

```ts
{
  conversations: 1,
  messageRequests: [{ conversationId: "conv-1", status: 200, listLength: 1 }]
}
```

- [ ] **步骤 2：实现状态类型和保存逻辑**

在 `ExtensionStatus` 中增加：

```ts
lastDiagnostics?: {
  conversations: number;
  messageRequests: Array<{
    conversationId: string;
    status: number;
    code?: string | number | null;
    listLength: number;
    listPath?: string;
    topLevelKeys: string[];
    dataKeys: string[];
  }>;
};
```

- [ ] **步骤 3：弹窗展示摘要**

同步成功时展示：

```text
最近同步：...
消息接口：1/5 个会话有消息
```

- [ ] **步骤 4：运行测试**

```bash
npm test -w @wangwang/chrome-extension
```

- [ ] **步骤 5：Commit**

```bash
git add apps/chrome-extension/src/background/sync-orchestrator.ts apps/chrome-extension/src/shared/sync-types.ts apps/chrome-extension/src/popup/popup.ts apps/chrome-extension/test/sync-orchestrator.test.ts
git commit -m "feat(chrome-extension): 记录 OneTalk 消息接口诊断"
```

## 任务 3：增强客户和消息字段映射

- [ ] **步骤 1：编写失败测试**

在 `packages/onetalk-adapter/test/sync-mapper.test.ts` 增加测试：会话里使用 `buyerName`、`latestMessage.sendTime`，消息里使用 `msgId`、`messageContent`、`gmtCreate`，断言能映射为客户名、最近消息时间和消息正文。

- [ ] **步骤 2：实现字段别名**

在 `sync-mapper.ts` 中扩展候选字段：

```ts
displayName: contactNick, contactName, buyerName, buyerNick, nickName, name
lastMessageAt: lastMessageTime, latestMessage.sendTime, latestMessage.time
content: content, text, message, summary, messageContent, textContent, showText
```

- [ ] **步骤 3：运行 adapter 测试**

```bash
npm test -w @wangwang/onetalk-adapter
```

- [ ] **步骤 4：Commit**

```bash
git add packages/onetalk-adapter/src/sync-mapper.ts packages/onetalk-adapter/test/sync-mapper.test.ts
git commit -m "feat(onetalk-adapter): 增强客户和消息字段映射"
```

## 任务 4：最终验证

- [ ] **步骤 1：运行定向验证**

```bash
npm test -w @wangwang/onetalk-adapter
npm test -w @wangwang/chrome-extension
npm run typecheck
npm run build -w @wangwang/chrome-extension
```

- [ ] **步骤 2：Commit 计划状态**

如计划复选框有更新：

```bash
git add docs/superpowers/plans/2026-05-27-onetalk-fuller-sync.md
git commit -m "docs: 更新 OneTalk 增强同步计划"
```
