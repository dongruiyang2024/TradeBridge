# 简化采集端激活配置实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 从采集端用户配置中移除 seller 和 device 细节，只要求用户提供服务端地址与管理员账号密码；设备 ID 自动生成，设备名称自动默认。

**架构：** seller/device 仍保留在同步数据模型中，但不再作为用户配置项暴露。服务端激活接口为缺省 seller 和 device 生成稳定绑定，同步接口根据 collector token 对应的设备记录覆盖上传批次中的 seller/device 归属，避免客户端填错或伪造。Chrome 插件本地持久化自动生成的设备 ID；桌面端只读取服务端地址与 collector token。

**技术栈：** Fastify、React/Vite Chrome Extension、Electron、Node test runner、PostgreSQL、`@wangwang/database`。

---

## 设计结论

- `sellerAccountExternalId` 仍是数据库和 Web 查询的内部 scope，但默认值由服务端生成，用户不需要理解或填写。
- `deviceExternalId` 由客户端自动生成并保存；如果旧客户端不传，服务端兜底生成一次性设备 ID。
- `deviceName` 使用默认展示名：Chrome 插件为 `Chrome Extension`，桌面端为本机 hostname。
- 同步接口必须以已认证 collector token 绑定的 `sellerAccountExternalId` 和 `externalDeviceId` 为准，不能信任上传 payload 自带的 seller/device。
- `.env.example` 和运行文档移除 `WANGWANG_SELLER_ACCOUNT_ID`、`WANGWANG_SELLER_DISPLAY_NAME`、`WANGWANG_COLLECTOR_DEVICE_ID`、`WANGWANG_DEVICE_NAME`。

## 文件结构

- 修改：`apps/server/src/server.ts`
  - 激活接口允许省略 seller 和 device。
  - 同步接口返回认证设备，并覆盖 sync batch seller/device 归属。
- 修改：`apps/server/test/auth-routes.test.ts`
  - 覆盖激活接口省略 seller/device 的默认行为。
- 修改：`apps/server/test/sync-batches.test.ts`
  - 覆盖同步时 payload seller/device 被 collector token 绑定覆盖。
- 修改：`apps/chrome-extension/src/shared/sync-types.ts`
  - 激活输入中的 seller/device 字段改为可选。
- 修改：`apps/chrome-extension/src/options/options.html`
  - 移除卖家账号 ID、设备 ID、设备名称输入框。
- 修改：`apps/chrome-extension/src/options/options.ts`
  - 自动生成并复用设备 ID，使用默认设备名称，保存服务端返回的 seller/device。
- 修改：`apps/chrome-extension/test/tradebridge-client.test.ts`
  - 覆盖激活请求允许只提交邮箱密码和服务端地址。
- 修改：`apps/collector-desktop/src/electron-main.ts`
  - 移除 seller/device 环境变量读取，使用内部默认 seller 和 hostname 设备信息。
- 修改：`apps/collector-desktop/test/electron-shell.test.ts`
  - 覆盖简化后的默认显示状态。
- 修改：`.env.example`
  - 移除无用采集端 seller/device 变量。
- 修改：`docs/ENVIRONMENT.md`
  - 更新采集端配置说明。
- 修改：`docs/internal-trial-runbook.md`
  - 更新桌面采集端激活和环境变量流程。
- 修改：`docs/chrome-extension-trial-runbook.md`
  - 更新 Chrome 插件激活页字段说明。

## 任务 1：服务端默认绑定与同步归属覆盖

**文件：**
- 修改：`apps/server/src/server.ts`
- 测试：`apps/server/test/auth-routes.test.ts`
- 测试：`apps/server/test/sync-batches.test.ts`

- [ ] **步骤 1：编写失败的激活默认值测试**

在 `apps/server/test/auth-routes.test.ts` 增加测试：请求 `/collector/v1/auth/login` 时只提交 `email`、`password`，断言返回 200、`device.sellerAccountExternalId === "default-seller"`，且 `device.externalDeviceId` 以 `collector-` 开头。

