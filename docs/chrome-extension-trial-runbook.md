# Chrome 插件内部试运行手册

## 前置条件

- Chrome 浏览器。
- 用户已能访问 `https://onetalk.alibaba.com/` 并完成登录。
- 内部试运行时 TradeBridge server 可运行在 `http://127.0.0.1:5032`；发布候选包应使用正式 HTTPS 域名。
- 已创建 TradeBridge 管理员账号。

## 渠道说明

当前试运行渠道是阿里国际站消息通道：

```text
channel: alibaba-im
surface: onetalk-web
业务别名：TM / TradeManager / 国际版旺旺 / 旺旺
页面：https://onetalk.alibaba.com/
```

OneTalk 是阿里国际站消息通道当前接入的 Web 实现面，不是和 TM 并列的独立渠道。

## 构建插件

默认正式包请先在本地环境文件里配置正式服务地址：

```bash
TRADEBRIDGE_SERVER_URL=https://tradebridge.example.com
```

然后构建默认正式包：

```bash
npm run build -w @wangwang/chrome-extension
```

如需连接本机 TradeBridge 服务，显式构建本地测试包：

```bash
npm run build:local -w @wangwang/chrome-extension
```

构建产物在：

```text
apps/chrome-extension/dist
```

## 安装 unpacked extension

1. 打开 `chrome://extensions`。
2. 开启 Developer mode。
3. 点击 Load unpacked。
4. 选择 `apps/chrome-extension/dist`。

## 配置

在插件设置页完成采集端激活：

- 服务连接：默认正式包使用 `TRADEBRIDGE_SERVER_URL`；本地测试包固定使用 `http://127.0.0.1:5032`
- Trade-Mind 激活码：从 Trade-Mind 沟通页复制
- 同步间隔：默认 30 分钟，可按试运行需要调整
- 启用历史消息回补：默认开启
- 每会话回补条数：默认 20 条，最大 100 条

点击“保存并激活”后，Chrome 会按 Server URL 申请 TradeBridge 服务端访问权限。授权后插件会自动生成并复用设备 ID，设备名称默认使用 `Chrome Extension`，然后调用 `/collector/v1/auth/login` 并保存服务端返回的 collector token。后续同步只使用该 collector token，不保存管理员密码。

不要在设置页填写 OneTalk Cookie、`ctoken`、`_tb_token_`、`sgcookie`、`x5sec`、`chatToken` 或任何第三方平台 token。

## 手工验证

1. Chrome 打开 `https://onetalk.alibaba.com/`。
2. 确认 OneTalk Web 页面已登录。
3. 打开插件设置页并完成采集端激活。
4. 点击插件弹窗里的同步按钮。
5. 确认插件弹窗显示实时连接、最近同步、抓取诊断和历史回补摘要。
6. 打开 TradeBridge Web 工作台。
7. 确认客户详情、会话和消息可见。
8. 撤销 collector token 后再次同步，确认插件显示 `tradebridge_unauthorized`。

## 安全检查

服务端、导出文件、Web 响应中不应出现：

- `cookie2`
- `ctoken`
- `_tb_token_`
- `sgcookie`
- `x5sec`
- `chatToken`
- `Authorization`
- `Cookie`
- `Set-Cookie`
