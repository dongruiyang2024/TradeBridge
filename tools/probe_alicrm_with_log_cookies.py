import json
import re
import urllib.parse
import urllib.request
from pathlib import Path


COOKIE_NAMES = [
    "_m_h5_tk",
    "_m_h5_tk_enc",
    "_tb_token_",
    "ali_apache_id",
    "ali_apache_track",
    "cookie2",
    "icbu_s_tag",
    "intl_common_forever",
    "isg",
    "recommend_login",
    "sgcookie",
    "tfstk",
    "xman_f",
    "xman_i",
    "xman_t",
    "xman_us_f",
    "xman_us_t",
    "xlly_s",
]


ALICRM_URL_RE = re.compile(
    r"https?://onetalk\.alibaba\.com/message/alicrm\.htm\?[^\\\s\"'<>]+",
    re.I,
)


def text_variants(text: str):
    yield text
    decoded = text.replace("\\u0026", "&").replace("\\/", "/")
    yield decoded
    for _ in range(2):
        decoded = urllib.parse.unquote(decoded)
        yield decoded.replace("\\u0026", "&").replace("\\/", "/")


def extract_latest_alicrm_context(paths: list[Path]) -> dict:
    urls: list[str] = []
    for path in paths:
        if not path.exists():
            continue
        text = path.read_text("utf-8", "ignore")
        for variant in text_variants(text):
            for match in ALICRM_URL_RE.finditer(variant):
                url = match.group(0).rstrip("),]};")
                urls.append(url)

    params: dict[str, str] = {}
    if not urls:
        return {"found_url": False, "url": "", "params": params}

    latest_url = urls[-1]
    for url in reversed(urls):
        candidates = [url]
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query, keep_blank_values=True)
        for value in query.get("return_url", []):
            candidates.append(urllib.parse.unquote(value))
        for candidate in candidates:
            parsed = urllib.parse.urlsplit(candidate)
            candidate_query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
            for key, values in candidate_query.items():
                if values and values[0] and key not in params:
                    params[key] = values[0]
        if params.get("contactAccountIdEncrypt") and params.get("ownerAccountIdEncrypt"):
            latest_url = url
            break

    return {"found_url": True, "url": latest_url, "params": params}


def extract_cookies(paths: list[Path]) -> dict[str, str]:
    found: dict[str, str] = {}
    for path in paths:
        if not path.exists():
            continue
        text = path.read_text("utf-8", "ignore")
        for name in COOKIE_NAMES:
            # Cookie values in these logs are semicolon/space/bracket delimited.
            pattern = re.compile(rf"(?<![A-Za-z0-9_]){re.escape(name)}=([^;\s,\]]+)", re.M)
            for match in pattern.finditer(text):
                value = match.group(1).strip()
                if value and "<" not in value:
                    found[name] = value
    return found


def get_ctoken(cookies: dict[str, str]) -> str:
    raw = cookies.get("xman_us_t", "")
    decoded = urllib.parse.unquote(raw)
    parsed = urllib.parse.parse_qs(decoded, keep_blank_values=True)
    values = parsed.get("ctoken") or parsed.get(" ctoken")
    return values[0] if values else ""


def with_csrf(endpoint: str, cookies: dict[str, str]) -> str:
    params = []
    ctoken = get_ctoken(cookies)
    tb = cookies.get("_tb_token_", "")
    if ctoken:
        params.append(("ctoken", ctoken))
    if tb:
        params.append(("_tb_token_", tb))
    if not params:
        return endpoint
    return endpoint + ("&" if "?" in endpoint else "?") + urllib.parse.urlencode(params)


def summarize_json(parsed):
    summary = {
        "json_keys": [],
        "code": None,
        "success": None,
        "data_keys": [],
        "list_lengths": {},
        "nested_list_lengths": {},
    }
    if not isinstance(parsed, dict):
        return summary
    summary["json_keys"] = sorted(parsed.keys())[:50]
    summary["code"] = parsed.get("code") or parsed.get("retCode")
    if "success" in parsed:
        summary["success"] = bool(parsed.get("success"))
    data_obj = parsed.get("data")
    if isinstance(data_obj, dict):
        summary["data_keys"] = sorted(data_obj.keys())[:80]
        for key, value in data_obj.items():
            if isinstance(value, list):
                summary["list_lengths"][key] = len(value)
            elif isinstance(value, dict):
                for nested_key, nested_value in value.items():
                    if isinstance(nested_value, list):
                        summary["nested_list_lengths"][f"{key}.{nested_key}"] = len(nested_value)
    elif isinstance(data_obj, list):
        summary["list_lengths"]["data"] = len(data_obj)
    return summary


