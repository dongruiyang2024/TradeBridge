import json
import re
import sys
import time
import argparse
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from probe_alicrm_with_log_cookies import ALICRM_URL_RE, extract_cookies, extract_latest_alicrm_context, get_ctoken, text_variants


LOG_PATHS = [
    Path(r"D:\AlibabaSupplierData\app.log"),
    Path(r"C:\Users\wait9yan\AppData\Local\AliWorkbenchTemp\cef.log"),
]

CUSTOMER_INFO_URL = "https://alicrm.alibaba.com/jsonp/customerPluginQueryServiceI/queryCustomerInfo.json"
CUSTOMER_TAG_URL = "https://alicrm.alibaba.com/jsonp/customerPluginQueryServiceI/queryCustomerTag.json"
DICTIONARY_URL = "https://alicrm.alibaba.com/jsonp/dictionaryQueryServiceI/queryDictionaryStaticMap.json"
GRAY_URL = "https://alicrm.alibaba.com/jsonp/alicrmCommonServiceI/isInGray.json"


def compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def build_customer_data(params: dict[str, str], sec_req_override: str | None = None) -> dict[str, str]:
    sec_req_token = sec_req_override if sec_req_override is not None else params.get("secReqToken", "")
    data = {
        "buyerAccountId": params.get("contactAccountIdEncrypt") or params.get("activeAccountIdEncrypt") or "",
        "buyerLoginId": params.get("buyerLoginId") or params.get("chatLoginId") or params.get("contactLoginId") or "",
        "secTradeId": params.get("secTradeId") or params.get("tradeIdEncrypt") or params.get("inquiryIdEncrypt") or "",
        "secReqToken": sec_req_token,
        "clientType": params.get("clientType") or params.get("fromPage") or params.get("formPage") or "nativepc",
        "formPage": params.get("fromPage") or params.get("formPage") or "",
        "lang": "zh_CN",
    }
    return {key: value for key, value in data.items() if value}


def build_exact_customer_data(params: dict[str, str], sec_req_token: str) -> dict[str, str]:
    data = {
        "buyerAccountId": params.get("contactAccountIdEncrypt") or params.get("activeAccountIdEncrypt") or "",
        "secTradeId": params.get("secTradeId") or params.get("tradeIdEncrypt") or params.get("inquiryIdEncrypt") or "",
        "buyerLoginId": params.get("buyerLoginId") or params.get("chatLoginId") or params.get("contactLoginId") or "",
        "secReqToken": sec_req_token,
        "clientType": params.get("clientType") or params.get("formPage") or "",
    }
    return {key: value for key, value in data.items() if value}


def extract_all_alicrm_contexts(paths: list[Path]) -> list[dict[str, str]]:
    seen: set[tuple[str, str, str, str]] = set()
    contexts: list[dict[str, str]] = []
    for path in paths:
        if not path.exists():
            continue
        text = path.read_text("utf-8", "ignore")
        for variant in text_variants(text):
            for match in ALICRM_URL_RE.finditer(variant):
                params = params_from_alicrm_url(match.group(0).rstrip("),]};"))
                contact = params.get("contactAccountIdEncrypt") or params.get("secContactAccountId") or ""
                buyer = params.get("buyerLoginId") or params.get("chatLoginId") or params.get("contactLoginId") or ""
                owner = params.get("ownerAccountIdEncrypt") or params.get("secOwnerAccountId") or ""
                trade = params.get("secTradeId") or params.get("tradeIdEncrypt") or params.get("inquiryIdEncrypt") or ""
                key = (contact, buyer, owner, trade)
                if contact and key not in seen:
                    seen.add(key)
                    contexts.append(params)
    return contexts


def params_from_alicrm_url(url: str) -> dict[str, str]:
    params: dict[str, str] = {}
    candidates = [url]
    try:
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query, keep_blank_values=True)
    except Exception:
        query = {}
    for value in query.get("return_url", []):
        candidates.append(urllib.parse.unquote(value))
    for candidate in candidates:
        try:
            parsed = urllib.parse.urlsplit(candidate)
            candidate_query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
        except Exception:
            continue
        for key, values in candidate_query.items():
            if values and values[0]:
                params[key] = values[0]
    return params


def request_helper_query(cookies: dict[str, str], data: dict[str, Any], extra: dict[str, Any] | None = None) -> dict[str, str]:
    query: dict[str, Any] = {
        "type": "jsonp",
        "data": data,
        "ctoken": get_ctoken(cookies),
        "_tb_token_": cookies.get("_tb_token_", ""),
        "callback": f"jsonp_{int(time.time() * 1000)}_1",
    }
    if extra:
        query.update(extra)
    return {key: compact_json(value) if isinstance(value, (dict, list)) else str(value) for key, value in query.items() if value not in (None, "")}


def flat_query(cookies: dict[str, str], data: dict[str, str]) -> dict[str, str]:
    query = {
        **data,
        "ctoken": get_ctoken(cookies),
        "_tb_token_": cookies.get("_tb_token_", ""),
        "callback": f"jsonp_{int(time.time() * 1000)}_2",
    }
    return {key: value for key, value in query.items() if value}


