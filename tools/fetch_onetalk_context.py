import argparse
import gzip
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

SENSITIVE_RE = re.compile(
    r"((?:chatToken|ctoken|_tb_token_|token|accessToken|refreshToken|sign|data|return_url)=)[^&'\"\\\s,;}]+",
    re.I,
)
LONG_RE = re.compile(r"[A-Za-z0-9+/=_%-]{80,}")


def fetch(url: str, timeout: int) -> str:
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
        body = resp.read(3_000_000)
        if resp.headers.get("Content-Encoding") == "gzip":
            body = gzip.decompress(body)
    return body.decode("utf-8", "ignore")


def clean(text: str) -> str:
    text = SENSITIVE_RE.sub(r"\1<redacted>", text)
    text = re.sub(r"(KHTAccessToken\s*=\s*[\"'])[^\"']+([\"'])", r"\1<redacted>\2", text)
    text = re.sub(r"(currentUserAccountId\s*=\s*[\"'])[^\"']+([\"'])", r"\1<redacted>\2", text)
    text = LONG_RE.sub("<long-redacted>", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="Fetch onetalk page with cookies and print sanitized keyword context.")
    parser.add_argument("url", nargs="?", default="")
    parser.add_argument("--keyword", action="append", required=True)
    parser.add_argument("--window", type=int, default=900)
    parser.add_argument("--timeout", type=int, default=10)
    parser.add_argument("--limit", type=int, default=8)
    args = parser.parse_args()

    target_url = args.url
    if not target_url:
        context = extract_latest_alicrm_context(LOG_PATHS)
        target_url = context.get("url") or ""
    if not target_url:
        print("no target url")
        return 2

    text = fetch(target_url, args.timeout)
    lower = text.lower()
    for keyword in args.keyword:
        start = 0
        count = 0
        found = False
        while count < args.limit:
            idx = lower.find(keyword.lower(), start)
            if idx < 0:
                break
            found = True
            count += 1
            lo = max(0, idx - args.window)
            hi = min(len(text), idx + len(keyword) + args.window)
            print(f"KEYWORD {keyword} #{count}")
            print(clean(text[lo:hi]))
            print("---")
            start = idx + len(keyword)
        if not found:
            print(f"KEYWORD {keyword}: not found")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
