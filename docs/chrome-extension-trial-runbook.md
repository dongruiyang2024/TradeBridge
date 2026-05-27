# Chrome 插件内部试运行手册

## 前置条件

- Chrome 浏览器。
- 用户已能访问 `https://onetalk.alibaba.com/` 并完成登录。
- TradeBridge server 运行在 `http://127.0.0.1:5032`。
- 已创建 TradeBridge 管理员账号。

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

在插件设置页完成采集端激活：

- Server URL：`http://127.0.0.1:5032`
- 邮箱：管理员邮箱
- 密码：管理员密码
- Seller Account：卖家账号外部 ID
- Device ID：本机插件设备 ID
- Device Name：本机插件设备名称

点击“激活采集端”后，插件会调用 `/collector/v1/auth/login`，并保存服务端返回的 collector token。后续同步只使用该 collector token，不保存管理员密码。

不要在设置页填写 OneTalk Cookie、`ctoken`、`_tb_token_`、`sgcookie`、`x5sec` 或 `chatToken`。

## 手工验证

1. Chrome 打开 `https://onetalk.alibaba.com/`。
2. 确认 OneTalk 页面已登录。
3. 打开插件设置页并完成采集端激活。
4. 点击插件弹窗里的同步按钮。
5. 打开 TradeBridge Web 工作台。
6. 确认客户、会话和消息可见。
7. 撤销 collector token 后再次同步，确认插件显示 `tradebridge_unauthorized`。

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
