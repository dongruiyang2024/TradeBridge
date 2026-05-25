import json
import sys
import time
from pathlib import Path
from typing import Any

from probe_alicrm_with_log_cookies import extract_cookies, get_ctoken
from probe_get_chat_message_list import (
    LOG_PATHS,
    fetch_weblite,
    page_bootstrap,
    request_chat_list,
    summarize_response,
)
from probe_weblite_pwa_data import extract_json_after


def build_payload(conv: dict[str, Any], bootstrap: dict[str, str], timestamp: int | None) -> dict[str, Any]:
    return {
        "contactAccountId": conv.get("contactAccountId"),
        "contactAccountIdEncrypt": conv.get("encryptContactAccountId") or conv.get("contactAccountIdEncrypt"),
        "aliId": conv.get("contactAliId"),
        "aliIdEncrypt": conv.get("encryptContactAliId") or conv.get("aliIdEncrypt"),
        "cid": conv.get("cid"),
        "conversationCode": conv.get("cid"),
        "chatToken": conv.get("chatToken"),
        "selfAliId": conv.get("selfAliId") or bootstrap.get("aliId"),
        "timeSlide": {
            "forward": False,
            "timeStamp": timestamp,
            "pageSize": 20,
        },
    }


def extract_message_list(response: dict[str, Any]) -> list[dict[str, Any]]:
    parsed = response.get("json")
    if not isinstance(parsed, dict):
        return []
    data = parsed.get("data")
    if isinstance(data, dict) and isinstance(data.get("list"), list):
        return [item for item in data["list"] if isinstance(item, dict)]
    return []


def page_summary(response: dict[str, Any], messages: list[dict[str, Any]]) -> dict[str, Any]:
    summary = summarize_response(response)
    first = messages[0] if messages else {}
    content_lengths = [len(item.get("content", "")) for item in messages if isinstance(item.get("content"), str)]
    send_times = [item.get("sendTime") for item in messages if isinstance(item.get("sendTime"), int)]
    return {
        "status": summary["status"],
        "content_type": summary["content_type"],
        "code": summary["code"],
        "looks_like_login": summary["looks_like_login"],
        "message_count": len(messages),
        "first_keys": sorted(first.keys())[:80],
        "content_message_count": len(content_lengths),
        "min_content_length": min(content_lengths) if content_lengths else 0,
        "max_content_length": max(content_lengths) if content_lengths else 0,
        "has_send_times": bool(send_times),
        "oldest_send_time_present": bool(send_times),
    }


def probe_conversation(cookies: dict[str, str], bootstrap: dict[str, str], conv: dict[str, Any]) -> dict[str, Any]:
    timestamp: int | None = int(time.time() * 1000)
    pages = []
    seen_oldest: set[int] = set()
    for _ in range(3):
        payload = build_payload(conv, bootstrap, timestamp)
        response = request_chat_list(cookies, payload, "POST")
        messages = extract_message_list(response)
        pages.append(page_summary(response, messages))
        send_times = [item.get("sendTime") for item in messages if isinstance(item.get("sendTime"), int)]
        if not send_times:
            break
        oldest = min(send_times)
        if oldest in seen_oldest:
            break
        seen_oldest.add(oldest)
        timestamp = oldest - 1
        if not messages:
            break
    return {
        "conversation_shape": {
            "has_contact_account_id": bool(conv.get("contactAccountId")),
            "has_contact_account_id_encrypt": bool(conv.get("encryptContactAccountId") or conv.get("contactAccountIdEncrypt")),
            "has_ali_id": bool(conv.get("contactAliId")),
            "has_ali_id_encrypt": bool(conv.get("encryptContactAliId") or conv.get("aliIdEncrypt")),
            "has_cid": bool(conv.get("cid")),
            "has_chat_token": bool(conv.get("chatToken")),
            "has_latest_message": isinstance(conv.get("latestMessage"), dict),
        },
        "pages": pages,
        "total_messages_seen": sum(page["message_count"] for page in pages),
    }


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    cookies = extract_cookies(LOG_PATHS)
    text = fetch_weblite(cookies)
    bootstrap = page_bootstrap(text)
    conv_cache = extract_json_after(text, "window.__VMFsConv__cache__")
    if not isinstance(conv_cache, list):
        conv_cache = []
    conversations = [
        item
        for item in conv_cache
        if isinstance(item, dict)
        and item.get("contactAccountId")
        and (item.get("encryptContactAccountId") or item.get("contactAccountIdEncrypt"))
        and item.get("contactAliId")
        and (item.get("encryptContactAliId") or item.get("aliIdEncrypt"))
    ]
    results = []
    for index, conv in enumerate(conversations[:5], start=1):
        probed = probe_conversation(cookies, bootstrap, conv)
        probed["conversation_index"] = index
        results.append(probed)
    print(
        json.dumps(
            {
                "ok": True,
                "cookie_count": len(cookies),
                "has_ctoken": bool(get_ctoken(cookies)),
                "has_tb_token": bool(cookies.get("_tb_token_")),
                "conversation_cache_count": len(conv_cache),
                "probeable_conversation_count": len(conversations),
                "probed_conversation_count": len(results),
                "results": results,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