def fetch_jsonp(url: str, query: dict[str, str], cookies: dict[str, str], timeout: int = 12) -> dict[str, Any]:
    endpoint = url + "?" + urllib.parse.urlencode(query)
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/108 Safari/537.36 AlibabaSupplier/11.39.80E",
        "Accept": "*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": "https://onetalk.alibaba.com/message/alicrm.htm",
        "Cookie": "; ".join(f"{key}={value}" for key, value in cookies.items()),
    }
    req = urllib.request.Request(endpoint, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status = resp.status
            final_url = resp.geturl()
            content_type = resp.headers.get("Content-Type")
            raw = resp.read(900_000)
    except urllib.error.HTTPError as exc:
        status = exc.code
        final_url = exc.geturl()
        content_type = exc.headers.get("Content-Type")
        raw = exc.read(900_000)
    except Exception as exc:
        return {
            "ok": False,
            "error_type": type(exc).__name__,
            "error_message_length": len(str(exc)),
            "param_keys": sorted(query.keys()),
        }

    text = raw.decode("utf-8", "ignore")
    parsed = parse_json_or_jsonp(text)
    return {
        "ok": True,
        "status": status,
        "final_host": urllib.parse.urlsplit(final_url).netloc,
        "content_type": content_type,
        "content_length": len(raw),
        "looks_like_login": "login.alibaba.com" in final_url or "newlogin" in text[:5000].lower(),
        "param_keys": sorted(query.keys()),
        "response": summarize_response(parsed),
        "body_kind": body_kind(text, parsed),
    }


def fetch_kht_access_token(url: str, cookies: dict[str, str], timeout: int = 12) -> str:
    if not url:
        return ""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/108 Safari/537.36 AlibabaSupplier/11.39.80E",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cookie": "; ".join(f"{key}={value}" for key, value in cookies.items()),
    }
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read(1_500_000).decode("utf-8", "ignore")
    except urllib.error.HTTPError as exc:
        text = exc.read(1_500_000).decode("utf-8", "ignore")
    except Exception:
        return ""
    match = re.search(r"window\.KHTAccessToken\s*=\s*['\"]([^'\"]+)['\"]", text)
    return match.group(1) if match else ""


def parse_json_or_jsonp(text: str) -> Any:
    stripped = text.strip()
    if not stripped:
        return None
    stripped = re.sub(r"^/\*\*/\s*", "", stripped)
    try:
        return json.loads(stripped)
    except Exception:
        pass
    match = re.match(r"^[A-Za-z_$][\w$]*\((.*)\)\s*;?\s*$", stripped, re.S)
    if match:
        try:
            return json.loads(match.group(1))
        except Exception:
            return None
    match = re.match(r"^[A-Za-z_$][\w$]*\s*&&\s*[A-Za-z_$][\w$]*\((.*)\)\s*;?\s*$", stripped, re.S)
    if match:
        try:
            return json.loads(match.group(1))
        except Exception:
            return None
    open_index = stripped.find("(")
    close_index = stripped.rfind(")")
    if 0 < open_index < close_index:
        try:
            return json.loads(stripped[open_index + 1 : close_index])
        except Exception:
            return None
    return None


def summarize_response(value: Any) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "json": isinstance(value, dict),
        "top_keys": [],
        "success": None,
        "code": None,
        "data_keys": [],
        "inner_data_keys": [],
        "inner_value_types": {},
        "buyer_info_keys": [],
        "alicrm_customer_info_keys": [],
        "customer_tag_keys": [],
        "list_lengths": {},
        "field_presence": {},
    }
    if not isinstance(value, dict):
        return summary

    summary["top_keys"] = sorted(value.keys())[:80]
    summary["success"] = value.get("success")
    summary["code"] = value.get("code") or value.get("retCode")
    data = value.get("data")
    if isinstance(data, dict):
        summary["data_keys"] = sorted(data.keys())[:120]
        for key, item in data.items():
            if isinstance(item, list):
                summary["list_lengths"][key] = len(item)
        inner = data.get("data")
        if isinstance(inner, dict):
            summary["inner_data_keys"] = sorted(inner.keys())[:160]
            summary["inner_value_types"] = {key: type(inner.get(key)).__name__ for key in sorted(inner.keys())[:120]}
            buyer_info = inner.get("buyerInfo")
            customer_info = inner.get("alicrmCustomerInfo")
            tag_info = inner.get("customerTag") or inner.get("customerTags")
            if isinstance(buyer_info, dict):
                summary["buyer_info_keys"] = sorted(buyer_info.keys())[:160]
            if isinstance(customer_info, dict):
                summary["alicrm_customer_info_keys"] = sorted(customer_info.keys())[:160]
            if isinstance(tag_info, dict):
                summary["customer_tag_keys"] = sorted(tag_info.keys())[:80]
            summary["field_presence"] = {
                "buyerInfo.companyName": has_value(buyer_info, "companyName"),
                "buyerInfo.companyWebSite": has_value(buyer_info, "companyWebSite"),
                "buyerInfo.country": has_value(buyer_info, "country"),
                "buyerInfo.buyerContactInfo": isinstance(buyer_info, dict) and isinstance(buyer_info.get("buyerContactInfo"), dict),
                "alicrmCustomerInfo.companyName": has_value(customer_info, "companyName"),
                "alicrmCustomerInfo.registerDate": has_value(customer_info, "registerDate"),
                "alicrmCustomerInfo.companyWebSite": has_value(customer_info, "companyWebSite"),
                "alicrmCustomerInfo.buyerContactInfo": isinstance(customer_info, dict)
                and isinstance(customer_info.get("buyerContactInfo"), dict),
            }
    elif isinstance(data, list):
        summary["list_lengths"]["data"] = len(data)
    return summary


