import argparse
import hashlib
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from probe_alicrm_with_log_cookies import extract_cookies, get_ctoken
from probe_get_chat_message_list import LOG_PATHS, fetch_weblite, page_bootstrap, request_chat_list
from probe_weblite_pwa_data import extract_json_after


SENSITIVE_KEY_PARTS = ("token", "cookie", "password", "secret", "session")
SENSITIVE_STRING_PATTERNS = (
    re.compile(r"(?i)(chatToken|ctoken|_tb_token_|cookie2|sgcookie|tfstk|xman_[a-z_]+|xman)\s*=\s*([^&\s\"'<>]+)"),
    re.compile(r"(?i)(\"(?:chatToken|ctoken|_tb_token_|cookie2|sgcookie|tfstk|xman_[a-z_]+|xman)\"\s*:\s*\")([^\"]+)"),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export messages for conversations embedded in onetalk weblitePWA cache."
    )
    parser.add_argument(
        "--output",
        default="",
        help="Output file. Defaults to exports/weblite_cached_messages_<timestamp>.json.",
    )
    parser.add_argument("--format", choices=("json", "jsonl"), default="json")
    parser.add_argument("--max-conversations", type=int, default=0, help="0 means all cached conversations.")
    parser.add_argument("--max-pages", type=int, default=20)
    parser.add_argument("--page-size", type=int, default=50)
    parser.add_argument(
        "--redact-ids",
        action="store_true",
        help="Hash account/conversation IDs in exported metadata. Message content is still exported.",
    )
    return parser.parse_args()


def utc_iso_from_ms(value: Any) -> str | None:
    if not isinstance(value, int):
        return None
    return datetime.fromtimestamp(value / 1000, tz=timezone.utc).isoformat()


def short_hash(value: Any) -> str:
    text = str(value)
    return hashlib.sha256(text.encode("utf-8", "ignore")).hexdigest()[:16]


def sanitize_value(value: Any, redact_ids: bool) -> Any:
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for key, child in value.items():
            lower = key.lower()
            if any(part in lower for part in SENSITIVE_KEY_PARTS):
                continue
            if redact_ids and (lower.endswith("id") or lower.endswith("ids") or "account" in lower or "aliid" in lower):
                if isinstance(child, (str, int)) and str(child):
                    sanitized[key] = {"sha256_16": short_hash(child)}
                else:
                    sanitized[key] = sanitize_value(child, redact_ids)
                continue
            sanitized[key] = sanitize_value(child, redact_ids)
        return sanitized
    if isinstance(value, list):
        return [sanitize_value(item, redact_ids) for item in value]
    if isinstance(value, str):
        sanitized = value
        sanitized = SENSITIVE_STRING_PATTERNS[0].sub(lambda match: f"{match.group(1)}=<redacted>", sanitized)
        sanitized = SENSITIVE_STRING_PATTERNS[1].sub(lambda match: f"{match.group(1)}<redacted>", sanitized)
        return sanitized
    return value


def conversation_key(conv: dict[str, Any]) -> str:
    for key in ("cid", "contactAccountId", "contactAliId", "encryptContactAccountId"):
        value = conv.get(key)
        if value:
            return str(value)
    return hashlib.sha1(json.dumps(conv, ensure_ascii=False, sort_keys=True).encode("utf-8", "ignore")).hexdigest()


def message_key(message: dict[str, Any]) -> str:
    for key in ("messageId", "uuid", "requestMessageId"):
        value = message.get(key)
        if value:
            return f"{key}:{value}"
    material = {
        "sendTime": message.get("sendTime"),
        "messageType": message.get("messageType"),
        "subType": message.get("subType"),
        "content": message.get("content"),
    }
    return "hash:" + hashlib.sha1(
        json.dumps(material, ensure_ascii=False, sort_keys=True).encode("utf-8", "ignore")
    ).hexdigest()


def extract_message_list(response: dict[str, Any]) -> list[dict[str, Any]]:
    parsed = response.get("json")
    if not isinstance(parsed, dict):
        return []
    data = parsed.get("data")
    if isinstance(data, dict) and isinstance(data.get("list"), list):
        return [item for item in data["list"] if isinstance(item, dict)]
    return []


def build_payload(conv: dict[str, Any], bootstrap: dict[str, str], timestamp: int | None, page_size: int) -> dict[str, Any]:
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
            "pageSize": page_size,
        },
    }


def is_probeable_conversation(item: Any) -> bool:
    return (
        isinstance(item, dict)
        and bool(item.get("contactAccountId"))
        and bool(item.get("encryptContactAccountId") or item.get("contactAccountIdEncrypt"))
        and bool(item.get("contactAliId"))
        and bool(item.get("encryptContactAliId") or item.get("aliIdEncrypt"))
    )


