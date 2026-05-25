import argparse
import ctypes
import ctypes.wintypes as wt
import html
import json
import re
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path


class DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", wt.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]


crypt32 = ctypes.windll.crypt32
kernel32 = ctypes.windll.kernel32


def dpapi_unprotect(data: bytes) -> bytes:
    in_buffer = ctypes.create_string_buffer(data, len(data))
    in_blob = DATA_BLOB(len(data), ctypes.cast(in_buffer, ctypes.POINTER(ctypes.c_byte)))
    out_blob = DATA_BLOB()
    if not crypt32.CryptUnprotectData(ctypes.byref(in_blob), None, None, None, None, 0, ctypes.byref(out_blob)):
        raise OSError(ctypes.get_last_error())
    try:
        return ctypes.string_at(out_blob.pbData, out_blob.cbData)
    finally:
        kernel32.LocalFree(out_blob.pbData)


def decrypt_cookie(encrypted_value: bytes, plain_value: str) -> str | None:
    if plain_value:
        return plain_value
    if not encrypted_value:
        return None
    try:
        return dpapi_unprotect(encrypted_value).decode("utf-8", "replace")
    except Exception:
        return None


@dataclass
class Cookie:
    host: str
    name: str
    value: str
    path: str
    secure: bool


def load_cookies(cookies_db: Path) -> list[Cookie]:
    con = sqlite3.connect(cookies_db)
    cur = con.cursor()
    rows = cur.execute(
        "select host_key, name, value, encrypted_value, path, is_secure from cookies"
    ).fetchall()
    con.close()
    cookies = []
    for host, name, value, encrypted_value, path, secure in rows:
        decoded = decrypt_cookie(encrypted_value, value)
        if decoded is not None:
            cookies.append(Cookie(host, name, decoded, path or "/", bool(secure)))
    return cookies


def cookie_applies(cookie: Cookie, url: str) -> bool:
    parsed = urllib.parse.urlparse(url)
    host = parsed.hostname or ""
    path = parsed.path or "/"
    cookie_host = cookie.host.lstrip(".")
    host_match = host == cookie_host or host.endswith("." + cookie_host)
    path_match = path.startswith(cookie.path.rstrip("/") or "/")
    secure_match = not cookie.secure or parsed.scheme == "https"
    return host_match and path_match and secure_match


def cookie_header(cookies: list[Cookie], url: str) -> str:
    pairs = []
    seen = set()
    for cookie in cookies:
        key = (cookie.name, cookie.host, cookie.path)
        if key in seen or not cookie_applies(cookie, url):
            continue
        seen.add(key)
        pairs.append(f"{cookie.name}={cookie.value}")
    return "; ".join(pairs)


def find_latest_onetalk_url(log_paths: list[Path]) -> str | None:
    pattern = re.compile(r"https?://onetalk\.alibaba\.com/message/alicrm\.htm\?[^\s\]\"]+")
    latest = None
    for path in log_paths:
        if not path.exists():
            continue
        text = path.read_text("utf-8", "ignore")
        matches = pattern.findall(text)
        if matches:
            latest = matches[-1]
    return latest


def redact_url(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    pairs = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    redacted = []
    sensitive = {"chatToken", "contactAccountIdEncrypt", "ownerAccountIdEncrypt", "return_url"}
    for key, value in pairs:
        redacted.append((key, "<redacted>" if key in sensitive else value))
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urllib.parse.urlencode(redacted), parsed.fragment))


def fetch(url: str, cookies: list[Cookie], timeout: int) -> tuple[int, dict, bytes, str | None, str]:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36 AlibabaSupplier/11.39.80E",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": "https://i.alibaba.com/",
    }
    cookie = cookie_header(cookies, url)
    if cookie:
        headers["Cookie"] = cookie
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, dict(response.headers), response.read(1_500_000), None, response.geturl()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read(500_000), None, exc.geturl()
    except Exception as exc:
        return 0, {}, b"", f"{type(exc).__name__}: {exc}", url


def summarize_body(body: bytes) -> dict:
    text = body.decode("utf-8", "ignore")
    title_match = re.search(r"<title[^>]*>(.*?)</title>", text, re.I | re.S)
    title = html.unescape(re.sub(r"\s+", " ", title_match.group(1)).strip()) if title_match else ""
    scripts = re.findall(r"<script[^>]+src=[\"']([^\"']+)", text, re.I)
    domains = []
    for src in scripts[:80]:
        parsed = urllib.parse.urlparse(urllib.parse.urljoin("https://onetalk.alibaba.com/", src))
        if parsed.netloc:
            domains.append(parsed.netloc)
    keywords = [
        "listUserMessages",
        "searchIMPaasHistoryMessage",
        "MessageManager",
        "Conversation",
        "BridgePlugin",
        "nativepc",
        "mtop",
        "chatToken",
        "login",
        "error",
    ]
    return {
        "title": title,
        "script_count": len(scripts),
        "script_domains": sorted(set(domains)),
        "keyword_counts": {key: text.count(key) for key in keywords},
        "api_like": sorted(set(re.findall(r"(?:mtop\.)?[a-zA-Z0-9_.]*(?:message|im|chat|contact|group|history)[a-zA-Z0-9_.]*", text, re.I)))[:80],
        "body_prefix": re.sub(r"\s+", " ", text[:180]).strip(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe the onetalk web page without printing secrets or message bodies.")
    parser.add_argument("--profile", default=r"C:\Users\wait9yan\AppData\Local\AliWorkbenchTemp\202500001744639")
    parser.add_argument("--log", action="append", default=[
        r"D:\AlibabaSupplierData\app.log",
        r"C:\Users\wait9yan\AppData\Local\AliWorkbenchTemp\cef.log",
    ])
    parser.add_argument("--url", default="")
    parser.add_argument("--timeout", type=int, default=8)
    args = parser.parse_args()

    profile = Path(args.profile)
    cookies_db = profile / "Network" / "Cookies"
    cookies = load_cookies(cookies_db)
    target_url = args.url or find_latest_onetalk_url([Path(item) for item in args.log])
    if not target_url:
        print(json.dumps({"ok": False, "error": "no onetalk url found"}, ensure_ascii=False, indent=2))
        return 2

    status, headers, body, error, final_url = fetch(target_url, cookies, args.timeout)
    result = {
        "ok": error is None and status > 0,
        "url": redact_url(target_url),
        "final_url": redact_url(final_url),
        "cookie_count_loaded": len(cookies),
        "request_cookie_count_for_url": len([c for c in cookies if cookie_applies(c, target_url)]),
        "status": status,
        "content_type": headers.get("Content-Type") or headers.get("content-type"),
        "content_length": len(body),
        "error": error,
        "summary": summarize_body(body) if body else {},
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
