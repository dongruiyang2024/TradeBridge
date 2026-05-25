import gzip
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from probe_alicrm_with_log_cookies import extract_cookies, get_ctoken


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


def request_endpoint(path: str, cookies: dict[str, str], body: dict[str, str]) -> dict[str, Any]:
    query = csrf_query(cookies)
    endpoint = f"https://onetalk.alibaba.com{path}"
    if query:
        endpoint += "?" + query
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
    data = urllib.parse.urlencode(body).encode("utf-8")
    req = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")
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


def find_lists(obj: Any) -> dict[str, list[Any]]:
    found: dict[str, list[Any]] = {}

    def walk(value: Any, path: str, depth: int = 0) -> None:
        if depth > 5:
            return
        if isinstance(value, list):
            if value and isinstance(value[0], dict):
                first_keys = set(value[0].keys())
                if {"latestMessage", "contactAccountId", "accountId", "cid", "loginId"} & first_keys:
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
        "lists": {},
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
    for path, items in find_lists(parsed).items():
        first = items[0] if items and isinstance(items[0], dict) else {}
        latest = first.get("latestMessage") if isinstance(first.get("latestMessage"), dict) else {}
        summary["lists"][path] = {
            "count": len(items),
            "first_keys": sorted(first.keys())[:80],
            "first_has_latest_message": bool(latest),
            "first_latest_message_keys": sorted(latest.keys())[:80],
            "first_latest_has_content": isinstance(latest.get("content"), str) and latest.get("content") != "",
            "first_latest_content_length": len(latest.get("content", "")) if isinstance(latest.get("content"), str) else 0,
        }
    return summary


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    cookies = extract_cookies(LOG_PATHS)
    now_ms = int(time.time() * 1000)
    payloads = [
        ("empty", {}),
        ("count-only", {"count": 20}),
        ("params-count-only", {"params": json.dumps({"count": 20})}),
        ("params-pagination", {"params": json.dumps({"pagination": {"currentPage": 1, "pageSize": 20}})}),
        ("params-timestamp", {"params": json.dumps({"limitTimeStamp": now_ms, "count": 20})}),
        ("params-mode", {"params": json.dumps({"mode": "allList", "count": 20})}),
    ]
    paths = [
        "/message/getRecentContactList.htm",
        "/message/getRecentContactListExtra.htm",
    ]
    results = []
    for path in paths:
        for label, body in payloads:
            results.append(
                {
                    "path": path,
                    "label": label,
                    "body_keys": sorted(body.keys()),
                    "response": summarize_response(request_endpoint(path, cookies, body)),
                }
            )
    print(
        json.dumps(
            {
                "ok": True,
                "cookie_count": len(cookies),
                "has_ctoken": bool(get_ctoken(cookies)),
                "has_tb_token": bool(cookies.get("_tb_token_")),
                "results": results,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