def export_conversation(
    cookies: dict[str, str],
    bootstrap: dict[str, str],
    conv: dict[str, Any],
    index: int,
    max_pages: int,
    page_size: int,
    redact_ids: bool,
) -> dict[str, Any]:
    timestamp: int | None = int(time.time() * 1000)
    seen_oldest: set[int] = set()
    by_key: dict[str, dict[str, Any]] = {}
    pages = []
    errors = []

    for page_index in range(max_pages):
        payload = build_payload(conv, bootstrap, timestamp, page_size)
        response = request_chat_list(cookies, payload, "POST")
        parsed = response.get("json")
        code = parsed.get("code") if isinstance(parsed, dict) else None
        messages = extract_message_list(response)
        pages.append(
            {
                "page": page_index + 1,
                "status": response.get("status"),
                "code": code,
                "message_count": len(messages),
                "content_type": response.get("content_type"),
            }
        )
        if response.get("looks_like_login"):
            errors.append({"page": page_index + 1, "kind": "login_redirect"})
            break
        if code not in (None, "200", 200):
            errors.append({"page": page_index + 1, "kind": "api_code", "code": str(code)})
            break
        if not messages:
            break

        for message in messages:
            by_key[message_key(message)] = sanitize_value(message, redact_ids)

        send_times = [item.get("sendTime") for item in messages if isinstance(item.get("sendTime"), int)]
        if not send_times:
            break
        oldest = min(send_times)
        if oldest in seen_oldest:
            break
        seen_oldest.add(oldest)
        timestamp = oldest - 1

    messages = sorted(by_key.values(), key=lambda item: item.get("sendTime") if isinstance(item.get("sendTime"), int) else 0)
    for message in messages:
        if isinstance(message, dict):
            iso_time = utc_iso_from_ms(message.get("sendTime"))
            if iso_time:
                message["sendTimeUtc"] = iso_time

    latest = conv.get("latestMessage") if isinstance(conv.get("latestMessage"), dict) else {}
    return {
        "index": index,
        "conversationKeySha256_16": short_hash(conversation_key(conv)),
        "conversation": sanitize_value(conv, redact_ids),
        "latestMessageFromCache": sanitize_value(latest, redact_ids) if latest else None,
        "messageCount": len(messages),
        "messages": messages,
        "pages": pages,
        "errors": errors,
    }


def default_output_path(fmt: str) -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    suffix = "jsonl" if fmt == "jsonl" else "json"
    return Path("exports") / f"weblite_cached_messages_{stamp}.{suffix}"


def write_jsonl(path: Path, document: dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        metadata = {key: value for key, value in document.items() if key != "conversations"}
        handle.write(json.dumps({"type": "metadata", **metadata}, ensure_ascii=False) + "\n")
        for conversation in document["conversations"]:
            header = {key: value for key, value in conversation.items() if key != "messages"}
            handle.write(json.dumps({"type": "conversation", **header}, ensure_ascii=False) + "\n")
            for message in conversation["messages"]:
                handle.write(
                    json.dumps(
                        {
                            "type": "message",
                            "conversationIndex": conversation["index"],
                            "conversationKeySha256_16": conversation["conversationKeySha256_16"],
                            "message": message,
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    args = parse_args()
    if args.max_pages < 1:
        raise SystemExit("--max-pages must be >= 1")
    if args.page_size < 1:
        raise SystemExit("--page-size must be >= 1")

    cookies = extract_cookies(LOG_PATHS)
    text = fetch_weblite(cookies)
    conv_cache = extract_json_after(text, "window.__VMFsConv__cache__")
    bootstrap = page_bootstrap(text)
    if not isinstance(conv_cache, list):
        conv_cache = []
    conversations = [item for item in conv_cache if is_probeable_conversation(item)]
    if args.max_conversations > 0:
        conversations = conversations[: args.max_conversations]

    exported = [
        export_conversation(cookies, bootstrap, conv, index, args.max_pages, args.page_size, args.redact_ids)
        for index, conv in enumerate(conversations, start=1)
    ]
    document = {
        "schema": "weblite_cached_messages.v1",
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "source": {
            "page": "https://onetalk.alibaba.com/message/weblitePWA.htm",
            "messageEndpoint": "https://onetalk.alibaba.com/message/getChatMessageList.htm",
            "conversationScope": "window.__VMFsConv__cache__ only",
        },
        "options": {
            "format": args.format,
            "maxPages": args.max_pages,
            "pageSize": args.page_size,
            "redactIds": bool(args.redact_ids),
        },
        "bootstrap": sanitize_value(bootstrap, args.redact_ids),
        "conversationCacheCount": len(conv_cache),
        "probeableConversationCount": len(conversations),
        "conversations": exported,
    }

    output_path = Path(args.output) if args.output else default_output_path(args.format)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if args.format == "jsonl":
        write_jsonl(output_path, document)
    else:
        output_path.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")

    summary = {
        "ok": True,
        "output": str(output_path.resolve()),
        "format": args.format,
        "conversation_cache_count": len(conv_cache),
        "exported_conversation_count": len(exported),
        "exported_message_count": sum(item["messageCount"] for item in exported),
        "conversation_message_counts": [item["messageCount"] for item in exported],
        "conversation_error_count": sum(1 for item in exported if item["errors"]),
        "has_ctoken": bool(get_ctoken(cookies)),
        "has_tb_token": bool(cookies.get("_tb_token_")),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
