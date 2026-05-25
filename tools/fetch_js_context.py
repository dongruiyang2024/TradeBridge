import argparse
import gzip
import re
import sys
import urllib.request


SENSITIVE_RE = re.compile(r"((?:chatToken|ctoken|_tb_token_|token|sign|data)=)[^&'\"\\\s]+", re.I)
LONG_RE = re.compile(r"[A-Za-z0-9+/=_%-]{100,}")


def fetch_text(url: str, timeout: int) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/108 Safari/537.36",
            "Accept": "application/javascript,*/*;q=0.8",
            "Accept-Encoding": "gzip",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read(5_000_000)
        if resp.headers.get("Content-Encoding") == "gzip":
            body = gzip.decompress(body)
    return body.decode("utf-8", "ignore")


def clean(text: str) -> str:
    text = SENSITIVE_RE.sub(r"\1<redacted>", text)
    text = LONG_RE.sub("<long-redacted>", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="Fetch JS and print sanitized context around keywords.")
    parser.add_argument("url")
    parser.add_argument("--keyword", action="append", required=True)
    parser.add_argument("--window", type=int, default=900)
    parser.add_argument("--timeout", type=int, default=10)
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--limit", type=int, default=20)
    args = parser.parse_args()

    text = fetch_text(args.url, args.timeout)
    lower = text.lower()
    for keyword in args.keyword:
        start = 0
        count = 0
        found = False
        while True:
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
            if not args.all or count >= args.limit:
                break
            start = idx + len(keyword)
        if not found:
            print(f"KEYWORD {keyword}: not found")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