- [ ] **步骤 2：编写失败的同步归属覆盖测试**

在 `apps/server/test/sync-batches.test.ts` 增加测试：注册设备时绑定 `seller-token` 和 `device-token`，上传 payload 里故意写 `seller-forged` 和 `device-forged`，断言 store 中客户归属为 `seller-token`，设备列表中的 `externalDeviceId` 仍为 `device-token`。

- [ ] **步骤 3：运行服务端测试确认失败**

运行：

```bash
npm test -w @wangwang/server
```

预期：新增测试失败，原因是当前激活接口要求 seller/device，且同步接口信任 payload。

- [ ] **步骤 4：实现服务端默认值与归属覆盖**

在 `apps/server/src/server.ts` 中增加默认值常量，激活接口使用：

```ts
const DEFAULT_SELLER_ACCOUNT_EXTERNAL_ID = "default-seller";
const DEFAULT_COLLECTOR_DEVICE_NAME = "TradeBridge Collector";
```

同步接口从认证设备获得 scope，并在 `store.acceptSyncBatch` 前覆盖：

```ts
const batch = collectorScopedBatch(request.body as SyncBatch, collectorDevice);
```

- [ ] **步骤 5：运行服务端测试验证通过**

运行：

```bash
npm test -w @wangwang/server
```

预期：PASS。

- [ ] **步骤 6：Commit**

```bash
git add apps/server/src/server.ts apps/server/test/auth-routes.test.ts apps/server/test/sync-batches.test.ts
git commit -m "feat(server): 简化采集端默认绑定"
```

## 任务 2：Chrome 插件自动生成设备信息

**文件：**
- 修改：`apps/chrome-extension/src/shared/sync-types.ts`
- 修改：`apps/chrome-extension/src/options/options.html`
- 修改：`apps/chrome-extension/src/options/options.ts`
- 测试：`apps/chrome-extension/test/tradebridge-client.test.ts`

- [ ] **步骤 1：编写失败的激活客户端测试**

在 `apps/chrome-extension/test/tradebridge-client.test.ts` 增加测试：`activateCollectorDevice` 只传 `serverUrl`、`email`、`password`，断言请求体不包含 `sellerAccountExternalId`，接口仍返回 token 和默认 seller/device。

- [ ] **步骤 2：运行插件测试确认失败**

运行：

```bash
npm test -w @wangwang/chrome-extension
```

预期：TypeScript 或断言失败，原因是激活类型要求 seller/device。

- [ ] **步骤 3：移除表单中的 seller/device 字段**

在 `apps/chrome-extension/src/options/options.html` 只保留：

```html
<label>Server URL <input name="serverUrl" value="http://127.0.0.1:5032" /></label>
<label>邮箱 <input name="email" type="email" autocomplete="username" /></label>
<label>密码 <input name="password" type="password" autocomplete="current-password" /></label>
```

- [ ] **步骤 4：自动生成并保存设备 ID**

在 `apps/chrome-extension/src/options/options.ts` 中复用已保存 `config.deviceId`，否则生成 `chrome-extension-<uuid>`。设备名称默认 `Chrome Extension`。保存时使用服务端返回的 `activation.device.sellerAccountExternalId` 和 `activation.device.externalDeviceId`。

- [ ] **步骤 5：运行插件验证**

运行：

```bash
npm run typecheck -w @wangwang/chrome-extension
npm test -w @wangwang/chrome-extension
npm run build -w @wangwang/chrome-extension
```

预期：全部 PASS。

- [ ] **步骤 6：Commit**

```bash
git add apps/chrome-extension/src/shared/sync-types.ts apps/chrome-extension/src/options/options.html apps/chrome-extension/src/options/options.ts apps/chrome-extension/test/tradebridge-client.test.ts
git commit -m "feat(chrome-extension): 自动生成采集设备信息"
```

## 任务 3：桌面采集端移除 seller/device 环境变量

**文件：**
- 修改：`apps/collector-desktop/src/electron-main.ts`
- 测试：`apps/collector-desktop/test/electron-shell.test.ts`

