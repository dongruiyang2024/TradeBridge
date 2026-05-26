# Chrome 插件内部试运行手册

## 前置条件

- Chrome 浏览器。
- 用户已能访问 `https://onetalk.alibaba.com/` 并完成登录。
- TradeBridge server 运行在 `http://127.0.0.1:5032`。
- 管理员已注册采集设备并拿到 collector token。

## 构建插件

```bash
npm run build -w @wangwang/chrome-extension
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

在插件设置页填写：

- Server URL：`http://127.0.0.1:5032`
- Org ID：`org_internal`
- Seller Account External ID：卖家账号外部 ID
- Device ID：本机插件设备 ID
- Collector Token：TradeBridge 返回的采集设备 token

不要在设置页填写 OneTalk Cookie、`ctoken`、`_tb_token_`、`sgcookie`、`x5sec` 或 `chatToken`。

## 手工验证

1. Chrome 打开 `https://onetalk.alibaba.com/`。
2. 确认 OneTalk 页面已登录。
3. 点击插件弹窗里的同步按钮。
4. 打开 TradeBridge Web 工作台。
5. 确认客户、会话和消息可见。
6. 撤销 collector token 后再次同步，确认插件显示 `tradebridge_unauthorized`。

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
