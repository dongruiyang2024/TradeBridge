import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from probe_alicrm_with_log_cookies import extract_cookies, extract_latest_alicrm_context, get_ctoken


LOG_PATHS = [
    Path(r"D:\AlibabaSupplierData\app.log"),
    Path(r"C:\Users\wait9yan\AppData\Local\AliWorkbenchTemp\cef.log"),
]


def first(params: dict[str, str], *keys: str) -> str:
    for key in keys:
        value = params.get(key)
        if value:
            return value
    return ""


def post_form(endpoint: str, body: dict[str, str], cookies: dict[str, str], timeout: int = 12) -> dict[str, Any]:
    query = {}
    ctoken = get_ctoken(cookies)
    tb_token = cookies.get("_tb_token_", "")
    if ctoken:
        query["ctoken"] = ctoken
    if tb_token:
        query["_tb_token_"] = tb_token
    url = endpoint + ("?" + urllib.parse.urlencode(query) if query else "")
    data = urllib.parse.urlencode(body).encode("utf-8")
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/108 Safari/537.36 AlibabaSupplier/11.39.80E",
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Origin": "https://onetalk.alibaba.com",
        "Referer": "https://onetalk.alibaba.com/message/alicrm.htm",
        "X-Requested-With": "XMLHttpRequest",
        "Cookie": "; ".join(f"{key}={value}" for key, value in cookies.items()),
    }
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status = resp.status
            final_url = resp.geturl()
            content_type = resp.headers.get("Content-Type")
            raw = resp.read(1_500_000)
    except urllib.error.HTTPError as exc:
        status = exc.code
        final_url = exc.geturl()
        content_type = exc.headers.get("Content-Type")
        raw = exc.read(1_500_000)
    except Exception as exc:
        return {"ok": False, "error_type": type(exc).__name__, "error_message_length": len(str(exc))}

    text = raw.decode("utf-8", "ignore")
    parsed = safe_json(text)
    return {
        "ok": True,
        "status": status,
        "final_host": urllib.parse.urlsplit(final_url).netloc,
        "content_type": content_type,
        "content_length": len(raw),
        "looks_like_login": "login.alibaba.com" in final_url or "newlogin" in text[:5000].lower(),
        "response": summarize(parsed),
    }


def safe_json(text: str) -> Any:
    try:
        return json.loads(text)
    except Exception:
        return None


def summarize(value: Any) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "json": isinstance(value, dict),
        "top_keys": [],
        "code": None,
        "success": None,
        "data_kind": None,
        "data_keys": [],
        "list_lengths": {},
        "item_keys": {},
        "field_presence": {},
    }
    if not isinstance(value, dict):
        return summary
    summary["top_keys"] = sorted(value.keys())[:80]
    summary["code"] = value.get("code") or value.get("retCode")
    if "success" in value:
        summary["success"] = bool(value.get("success"))
    data = value.get("data")
    summary["data_kind"] = type(data).__name__
    if isinstance(data, dict):
        summary["data_keys"] = sorted(data.keys())[:120]
        for key, item in data.items():
            if isinstance(item, list):
                summary["list_lengths"][key] = len(item)
                if item and isinstance(item[0], dict):
                    summary["item_keys"][key] = sorted(item[0].keys())[:120]
            elif isinstance(item, dict):
                summary["item_keys"][key] = sorted(item.keys())[:120]
        summary["field_presence"] = presence_scan(data)
    elif isinstance(data, list):
        summary["list_lengths"]["data"] = len(data)
        if data and isinstance(data[0], dict):
            summary["item_keys"]["data"] = sorted(data[0].keys())[:120]
            summary["field_presence"] = presence_scan(data[0])
    return summary


def presence_scan(value: Any) -> dict[str, bool]:
    text = json.dumps(value, ensure_ascii=False)
    keys = [
        "companyName",
        "contactInformation",
        "companyWebsite",
        "sourcingReqirements",
        "notes",
        "extInfo1",
        "targetLoginId",
        "tagTypeList",
    ]
    return {key: bool(re.search(rf'"{re.escape(key)}"\s*:', text)) for key in keys}


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    cookies = extract_cookies(LOG_PATHS)
    context = extract_latest_alicrm_context(LOG_PATHS)
    params = context.get("params") or {}
    buyer_login_id = first(params, "buyerLoginId", "chatLoginId", "contactLoginId")
    body = {
        "params": json.dumps(
            {
                "targetLoginId": buyer_login_id,
                "tagObjType": 1,
                "tagTypeList": [11],
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
    }
    endpoints = [
        "https://onetalk.alibaba.com/message/getTargetTagList.htm",
        "https://alicrm.alibaba.com/message/getTargetTagList.htm",
    ]
    output = {
        "cookie_count": len(cookies),
        "has_ctoken": bool(get_ctoken(cookies)),
        "context": {
            "found_url": bool(context.get("found_url")),
            "has_buyer_login_id": bool(buyer_login_id),
            "param_keys": sorted(params.keys()),
        },
        "request_param_keys": ["targetLoginId", "tagObjType", "tagTypeList"],
        "results": [
            {"label": urllib.parse.urlsplit(endpoint).netloc, **post_form(endpoint, body, cookies)}
            for endpoint in endpoints
        ],
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
