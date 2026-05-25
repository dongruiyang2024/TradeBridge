import gzip
import html
import ast
import json
import re
import sys
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any

from probe_alicrm_with_log_cookies import extract_cookies


LOG_PATHS = [
    Path(r"D:\AlibabaSupplierData\app.log"),
    Path(r"C:\Users\wait9yan\AppData\Local\AliWorkbenchTemp\cef.log"),
]


def fetch(url: str, timeout: int = 15) -> tuple[int, str, dict[str, str], str]:
    cookies = extract_cookies(LOG_PATHS)
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/108 Safari/537.36 AlibabaSupplier/11.39.80E",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Encoding": "gzip",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Cookie": "; ".join(f"{k}={v}" for k, v in cookies.items()),
        },
    )
    try:
        resp_ctx = urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as exc:
        resp_ctx = exc
    with resp_ctx as resp:
        body = resp.read(4_000_000)
        if resp.headers.get("Content-Encoding") == "gzip":
            body = gzip.decompress(body)
        return resp.status, resp.geturl(), dict(resp.headers), body.decode("utf-8", "ignore")


def extract_json_after(text: str, marker: str) -> Any:
    idx = text.find(marker)
    if idx < 0:
        return None
    start = text.find("[", idx)
    if start < 0:
        start = text.find("{", idx)
    if start < 0:
        return None
    open_ch = text[start]
    close_ch = "]" if open_ch == "[" else "}"
    depth = 0
    in_string = False
    escape = False
    for pos in range(start, len(text)):
        ch = text[pos]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return json.loads(text[start : pos + 1])
    return None


def extract_json_parse_assignment(text: str, name: str) -> Any:
    marker = f"window.{name}"
    idx = text.find(marker)
    if idx < 0:
        return None
    parse_idx = text.find("JSON.parse", idx)
    if parse_idx < 0:
        return None
    quote_idx = text.find("'", parse_idx)
    if quote_idx < 0:
        return None
    chars = []
    escape = False
    for pos in range(quote_idx + 1, len(text)):
        ch = text[pos]
        if escape:
            chars.append("\\" + ch)
            escape = False
            continue
        if ch == "\\":
            escape = True
            continue
        if ch == "'":
            break
        chars.append(ch)
    else:
        return None
    raw = "".join(chars)
    try:
        literal = ast.literal_eval("'" + raw + "'")
    except Exception:
        literal = raw.encode("utf-8").decode("unicode_escape", "ignore")
    try:
        return json.loads(literal)
    except Exception:
        return None


def script_urls(text: str, final_url: str) -> list[str]:
    seen = set()
    urls = []
    for src in re.findall(r"<script[^>]+src=[\"']([^\"']+)", text, re.I):
        absolute = urllib.parse.urljoin(final_url, src)
        parsed = urllib.parse.urlsplit(absolute)
        clean = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
        if clean not in seen:
            seen.add(clean)
            urls.append(clean)
    return urls


def summarize_micro_config(config: Any) -> dict[str, Any]:
    if not isinstance(config, list):
        return {"found": False, "app_count": 0, "apps": []}
    apps = []
    for item in config:
        if not isinstance(item, dict):
            continue
        urls = item.get("url") or item.get("appResource") or []
        if isinstance(urls, str):
            urls = [urls]
        script_count = len([u for u in urls if isinstance(u, str) and u.endswith(".js")])
        css_count = len([u for u in urls if isinstance(u, str) and u.endswith(".css")])
        apps.append({
            "basename": item.get("basename"),
            "path": item.get("path"),
            "title": item.get("title"),
            "version": item.get("version"),
            "micro_type": item.get("microType"),
            "script_count": script_count,
            "css_count": css_count,
            "resource_paths": [
                urllib.parse.urlsplit(urllib.parse.urljoin("https://onetalk.alibaba.com/", u)).path
                for u in urls
                if isinstance(u, str)
            ][:8],
        })
    return {"found": True, "app_count": len(apps), "apps": apps}


def summarize_conversation(item: dict[str, Any]) -> dict[str, Any]:
    latest = item.get("latestMessage")
    if not isinstance(latest, dict):
        latest = {}
    return {
        "conversation_keys": sorted(item.keys())[:80],
        "has_chat_token": bool(item.get("chatToken")),
        "has_latest_message": bool(latest),
        "latest_message_keys": sorted(latest.keys())[:80],
        "latest_message_has_content": isinstance(latest.get("content"), str) and latest.get("content") != "",
        "latest_message_content_length": len(latest.get("content", "")) if isinstance(latest.get("content"), str) else 0,
        "latest_message_type": latest.get("messageType"),
        "latest_message_send_type": latest.get("messageSendType"),
        "latest_message_has_sender": "senderAliId" in latest,
        "latest_message_has_id": "messageId" in latest,
    }


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    url = "https://onetalk.alibaba.com/message/weblitePWA.htm"
    status, final_url, headers, text = fetch(url)
    title_match = re.search(r"<title[^>]*>(.*?)</title>", text, re.I | re.S)
    title = html.unescape(re.sub(r"\s+", " ", title_match.group(1)).strip()) if title_match else ""
    conv_cache = extract_json_after(text, "window.__VMFsConv__cache__")
    micro_config = extract_json_parse_assignment(text, "messengerMicroConfig")
    if not isinstance(conv_cache, list):
        conv_cache = []
    first = conv_cache[0] if conv_cache and isinstance(conv_cache[0], dict) else {}
    latest_count = sum(1 for item in conv_cache if isinstance(item, dict) and isinstance(item.get("latestMessage"), dict))
    output = {
        "ok": status == 200 and "login.alibaba.com" not in final_url and "newlogin" not in text[:5000].lower(),
        "status": status,
        "final_host": urllib.parse.urlsplit(final_url).netloc,
        "final_path": urllib.parse.urlsplit(final_url).path,
        "content_type": headers.get("Content-Type"),
        "content_length": len(text),
        "title": title,
        "script_urls": script_urls(text, final_url),
        "micro_config": summarize_micro_config(micro_config),
        "has_vmfs_conversation_cache": bool(conv_cache),
        "conversation_cache_count": len(conv_cache),
        "conversation_with_latest_message_count": latest_count,
        "first_conversation_summary": summarize_conversation(first) if first else {},
        "has_full_conversation_globals": {
            "__conversationListData__": "__conversationListData__" in text,
            "__conversationListFullData__": "__conversationListFullData__" in text,
            "__sortConversation__": "__sortConversation__" in text,
        },
        "has_page_bootstrap_fields": {
            "aliId": "window.aliId" in text,
            "currentUserAccountId": "window.currentUserAccountId" in text,
            "currentUserAccountIdEncry": "window.currentUserAccountIdEncry" in text,
        },
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