- [ ] **步骤 1：更新桌面端默认行为测试**

在 `apps/collector-desktop/test/electron-shell.test.ts` 保持 shell 只展示 seller/device 状态，不再要求环境变量来自用户配置。

- [ ] **步骤 2：移除桌面入口环境变量依赖**

在 `apps/collector-desktop/src/electron-main.ts` 中移除 `WANGWANG_SELLER_ACCOUNT_ID`、`WANGWANG_SELLER_DISPLAY_NAME`、`WANGWANG_COLLECTOR_DEVICE_ID`、`WANGWANG_DEVICE_NAME` 的读取。使用：

```ts
const DEFAULT_SELLER_ACCOUNT_ID = "default-seller";
const defaultDeviceId = `collector-desktop-${os.hostname()}`;
const defaultDeviceName = os.hostname();
```

- [ ] **步骤 3：运行桌面端验证**

运行：

```bash
npm run typecheck -w @wangwang/collector-desktop
npm test -w @wangwang/collector-desktop
```

预期：PASS。

- [ ] **步骤 4：Commit**

```bash
git add apps/collector-desktop/src/electron-main.ts apps/collector-desktop/test/electron-shell.test.ts
git commit -m "feat(collector-desktop): 移除采集端冗余环境变量"
```

## 任务 4：更新环境变量和试运行文档

**文件：**
- 修改：`.env.example`
- 修改：`docs/ENVIRONMENT.md`
- 修改：`docs/internal-trial-runbook.md`
- 修改：`docs/chrome-extension-trial-runbook.md`

- [ ] **步骤 1：移除环境变量模板中的冗余项**

从 `.env.example` 删除：

```dotenv
WANGWANG_SELLER_ACCOUNT_ID
WANGWANG_SELLER_DISPLAY_NAME
WANGWANG_COLLECTOR_DEVICE_ID
WANGWANG_DEVICE_NAME
```

- [ ] **步骤 2：更新 Chrome 插件手册**

文档中说明插件激活页只需要 Server URL、邮箱、密码；设备 ID 和设备名称自动生成。

- [ ] **步骤 3：更新桌面采集端手册**

文档中说明桌面端只需要：

```dotenv
WANGWANG_SERVER_URL=http://127.0.0.1:5032
WANGWANG_COLLECTOR_TOKEN=<激活接口返回 token>
```

- [ ] **步骤 4：运行关键词检查**

运行：

```bash
rg -n "WANGWANG_SELLER_ACCOUNT_ID|WANGWANG_SELLER_DISPLAY_NAME|WANGWANG_COLLECTOR_DEVICE_ID|WANGWANG_DEVICE_NAME|卖家账号 ID|设备 ID|设备名称" .env.example docs apps/chrome-extension/src/options -g '!docs/superpowers/**'
```

预期：除历史计划外，用户文档和插件表单不再要求这些字段。

- [ ] **步骤 5：Commit**

```bash
git add .env.example docs/ENVIRONMENT.md docs/internal-trial-runbook.md docs/chrome-extension-trial-runbook.md
git commit -m "docs: 简化采集端配置说明"
```

## 任务 5：全量验证与收尾

**文件：**
- 测试：`test/e2e/internal-trial.test.ts`

- [ ] **步骤 1：确认 E2E 仍走激活流程**

检查 `test/e2e/internal-trial.test.ts` 中 `/collector/v1/auth/login` 可省略 seller/device，或继续传入测试值但不依赖环境变量。

- [ ] **步骤 2：运行全量验证**

运行：

```bash
npm test -w @wangwang/database
npm test -w @wangwang/server
npm test -w @wangwang/chrome-extension
npm test -w @wangwang/collector-desktop
npm run typecheck
npm run test:e2e
```

预期：全部 PASS。

- [ ] **步骤 3：Commit**

如 E2E 或计划状态有改动：

```bash
git add test/e2e/internal-trial.test.ts docs/superpowers/plans/2026-05-27-simplify-collector-activation-config.md
git commit -m "test: 验证简化采集端配置流程"
```
