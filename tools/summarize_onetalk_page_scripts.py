import argparse
import gzip
import html
import json
import re
import sys
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

from probe_alicrm_with_log_cookies import extract_cookies, extract_latest_alicrm_context


LOG_PATHS = [
    Path(r"D:\AlibabaSupplierData\app.log"),
    Path(r"C:\Users\wait9yan\AppData\Local\AliWorkbenchTemp\cef.log"),
]


def fetch(url: str, cookies: dict[str, str], timeout: int = 10) -> tuple[int, str, dict[str, str], bytes]:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/108 Safari/537.36 AlibabaSupplier/11.39.80E",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Encoding": "gzip",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cookie": "; ".join(f"{k}={v}" for k, v in cookies.items()),
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        resp_ctx = urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as exc:
        resp_ctx = exc
    with resp_ctx as resp:
        body = resp.read(2_500_000)
        if resp.headers.get("Content-Encoding") == "gzip":
            body = gzip.decompress(body)
        return resp.status, resp.geturl(), dict(resp.headers), body


def clean_script_url(page_url: str, src: str) -> str:
    absolute = urllib.parse.urljoin(page_url, src)
    parsed = urllib.parse.urlsplit(absolute)
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="Fetch an onetalk page with local cookies and summarize it without secrets.")
    parser.add_argument("--url", default="", help="Target URL. Defaults to latest alicrm URL from logs.")
    parser.add_argument("--timeout", type=int, default=10)
    args = parser.parse_args()

    cookies = extract_cookies(LOG_PATHS)
    if args.url:
        target_url = args.url
    else:
        context = extract_latest_alicrm_context(LOG_PATHS)
        target_url = context["url"]
    if not target_url:
        print(json.dumps({"ok": False, "error": "no onetalk alicrm url found"}, ensure_ascii=False, indent=2))
        return 2

    status, final_url, headers, body = fetch(target_url, cookies, timeout=args.timeout)
    text = body.decode("utf-8", "ignore")
    title_match = re.search(r"<title[^>]*>(.*?)</title>", text, re.I | re.S)
    title = html.unescape(re.sub(r"\s+", " ", title_match.group(1)).strip()) if title_match else ""
    scripts = re.findall(r"<script[^>]+src=[\"']([^\"']+)", text, re.I)
    cleaned_scripts = []
    for src in scripts:
        url = clean_script_url(final_url, src)
        if url not in cleaned_scripts:
            cleaned_scripts.append(url)
    keywords = [
        "IcbuIM",
        "listUserMessages",
        "listNewest",
        "listNewestPagination",
        "searchIMPaasHistoryMessage",
        "MessageManager",
        "Conversation",
        "mtop",
        "chatToken",
        "sendMessage",
        "history",
        "weblite",
        "web_weblite",
        "activeAccountId",
        "activeAccountIdEncrypt",
        "login.alibaba.com",
        "newlogin",
    ]
    result = {
        "ok": status == 200 and "login.alibaba.com" not in final_url and "newlogin" not in text[:5000].lower(),
        "requested_path": urllib.parse.urlsplit(target_url).path,
        "status": status,
        "final_host": urllib.parse.urlsplit(final_url).netloc,
        "final_path": urllib.parse.urlsplit(final_url).path,
        "content_type": headers.get("Content-Type"),
        "content_length": len(body),
        "title": title,
        "cookie_count": len(cookies),
        "script_count": len(scripts),
        "script_urls": cleaned_scripts[:120],
        "keyword_counts": {key: text.count(key) for key in keywords},
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
