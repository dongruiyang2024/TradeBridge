import argparse
import json
import re
import urllib.parse
import urllib.request


SENSITIVE_KEYS = {"chatToken", "contactAccountIdEncrypt", "ownerAccountIdEncrypt", "return_url", "ctoken", "_tb_token_", "token"}


def redact_url(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    pairs = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    clean = [(k, "<redacted>" if k in SENSITIVE_KEYS or "token" in k.lower() else v) for k, v in pairs]
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urllib.parse.urlencode(clean), ""))


def probe(url: str, method: str, body: dict | None, timeout: int) -> dict:
    data = None
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/108 Safari/537.36 AlibabaSupplier/11.39.80E",
        "Accept": "application/json,text/plain,*/*",
        "Origin": "https://onetalk.alibaba.com",
        "Referer": "https://onetalk.alibaba.com/",
    }
    if body is not None:
        data = urllib.parse.urlencode(body).encode("utf-8")
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status = resp.status
            final_url = resp.geturl()
            headers_out = dict(resp.headers)
            content = resp.read(500_000)
    except urllib.error.HTTPError as exc:
        status = exc.code
        final_url = exc.geturl()
        headers_out = dict(exc.headers)
        content = exc.read(500_000)
    except Exception as exc:
        return {"url": redact_url(url), "method": method, "ok": False, "error": f"{type(exc).__name__}: {exc}"}

    text = content.decode("utf-8", "ignore")
    result = {
        "url": redact_url(url),
        "method": method,
        "ok": True,
        "status": status,
        "final_url": redact_url(final_url),
        "content_type": headers_out.get("Content-Type") or headers_out.get("content-type"),
        "content_length": len(content),
        "looks_like_login": "login.alibaba.com" in final_url or "newlogin" in text[:5000].lower(),
        "json_keys": [],
        "code": None,
        "message_key_present": False,
    }
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            result["json_keys"] = sorted(list(parsed.keys()))[:40]
            result["code"] = parsed.get("code") or parsed.get("retCode") or parsed.get("success")
            result["message_key_present"] = any(k.lower() in {"message", "msg", "error", "errormessage"} for k in parsed.keys())
    except Exception:
        title = re.search(r"<title[^>]*>(.*?)</title>", text, re.I | re.S)
        result["html_title"] = re.sub(r"\s+", " ", title.group(1)).strip() if title else ""
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe alicrm/message endpoints without printing response bodies.")
    parser.add_argument("--timeout", type=int, default=8)
    args = parser.parse_args()
    endpoints = [
        ("https://alicrm.alibaba.com/chatManager/getChatDataSummary.htm", "POST", {"params": "{}"}),
        ("https://alicrm.alibaba.com/chatManager/getInquiryChatProcess.htm", "POST", {"params": "{}"}),
        ("https://alicrm.alibaba.com/chatManager/getSpecifyMessageChatList.htm", "POST", {"params": json.dumps({"queryType": "product"}, separators=(",", ":"))}),
        ("https://alicrm.alibaba.com/message/getTargetTagList.htm", "POST", {"params": "{}"}),
        ("https://message.alibaba.com/message/default.htm", "GET", None),
    ]
    print(json.dumps([probe(*item, timeout=args.timeout) for item in endpoints], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
