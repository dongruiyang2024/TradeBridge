import gzip
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from probe_alicrm_with_log_cookies import extract_cookies, get_ctoken
from probe_weblite_pwa_data import extract_json_after


LOG_PATHS = [
    Path(r"D:\AlibabaSupplierData\app.log"),
    Path(r"C:\Users\wait9yan\AppData\Local\AliWorkbenchTemp\cef.log"),
]


def cookie_header(cookies: dict[str, str]) -> str:
    return "; ".join(f"{k}={v}" for k, v in cookies.items())


def csrf_query(cookies: dict[str, str]) -> str:
    params = []
    ctoken = get_ctoken(cookies)
    tb_token = cookies.get("_tb_token_", "")
    if ctoken:
        params.append(("ctoken", ctoken))
    if tb_token:
        params.append(("_tb_token_", tb_token))
    return urllib.parse.urlencode(params)


def fetch_weblite(cookies: dict[str, str]) -> str:
    req = urllib.request.Request(
        "https://onetalk.alibaba.com/message/weblitePWA.htm",
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/108 Safari/537.36 AlibabaSupplier/11.39.80E",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Encoding": "gzip",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Cookie": cookie_header(cookies),
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        raw = resp.read(4_000_000)
        if resp.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return raw.decode("utf-8", "ignore")


def page_bootstrap(text: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for name in ("aliId", "aliIdEncrypt", "currentUserAccountId", "currentUserAccountIdEncry"):
        match = re.search(rf"window\.{re.escape(name)}\s*=\s*['\"]([^'\"]*)", text)
        if match:
            result[name] = html.unescape(match.group(1))
    return result


def request_chat_list(cookies: dict[str, str], payload: dict[str, Any], method: str) -> dict[str, Any]:
    query = csrf_query(cookies)
    endpoint = "https://onetalk.alibaba.com/message/getChatMessageList.htm"
    if query:
        endpoint += "?" + query
    body = urllib.parse.urlencode({"params": json.dumps(payload, ensure_ascii=False)}).encode("utf-8")
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/108 Safari/537.36 AlibabaSupplier/11.39.80E",
        "Accept": "application/json,text/plain,*/*",
        "Accept-Encoding": "gzip",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Origin": "https://onetalk.alibaba.com",
        "Referer": "https://onetalk.alibaba.com/message/weblitePWA.htm",
        "X-Requested-With": "XMLHttpRequest",
        "Cookie": cookie_header(cookies),
    }
    url = endpoint
    data = body
    if method == "GET":
        url = endpoint + ("&" if "?" in endpoint else "?") + body.decode("utf-8")
        data = None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        resp_ctx = urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as exc:
        resp_ctx = exc
    with resp_ctx as resp:
        raw = resp.read(1_500_000)
        if resp.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        text = raw.decode("utf-8", "ignore")
        parsed = None
        try:
            parsed = json.loads(text)
        except Exception:
            pass
        return {
            "status": resp.status,
            "final_host": urllib.parse.urlsplit(resp.geturl()).netloc,
            "content_type": resp.headers.get("Content-Type"),
            "content_length": len(raw),
            "looks_like_login": "login.alibaba.com" in resp.geturl() or "newlogin" in text[:5000].lower(),
            "json": parsed,
        }


def find_message_lists(obj: Any) -> dict[str, list[Any]]:
    found: dict[str, list[Any]] = {}

    def walk(value: Any, path: str, depth: int = 0) -> None:
        if depth > 5:
            return
        if isinstance(value, list):
            if value and isinstance(value[0], dict):
                keys = set(value[0].keys())
                if {"messageId", "content"} & keys or {"messageType", "sendTime"} <= keys:
                    found[path or "root"] = value
            return
        if isinstance(value, dict):
            for key, child in value.items():
                walk(child, f"{path}.{key}" if path else str(key), depth + 1)

    walk(obj, "")
    return found


def summarize_response(response: dict[str, Any]) -> dict[str, Any]:
    parsed = response.get("json")
    summary = {
        "status": response["status"],
        "final_host": response["final_host"],
        "content_type": response["content_type"],
        "content_length": response["content_length"],
        "looks_like_login": response["looks_like_login"],
        "json": isinstance(parsed, dict),
        "json_keys": [],
        "code": None,
        "success": None,
        "data_keys": [],
        "message_lists": {},
    }
    if not isinstance(parsed, dict):
        return summary
    data = parsed.get("data")
    summary["json_keys"] = sorted(parsed.keys())[:60]
    summary["code"] = parsed.get("code") or parsed.get("retCode")
    if isinstance(parsed.get("success"), bool):
        summary["success"] = parsed["success"]
    if isinstance(data, dict):
        summary["data_keys"] = sorted(data.keys())[:80]
    for path, items in find_message_lists(parsed).items():
        first = items[0] if items and isinstance(items[0], dict) else {}
        content = first.get("content")
        summary["message_lists"][path] = {
            "count": len(items),
            "first_keys": sorted(first.keys())[:80],
            "first_has_content": isinstance(content, str) and content != "",
            "first_content_length": len(content) if isinstance(content, str) else 0,
            "first_message_type": first.get("messageType"),
            "first_send_type": first.get("messageSendType") or first.get("messageType"),
            "first_has_id": "messageId" in first,
        }
    return summary


def build_payloads(conv: dict[str, Any], bootstrap: dict[str, str]) -> list[tuple[str, dict[str, Any]]]:
    latest = conv.get("latestMessage") if isinstance(conv.get("latestMessage"), dict) else {}
    contact_account_id = conv.get("contactAccountId")
    contact_account_id_encrypt = conv.get("encryptContactAccountId") or conv.get("contactAccountIdEncrypt")
    contact_ali_id = conv.get("contactAliId")
    contact_ali_id_encrypt = conv.get("encryptContactAliId") or conv.get("aliIdEncrypt")
    base = {
        "contactAccountId": contact_account_id,
        "contactAccountIdEncrypt": contact_account_id_encrypt,
        "aliId": contact_ali_id,
        "aliIdEncrypt": contact_ali_id_encrypt,
    }
    richer = dict(base)
    richer.update(
        {
            "cid": conv.get("cid"),
            "conversationCode": conv.get("cid"),
            "chatToken": conv.get("chatToken"),
            "selfAliId": conv.get("selfAliId") or bootstrap.get("aliId"),
        }
    )
    latest_send_time = latest.get("sendTime")
    now_ms = int(time.time() * 1000)
    return [
        (
            "initial-forward-false-null",
            {
                **base,
                "timeSlide": {"forward": False, "timeStamp": None, "pageSize": 20},
            },
        ),
        (
            "older-before-now",
            {
                **base,
                "timeSlide": {"forward": False, "timeStamp": now_ms, "pageSize": 20},
            },
        ),
        (
            "newer-after-latest",
            {
                **base,
                "timeSlide": {"forward": True, "timeStamp": latest_send_time, "pageSize": 20},
            },
        ),
        (
            "with-cid-and-chat-token",
            {
                **richer,
                "timeSlide": {"forward": False, "timeStamp": now_ms, "pageSize": 20},
            },
        ),
    ]


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    cookies = extract_cookies(LOG_PATHS)
    text = fetch_weblite(cookies)
    conv_cache = extract_json_after(text, "window.__VMFsConv__cache__")
    bootstrap = page_bootstrap(text)
    if not isinstance(conv_cache, list) or not conv_cache:
        print(json.dumps({"ok": False, "reason": "no_conversation_cache"}, ensure_ascii=False, indent=2))
        return 1
    conv = next((item for item in conv_cache if isinstance(item, dict) and item.get("latestMessage")), conv_cache[0])
    results = []
    for label, payload in build_payloads(conv, bootstrap):
        param_shape = {
            "payload_keys": sorted(payload.keys()),
            "time_slide": sorted(payload.get("timeSlide", {}).keys()) if isinstance(payload.get("timeSlide"), dict) else [],
            "has_contact_account_id": bool(payload.get("contactAccountId")),
            "has_contact_account_id_encrypt": bool(payload.get("contactAccountIdEncrypt")),
            "has_ali_id": bool(payload.get("aliId")),
            "has_ali_id_encrypt": bool(payload.get("aliIdEncrypt")),
            "has_cid": bool(payload.get("cid") or payload.get("conversationCode")),
            "has_chat_token": bool(payload.get("chatToken")),
        }
        for method in ("POST", "GET"):
            response = request_chat_list(cookies, payload, method)
            results.append(
                {
                    "label": label,
                    "method": method,
                    "param_shape": param_shape,
                    "response": summarize_response(response),
                }
            )
    output = {
        "ok": True,
        "cookie_count": len(cookies),
        "has_ctoken": bool(get_ctoken(cookies)),
        "has_tb_token": bool(cookies.get("_tb_token_")),
        "conversation_cache_count": len(conv_cache),
        "selected_conversation_shape": {
            "keys": sorted(conv.keys())[:80],
            "has_latest_message": isinstance(conv.get("latestMessage"), dict),
            "latest_message_keys": sorted(conv.get("latestMessage", {}).keys())[:80]
            if isinstance(conv.get("latestMessage"), dict)
            else [],
        },
        "bootstrap_shape": {
            "has_ali_id": bool(bootstrap.get("aliId")),
            "has_ali_id_encrypt": bool(bootstrap.get("aliIdEncrypt")),
            "has_current_account": bool(bootstrap.get("currentUserAccountId")),
            "has_current_account_encrypt": bool(bootstrap.get("currentUserAccountIdEncry")),
        },
        "results": results,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