def request(
    endpoint: str,
    cookies: dict[str, str],
    body: dict[str, str],
    origin: str,
    referer: str,
    label: str,
) -> dict:
    endpoint = with_csrf(endpoint, cookies)
    data = urllib.parse.urlencode(body).encode("utf-8")
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/108 Safari/537.36 AlibabaSupplier/11.39.80E",
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Origin": origin,
        "Referer": referer or origin + "/",
        "X-Requested-With": "XMLHttpRequest",
        "Cookie": "; ".join(f"{k}={v}" for k, v in cookies.items()),
    }
    req = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            status = resp.status
            final_url = resp.geturl()
            content_type = resp.headers.get("Content-Type")
            raw = resp.read(800_000)
    except urllib.error.HTTPError as exc:
        status = exc.code
        final_url = exc.geturl()
        content_type = exc.headers.get("Content-Type")
        raw = exc.read(800_000)
    text = raw.decode("utf-8", "ignore")
    params_obj = {}
    if "params" in body:
        try:
            params_obj = json.loads(body["params"])
        except Exception:
            params_obj = {}
    result = {
        "label": label,
        "endpoint": endpoint.split("?")[0],
        "origin": origin,
        "status": status,
        "final_host": urllib.parse.urlsplit(final_url).netloc,
        "content_type": content_type,
        "content_length": len(raw),
        "looks_like_login": "login.alibaba.com" in final_url or "newlogin" in text[:5000].lower(),
        "param_keys": sorted(params_obj.keys()) if isinstance(params_obj, dict) else [],
        "json": False,
        "json_keys": [],
        "code": None,
        "success": None,
        "data_keys": [],
        "list_lengths": {},
        "nested_list_lengths": {},
    }
    try:
        parsed = json.loads(text)
        result["json"] = True
        result.update(summarize_json(parsed))
    except Exception:
        pass
    return result


def build_payloads(context_params: dict[str, str]) -> list[tuple[str, str, dict[str, str]]]:
    contact = context_params.get("contactAccountIdEncrypt") or context_params.get("secContactAccountId")
    owner = context_params.get("ownerAccountIdEncrypt") or context_params.get("secOwnerAccountId")
    trade = (
        context_params.get("tradeIdEncrypt")
        or context_params.get("secTradeId")
        or context_params.get("inquiryIdEncrypt")
    )
    payloads: list[tuple[str, str, dict[str, str]]] = []

    if contact and owner:
        base = {
            "secContactAccountId": contact,
            "secOwnerAccountId": owner,
            "companyView": True,
        }
        payloads.append((
            "chat-summary",
            "/chatManager/getChatDataSummary.htm",
            {"params": json.dumps(base, separators=(",", ":"))},
        ))
        for query_type in ("product", "inquiry", "quotation"):
            data = {
                **base,
                "queryType": query_type,
                "currentPage": 1,
                "pageSize": 5,
            }
            payloads.append((
                f"specified-list-{query_type}",
                "/chatManager/getSpecifyMessageChatList.htm",
                {"params": json.dumps(data, separators=(",", ":"))},
            ))
        if trade:
            data = {**base, "secTradeId": trade}
            payloads.append((
                "inquiry-process",
                "/chatManager/getInquiryChatProcess.htm",
                {"params": json.dumps(data, separators=(",", ":"))},
            ))

    payloads.append((
        "target-tags",
        "/message/getTargetTagList.htm",
        {"params": "{}"},
    ))
    return payloads


def main() -> int:
    log_paths = [
        Path(r"D:\AlibabaSupplierData\app.log"),
        Path(r"C:\Users\wait9yan\AppData\Local\AliWorkbenchTemp\cef.log"),
    ]
    cookies = extract_cookies([
        *log_paths,
    ])
    alicrm_context = extract_latest_alicrm_context(log_paths)
    payloads = build_payloads(alicrm_context["params"])
    host = "onetalk.alibaba.com"
    origin = "https://onetalk.alibaba.com"
    output = {
        "cookie_names_used": sorted(cookies.keys()),
        "cookie_count": len(cookies),
        "has_ctoken": bool(get_ctoken(cookies)),
        "has_tb_token": bool(cookies.get("_tb_token_")),
        "alicrm_context": {
            "found_url": bool(alicrm_context["found_url"]),
            "has_contact_account": bool(alicrm_context["params"].get("contactAccountIdEncrypt")),
            "has_owner_account": bool(alicrm_context["params"].get("ownerAccountIdEncrypt")),
            "has_trade": bool(
                alicrm_context["params"].get("tradeIdEncrypt")
                or alicrm_context["params"].get("secTradeId")
                or alicrm_context["params"].get("inquiryIdEncrypt")
            ),
        },
        "results": [
            request(f"https://{host}{path}", cookies, body, origin, origin + "/message/alicrm.htm", label)
            for label, path, body in payloads
        ],
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
