import json
import re
import time
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any

from probe_alicrm_with_log_cookies import extract_cookies, get_ctoken


LOG_PATHS = [
    Path(r"D:\AlibabaSupplierData\app.log"),
    Path(r"C:\Users\wait9yan\AppData\Local\AliWorkbenchTemp\cef.log"),
]


def add_csrf(params: dict[str, Any], cookies: dict[str, str]) -> dict[str, Any]:
    merged = dict(params)
    ctoken = get_ctoken(cookies)
    tb_token = cookies.get("_tb_token_", "")
    if ctoken:
        merged["ctoken"] = ctoken
    if tb_token:
        merged["_tb_token_"] = tb_token
    return merged


def fetch_get(host: str, path: str, params: dict[str, Any], cookies: dict[str, str]) -> dict[str, Any]:
    query = urllib.parse.urlencode(add_csrf(params, cookies))
    url = f"https://{host}{path}?{query}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/108 Safari/537.36 AlibabaSupplier/11.39.80E",
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": "https://onetalk.alibaba.com/message/alicrm.htm",
        "X-Requested-With": "XMLHttpRequest",
        "Cookie": "; ".join(f"{k}={v}" for k, v in cookies.items()),
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        resp_ctx = urllib.request.urlopen(req, timeout=10)
    except urllib.error.HTTPError as exc:
        resp_ctx = exc
    with resp_ctx as resp:
        raw = resp.read(1_500_000)
        text = raw.decode("utf-8", "ignore")
        parsed = None
        try:
            parsed = json.loads(text)
        except Exception:
            pass
        title_match = re.search(r"<title[^>]*>(.*?)</title>", text, re.I | re.S)
        return {
            "host": host,
            "path": path,
            "status": resp.status,
            "final_host": urllib.parse.urlsplit(resp.geturl()).netloc,
            "content_type": resp.headers.get("Content-Type"),
            "content_length": len(raw),
            "looks_like_login": "login.alibaba.com" in resp.geturl() or "newlogin" in text[:5000].lower(),
            "html_title": re.sub(r"\s+", " ", title_match.group(1)).strip() if title_match else "",
            "json": parsed,
        }


def list_values(obj: Any, names: tuple[str, ...]) -> list[Any]:
    if not isinstance(obj, dict):
        return []
    root = obj.get("data") if isinstance(obj.get("data"), dict) else obj
    for name in names:
        value = root.get(name) if isinstance(root, dict) else None
        if isinstance(value, list):
            return value
    return []


def summarize_json(obj: Any) -> dict[str, Any]:
    if not isinstance(obj, dict):
        return {"json_type": type(obj).__name__}
    root = obj.get("data") if isinstance(obj.get("data"), dict) else obj
    list_lengths = {}
    if isinstance(root, dict):
        for key, value in root.items():
            if isinstance(value, list):
                list_lengths[key] = len(value)
    return {
        "json_keys": sorted(obj.keys())[:60],
        "code": obj.get("code") or obj.get("retCode"),
        "success": obj.get("success") if isinstance(obj.get("success"), bool) else None,
        "data_keys": sorted(root.keys())[:80] if isinstance(root, dict) else [],
        "list_lengths": list_lengths,
    }


def candidate_conversation_ids(conversation: dict[str, Any]) -> list[tuple[str, str]]:
    ids: list[tuple[str, str]] = []
    for key in ("conversationId", "conversationCode", "cid", "id"):
        value = conversation.get(key)
        if isinstance(value, (str, int)) and str(value):
            ids.append((key, str(value)))
    latest = conversation.get("latestMessage")
    if isinstance(latest, dict):
        for key in ("conversationId", "conversationCode", "cid"):
            value = latest.get(key)
            if isinstance(value, (str, int)) and str(value):
                ids.append((f"latestMessage.{key}", str(value)))
    expanded: list[tuple[str, str]] = []
    seen = set()
    for label, value in ids:
        variants = [value]
        if "#" in value:
            variants.append(value.split("#", 1)[0])
        for variant in variants:
            if variant not in seen:
                seen.add(variant)
                expanded.append((label, variant))
    return expanded


def summarize_message_probe(result: dict[str, Any], label: str, params: dict[str, Any]) -> dict[str, Any]:
    parsed = result["json"]
    messages = list_values(parsed, ("messageList", "dataList", "list"))
    first = messages[0] if messages and isinstance(messages[0], dict) else {}
    content_keys = [key for key in ("content", "summary", "originalData", "message", "text") if key in first]
    return {
        "label": label,
        "host": result["host"],
        "path": result["path"],
        "status": result["status"],
        "content_type": result["content_type"],
        "looks_like_login": result["looks_like_login"],
        "html_title": result.get("html_title", ""),
        "request_param_keys": sorted(k for k in params.keys()),
        "summary": summarize_json(parsed),
        "message_count": len(messages),
        "first_message_keys": sorted(first.keys())[:80],
        "first_message_has_content_like_fields": sorted(content_keys),
    }


def main() -> int:
    cookies = extract_cookies(LOG_PATHS)
    now_ms = int(time.time() * 1000)
    two_years_ago_ms = now_ms - 730 * 24 * 60 * 60 * 1000

    conv_results = []
    seed_conversations = []
    seed_host = ""
    for host in ("onetalk.alibaba.com", "message.alibaba.com"):
        for label, path, params in (
            ("recent-conversations", "/message/listRecentConversation.htm", {"count": 20, "pointTimeStamp": two_years_ago_ms}),
            ("paged-conversations", "/message/pageListRecentConversation.htm", {"count": 20, "limitTimeStamp": now_ms}),
        ):
            response = fetch_get(host, path, params, cookies)
            parsed = response["json"]
            conversations = list_values(parsed, ("conversationList", "dataList", "list"))
            first = conversations[0] if conversations and isinstance(conversations[0], dict) else {}
            conv_results.append({
                "label": label,
                "host": host,
                "path": path,
                "status": response["status"],
                "content_type": response["content_type"],
                "looks_like_login": response["looks_like_login"],
                "html_title": response.get("html_title", ""),
                "summary": summarize_json(parsed),
                "conversation_count": len(conversations),
                "first_conversation_keys": sorted(first.keys())[:80],
                "first_latest_message_keys": sorted(first.get("latestMessage", {}).keys())[:80] if isinstance(first.get("latestMessage"), dict) else [],
            })
            if conversations:
                seed_conversations = [item for item in conversations[:3] if isinstance(item, dict)]
                seed_host = host
                break
        if seed_conversations:
            break

    message_results = []
    for index, conversation in enumerate(seed_conversations):
        for id_label, conversation_id in candidate_conversation_ids(conversation)[:3]:
            for direction_label, point, forward in (
                ("older-from-now", now_ms, "false"),
                ("newer-from-zero", 0, "true"),
            ):
                params = {
                    "pointTimeStamp": point,
                    "forward": forward,
                    "count": 5,
                    "conversationId": conversation_id,
                }
                response = fetch_get(seed_host, "/message/listRecentMessage.htm", params, cookies)
                message_results.append(summarize_message_probe(
                    response,
                    f"conversation-{index + 1}:{id_label}:{direction_label}",
                    params,
                ))
                if message_results[-1]["message_count"] > 0:
                    break
            if message_results and message_results[-1]["message_count"] > 0:
                break
        if message_results and message_results[-1]["message_count"] > 0:
            break

    output = {
        "cookie_count": len(cookies),
        "has_ctoken": bool(get_ctoken(cookies)),
        "has_tb_token": bool(cookies.get("_tb_token_")),
        "conversation_results": conv_results,
        "message_results": message_results,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
