# Chrome 插件隐私与数据说明

本文说明 TradeBridge Chrome 插件在 OneTalk Web 场景下会处理哪些数据，以及哪些数据不会被采集或上传。

## 插件会保存的数据

保存在 Chrome extension storage 中：

- TradeBridge Server URL。
- collector token。
- 采集设备 ID 和设备名称。
- 激活插件的 TradeBridge 管理员邮箱。
- 同步间隔、历史回补开关和每会话回补条数。
- 最近同步状态、实时连接状态和抓取诊断计数。

插件不会保存管理员密码。管理员密码只在设置页激活 collector device 时提交给 TradeBridge 服务端。

## 插件会上传的数据

用户已经登录 OneTalk Web 页面后，插件会把授权页面运行时返回的业务数据同步到 TradeBridge 服务端：

- 客户身份信息，例如外部客户 ID、登录名、头像、国家或地区、公司名称、注册时间和页面可见的客户详情字段。
- 会话信息，例如外部会话 ID、会话参与人、最近消息时间和未读状态。
- 消息信息，例如消息 ID、正文、发送方、接收方、方向、时间戳和必要的附件/消息类型元数据。
- 同步诊断信息，例如本轮会话数、实时 tap 消息数、历史回补消息数和请求来源。

这些数据用于在 TradeBridge Web 工作台展示客户、会话、消息、跟进任务和外发状态。

## 插件不会采集的数据

插件不应采集或上传：

- OneTalk 密码。
- OneTalk Cookie。
- `ctoken`、`_tb_token_`、`sgcookie`、`x5sec`、`chatToken`、access token、refresh token 等第三方平台 token。
- 原始 `Authorization`、`Cookie`、`Set-Cookie` 请求头。
- 与 `https://onetalk.alibaba.com/` 无关的浏览历史或页面内容。
- 本机文件、桌面应用日志、浏览器 Cookie 数据库或系统钥匙串。

插件上传前会执行敏感字段过滤，服务端也会以 collector token 绑定的设备和卖家身份为准，不信任客户端上传的归属字段。

## 权限用途

- `storage`：保存 collector token、设备 ID、配置和同步状态。
- `alarms`：定时同步、领取外发消息和实时连接保活。
- `scripting`：向已授权的 OneTalk 页面注入页面桥接脚本。
- `https://onetalk.alibaba.com/*`：读取和发送授权 OneTalk 页面内的业务消息。
- `optional_host_permissions`：在设置页按用户填写的 TradeBridge Server URL 申请服务端访问权限。

## 用户控制

- 用户可以在 Chrome 扩展管理页移除插件，删除本地保存的 collector token 和设备配置。
- 管理员可以在 TradeBridge 服务端撤销 collector token，使插件无法继续同步或外发。
- 修改 Server URL 时，插件会按新的服务端域名重新申请访问权限。
