import base64
import gzip
import hashlib
import json
import os
import secrets
import shutil
import socket
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from probe_alicrm_with_log_cookies import extract_cookies


LOG_PATHS = [
    Path(r"D:\AlibabaSupplierData\app.log"),
    Path(r"C:\Users\wait9yan\AppData\Local\AliWorkbenchTemp\cef.log"),
]

CHROME_PATH = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
PROFILE_DIR = Path(r"E:\projects\app\VSCode\xiezi\wangwang\.tmp-cdp-chrome-profile")
PORT = 9338


class CDPWebSocket:
    def __init__(self, ws_url: str) -> None:
        parsed = urllib.parse.urlsplit(ws_url)
        if parsed.scheme != "ws":
            raise ValueError(f"Unsupported websocket scheme: {parsed.scheme}")
        self.host = parsed.hostname or "127.0.0.1"
        self.port = parsed.port or 80
        self.path = urllib.parse.urlunsplit(("", "", parsed.path, parsed.query, ""))
        self.sock = socket.create_connection((self.host, self.port), timeout=10)
        self.sock.settimeout(20)
        self._handshake()
        self._next_id = 1

    def _handshake(self) -> None:
        key = base64.b64encode(secrets.token_bytes(16)).decode("ascii")
        request = (
            f"GET {self.path} HTTP/1.1\r\n"
            f"Host: {self.host}:{self.port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        ).encode("ascii")
        self.sock.sendall(request)
        response = b""
        while b"\r\n\r\n" not in response:
            chunk = self.sock.recv(4096)
            if not chunk:
                break
            response += chunk
        if b" 101 " not in response.split(b"\r\n", 1)[0]:
            raise RuntimeError("websocket handshake failed")
        accept_src = (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")
        expected = base64.b64encode(hashlib.sha1(accept_src).digest())
        if expected not in response:
            raise RuntimeError("websocket accept check failed")

    def close(self) -> None:
        try:
            self._send_frame(b"", opcode=8)
        except Exception:
            pass
        self.sock.close()

    def _send_frame(self, payload: bytes, opcode: int = 1) -> None:
        header = bytearray()
        header.append(0x80 | opcode)
        length = len(payload)
        mask_bit = 0x80
        if length < 126:
            header.append(mask_bit | length)
        elif length <= 0xFFFF:
            header.append(mask_bit | 126)
            header.extend(struct.pack("!H", length))
        else:
            header.append(mask_bit | 127)
            header.extend(struct.pack("!Q", length))
        mask = secrets.token_bytes(4)
        masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
        self.sock.sendall(bytes(header) + mask + masked)

    def _recv_exact(self, size: int) -> bytes:
        data = b""
        while len(data) < size:
            chunk = self.sock.recv(size - len(data))
            if not chunk:
                raise RuntimeError("websocket closed")
            data += chunk
        return data

    def _recv_frame(self) -> tuple[int, bytes]:
        first = self._recv_exact(2)
        opcode = first[0] & 0x0F
        masked = bool(first[1] & 0x80)
        length = first[1] & 0x7F
        if length == 126:
            length = struct.unpack("!H", self._recv_exact(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self._recv_exact(8))[0]
        mask = self._recv_exact(4) if masked else b""
        payload = self._recv_exact(length) if length else b""
        if masked:
            payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
        return opcode, payload

    def recv_json(self) -> dict[str, Any]:
        chunks: list[bytes] = []
        while True:
            opcode, payload = self._recv_frame()
            if opcode == 8:
                raise RuntimeError("websocket closed")
            if opcode == 9:
                self._send_frame(payload, opcode=10)
                continue
            if opcode in (1, 0):
                chunks.append(payload)
                if opcode == 1:
                    break
        return json.loads(b"".join(chunks).decode("utf-8", "ignore"))

    def call(self, method: str, params: dict[str, Any] | None = None, timeout: float = 20) -> dict[str, Any]:
        msg_id = self._next_id
        self._next_id += 1
        payload = {"id": msg_id, "method": method}
        if params is not None:
            payload["params"] = params
        self._send_frame(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
        deadline = time.time() + timeout
        while time.time() < deadline:
            response = self.recv_json()
            if response.get("id") == msg_id:
                return response
        raise TimeoutError(method)


def http_json(url: str, timeout: float = 10) -> Any:
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        raw = resp.read()
        if resp.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return json.loads(raw.decode("utf-8", "ignore"))


def wait_for_debugger(port: int) -> str:
    last_error = None
    for _ in range(80):
        try:
            targets = http_json(f"http://127.0.0.1:{port}/json/list", timeout=1)
            if targets:
                page = next((item for item in targets if item.get("type") == "page"), targets[0])
                return page["webSocketDebuggerUrl"]
        except Exception as exc:
            last_error = exc
        time.sleep(0.25)
    raise RuntimeError(f"Chrome debugger not ready: {last_error}")


def launch_chrome() -> subprocess.Popen:
    if not CHROME_PATH.exists():
        raise FileNotFoundError(str(CHROME_PATH))
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    args = [
        str(CHROME_PATH),
        "--headless=new",
        f"--remote-debugging-port={PORT}",
        f"--user-data-dir={PROFILE_DIR}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-gpu",
        "--disable-background-networking",
        "--disable-sync",
        "about:blank",
    ]
    return subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def sanitized_eval_result(response: dict[str, Any]) -> Any:
    result = response.get("result", {}).get("result", {})
    if "value" in result:
        return result["value"]
    if "description" in result:
        return {"description_length": len(result.get("description") or "")}
    if "error" in response:
        err = response.get("error") or {}
        return {"cdp_error_code": err.get("code"), "cdp_error_message_length": len(err.get("message") or "")}
    return {}


def evaluate(ws: CDPWebSocket, expression: str, timeout: float = 30) -> Any:
    response = ws.call(
        "Runtime.evaluate",
        {
            "expression": expression,
            "awaitPromise": True,
            "returnByValue": True,
            "timeout": int(timeout * 1000),
        },
        timeout=timeout + 5,
    )
    return sanitized_eval_result(response)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    cookies = extract_cookies(LOG_PATHS)
    proc = None
    ws = None
    output: dict[str, Any] = {
        "ok": False,
        "cookie_count": len(cookies),
        "chrome_found": CHROME_PATH.exists(),
    }
    try:
        proc = launch_chrome()
        ws_url = wait_for_debugger(PORT)
        ws = CDPWebSocket(ws_url)
        ws.call("Page.enable")
        ws.call("Runtime.enable")
        ws.call("Network.enable")
        ws.call(
            "Network.setUserAgentOverride",
            {
                "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/108 Safari/537.36 AlibabaSupplier/11.39.80E",
                "acceptLanguage": "zh-CN,zh;q=0.9,en;q=0.8",
                "platform": "Windows",
            },
        )
        cookie_params = []
        for name, value in cookies.items():
            cookie_params.append(
                {
                    "url": "https://onetalk.alibaba.com/",
                    "name": name,
                    "value": value,
                    "path": "/",
                    "secure": True,
                    "expires": int(time.time()) + 3600,
                }
            )
            cookie_params.append(
                {
                    "url": "https://onetalk.alibaba.com/",
                    "name": name,
                    "value": value,
                    "domain": ".alibaba.com",
                    "path": "/",
                    "secure": True,
                    "expires": int(time.time()) + 3600,
                }
            )
        set_cookie_response = ws.call("Network.setCookies", {"cookies": cookie_params})
        all_cookies_response = ws.call("Network.getAllCookies")
        accepted_cookie_names = {
            item.get("name")
            for item in all_cookies_response.get("result", {}).get("cookies", [])
            if "alibaba.com" in (item.get("domain") or "")
        }
        ws.call("Page.navigate", {"url": "https://onetalk.alibaba.com/message/weblitePWA.htm"})
        load_deadline = time.time() + 45
        while time.time() < load_deadline:
            state = evaluate(
                ws,
                """(() => ({
                  readyState: document.readyState,
                  title: document.title,
                  hasIcbuIM: !!window.IcbuIM,
                  hasBaaS: !!(window.IcbuIM && window.IcbuIM.IMBaaSSDK),
                  convCacheCount: Array.isArray(window.__VMFsConv__cache__) ? window.__VMFsConv__cache__.length : null
                }))()""",
                timeout=5,
            )
            if isinstance(state, dict) and state.get("readyState") == "complete" and state.get("hasBaaS"):
                break
            time.sleep(1)
        time.sleep(6)
        page_state = evaluate(
            ws,
            """(() => {
              const sdk = window.IcbuIM && window.IcbuIM.IMBaaSSDK && window.IcbuIM.IMBaaSSDK.default;
              const scripts = Array.from(document.scripts).map(s => s.src).filter(Boolean);
              const resources = performance.getEntriesByType("resource").filter(r => /im-sdk|air|messenger|weblite|alicdn/.test(r.name)).map(r => ({
                nameHint: r.name.replace(/^https?:\\/\\//, "").split("?")[0].split("/").slice(-4).join("/"),
                initiatorType: r.initiatorType,
                transferSize: r.transferSize || 0,
                decodedBodySize: r.decodedBodySize || 0,
                durationRounded: Math.round(r.duration || 0)
              })).slice(0, 40);
              return {
                title: document.title,
                path: location.pathname,
                looksLikeLogin: /login|newlogin/i.test(location.href + document.body.innerText.slice(0, 500)),
                hasIcbuIM: !!window.IcbuIM,
                hasBaaS: !!sdk,
                hasConversationServiceV2: !!(sdk && sdk.getConversationServiceV2),
                hasMessageServiceV2: !!(sdk && sdk.getMessageServiceV2),
                authIsLogin: !!(sdk && sdk.getAuthService && sdk.getAuthService().isLogin && sdk.getAuthService().isLogin()),
                convCacheCount: Array.isArray(window.__VMFsConv__cache__) ? window.__VMFsConv__cache__.length : null,
                dbConvCacheCount: Array.isArray(window.__DBFsConv__cache__) ? window.__DBFsConv__cache__.length : null,
                fullConversationGlobal: !!window.__conversationListData__,
                fullConversationGlobalCount: window.__conversationListData__ ? Object.keys(window.__conversationListData__).length : 0,
                scriptCount: scripts.length,
                scriptHints: scripts.map(s => s.replace(/^https?:\\/\\//, "").split("?")[0].split("/").slice(-4).join("/")).slice(0, 30),
                resourceSummary: resources
              };
            })()""",
            timeout=10,
        )
        conversation_service = evaluate(
            ws,
            """(async () => {
              const timeout = (ms) => new Promise((resolve) => setTimeout(() => resolve({__timeout: true}), ms));
              const sdk = window.IcbuIM && window.IcbuIM.IMBaaSSDK && window.IcbuIM.IMBaaSSDK.default;
              const out = { hasSdk: !!sdk, attempts: [] };
              if (!sdk || !sdk.getConversationServiceV2) return out;
              const svc = sdk.getConversationServiceV2();
              const summarize = (value) => {
                if (!value || value.__timeout) return { timeout: !!(value && value.__timeout) };
                const list = Array.isArray(value) ? value : (Array.isArray(value.list) ? value.list : (value.data && Array.isArray(value.data.list) ? value.data.list : []));
                const first = list[0] || {};
                const latest = first.latestMessage || first.lastMessageInfo || {};
                return {
                  returnedType: Array.isArray(value) ? "array" : typeof value,
                  topKeys: value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).slice(0, 60).sort() : [],
                  listCount: list.length,
                  firstKeys: Object.keys(first).slice(0, 80).sort(),
                  firstHasLatestMessage: !!(latest && Object.keys(latest).length),
                  firstLatestKeys: Object.keys(latest || {}).slice(0, 80).sort(),
                  firstLatestHasContent: typeof latest.content === "string" && latest.content.length > 0,
                  firstLatestContentLength: typeof latest.content === "string" ? latest.content.length : 0
                };
              };
              for (const [label, promiseFactory] of [
                ["getConversationList", () => svc.getConversationList(20, 0)],
                ["getConversationListByPagination", () => svc.getConversationListByPagination({ pageSize: 20 })],
                ["getUnreadConversationList", () => svc.getUnreadConversationList(20, 0)]
              ]) {
                try {
                  const value = await Promise.race([promiseFactory(), timeout(12000)]);
                  out.attempts.push({ label, ok: !(value && value.__timeout), summary: summarize(value) });
                } catch (e) {
                  out.attempts.push({
                    label,
                    ok: false,
                    errorName: String(e && e.name || ""),
                    errorCode: String(e && (e.code || e.retCode || e.errorCode) || ""),
                    errorMessageLength: String(e && (e.message || e) || "").length
                  });
                }
              }
              return out;
            })()""",
            timeout=45,
        )
        output.update(
            {
                "ok": True,
                "cookie_injection": {
                    "requested_count": len(cookie_params),
                    "accepted_name_count": len(accepted_cookie_names),
                    "has_cdp_error": "error" in set_cookie_response,
                    "cdp_error_code": (set_cookie_response.get("error") or {}).get("code"),
                    "cdp_error_message_length": len((set_cookie_response.get("error") or {}).get("message") or ""),
                },
                "page_state": page_state,
                "conversation_service": conversation_service,
            }
        )
    except Exception as exc:
        output.update({"ok": False, "error_type": type(exc).__name__, "error_message_length": len(str(exc))})
    finally:
        if ws:
            ws.close()
        if proc:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        try:
            if PROFILE_DIR.exists() and str(PROFILE_DIR).startswith(str(Path.cwd())):
                shutil.rmtree(PROFILE_DIR, ignore_errors=True)
        except Exception:
            pass
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0 if output.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