def has_value(value: Any, key: str) -> bool:
    return isinstance(value, dict) and value.get(key) not in (None, "")


def body_kind(text: str, parsed: Any) -> str:
    if isinstance(parsed, dict):
        return "json_or_jsonp"
    stripped = re.sub(r"^/\*\*/\s*", "", text.strip())
    if re.match(r"^[A-Za-z_$][\w$]*(?:\s*&&\s*[A-Za-z_$][\w$]*)?\s*\(", stripped):
        return "unparsed_jsonp"
    head = text[:1000].lower()
    if "<html" in head or "<title" in head:
        return "html"
    if "forbidden" in head or "deny" in head:
        return "deny_text"
    return "unknown"


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="Probe alicrm customer JSONP variants without printing sensitive values.")
    parser.add_argument("--all-contexts", action="store_true", help="Probe every distinct alicrm context found in local logs.")
    parser.add_argument("--limit", type=int, default=20)
    args = parser.parse_args()

    cookies = extract_cookies(LOG_PATHS)
    context = extract_latest_alicrm_context(LOG_PATHS)
    params = context.get("params") or {}
    kht_access_token = fetch_kht_access_token(context.get("url") or "", cookies)
    customer_data = build_customer_data(params)
    chat_token_data = build_customer_data(params, sec_req_override=params.get("chatToken", ""))
    kht_token_data = build_customer_data(params, sec_req_override=kht_access_token)
    exact_kht_token_data = build_exact_customer_data(params, kht_access_token)

    probes = [
        (
            "customer-info-request-helper",
            CUSTOMER_INFO_URL,
            request_helper_query(cookies, customer_data),
        ),
        (
            "customer-info-request-helper-chat-token-as-sec",
            CUSTOMER_INFO_URL,
            request_helper_query(cookies, chat_token_data),
        ),
        (
            "customer-info-request-helper-kht-token-as-sec",
            CUSTOMER_INFO_URL,
            request_helper_query(cookies, kht_token_data),
        ),
        (
            "customer-info-request-helper-exact-kht-token",
            CUSTOMER_INFO_URL,
            request_helper_query(cookies, exact_kht_token_data),
        ),
        (
            "customer-info-flat-control",
            CUSTOMER_INFO_URL,
            flat_query(cookies, customer_data),
        ),
        (
            "customer-tag-request-helper-control",
            CUSTOMER_TAG_URL,
            request_helper_query(cookies, customer_data),
        ),
        (
            "dictionary-request-helper-control",
            DICTIONARY_URL,
            request_helper_query(
                cookies,
                {"type": "CUSTOMER_GROUP,NOTE,ANNUAL_PROCUREMENT,IMPORTANCE_LEVEL"},
            ),
        ),
        (
            "gray-request-helper-control",
            GRAY_URL,
            request_helper_query(cookies, {"clientType": customer_data.get("clientType", "nativepc")}, {"method": "get"}),
        ),
    ]

    output: dict[str, Any] = {
        "cookie_count": len(cookies),
        "has_ctoken": bool(get_ctoken(cookies)),
        "has_tb_token": bool(cookies.get("_tb_token_")),
        "alicrm_context": {
            "found_url": bool(context.get("found_url")),
            "param_keys": sorted(params.keys()),
            "has_chat_token": bool(params.get("chatToken")),
            "has_sec_req_token": bool(params.get("secReqToken")),
            "has_kht_access_token": bool(kht_access_token),
        },
        "customer_data_keys": sorted(customer_data.keys()),
        "results": [
            {
                "label": label,
                **fetch_jsonp(url, query, cookies),
            }
            for label, url, query in probes
        ],
    }
    if args.all_contexts:
        contexts = extract_all_alicrm_contexts(LOG_PATHS)
        tail = contexts[-args.limit :]
        output["all_contexts"] = {
            "distinct_count": len(contexts),
            "probed_count": len(tail),
            "summaries": [
                {
                    "index": index + 1,
                    "param_keys": sorted(item.keys()),
                    "has_chat_token": bool(item.get("chatToken")),
                    "has_sec_req_token": bool(item.get("secReqToken")),
                    "has_trade": bool(item.get("secTradeId") or item.get("tradeIdEncrypt") or item.get("inquiryIdEncrypt")),
                    "result": fetch_jsonp(
                        CUSTOMER_INFO_URL,
                        request_helper_query(cookies, build_customer_data(item, sec_req_override=kht_access_token)),
                        cookies,
                    ),
                }
                for index, item in enumerate(tail)
            ],
        }
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
