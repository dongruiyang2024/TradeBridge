# Chrome 插件发布清单

本文用于把 `apps/chrome-extension/dist` 从内部试运行推进到真实发布。

## 发布前代码检查

- `npm run test -w @wangwang/chrome-extension`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `node --check apps/chrome-extension/dist/channels/alibaba-im/onetalk-page-script.js`

## 服务端准备

- 使用正式 HTTPS 域名，不使用 `127.0.0.1` 或临时隧道作为发布 Server URL。
- 确认 `/collector/v1/auth/login`、`/collector/v1/sync-batches`、`/collector/v1/outbound-messages` 和 `/collector/v1/ws` 在正式域名可用。
- CORS 允许正式 Chrome extension origin，并保留本地开发 origin 只用于内部测试。
- collector token 可撤销，撤销后插件同步应显示 `tradebridge_unauthorized`。
- 数据库迁移已在正式环境执行，客户详情字段和消息去重逻辑可用。

## 插件配置

- Manifest 只在安装时声明 `https://onetalk.alibaba.com/*`。
- TradeBridge 服务端权限通过设置页按用户填写的 Server URL 运行时申请。
- 设置页只填写 TradeBridge 管理员账号，不填写 OneTalk 密码、Cookie 或 Token。
- 默认同步间隔为 30 分钟，可配置范围 5 到 1440 分钟。
- 默认启用历史消息回补，每会话默认 20 条，可配置范围 1 到 100 条。

## Chrome Web Store 素材

- 准备正式插件名称、简短描述、详细描述和隐私说明 URL。
- 准备图标、截图和可读的权限用途说明。
- 权限说明应明确：
  - `storage` 用于保存 collector token、设备 ID 和同步状态。
  - `alarms` 用于定时同步和实时连接保活。
  - `scripting` 用于把 OneTalk 页面桥接脚本注入已授权页面。
  - `host_permissions` 仅用于 OneTalk Web 页面。
  - `optional_host_permissions` 用于用户配置的 TradeBridge 服务端域名。

## 真实账号 Smoke

1. 安装发布候选包。
2. 打开并登录 `https://onetalk.alibaba.com/`。
3. 在设置页填写正式 HTTPS Server URL，授予服务器访问权限并激活。
4. 点击 popup 的“立即同步”。
5. 确认 popup 显示实时连接、最近同步、抓取诊断和历史回补摘要。
6. 在 Web 工作台确认客户详情、会话列表、历史消息和新消息都可见。
7. 在 Web 工作台创建一条外发消息，确认插件投递并回写状态。
8. 撤销 collector token，确认插件报错并停止上传。

## 回滚

- 保留上一个可用的 Chrome Web Store 版本和对应 git commit。
- 服务端保留向后兼容的 collector API 至少一个发布周期。
- 如果 OneTalk 页面 SDK 变化导致历史回补失败，应保证实时 tap 消息仍可同步。
