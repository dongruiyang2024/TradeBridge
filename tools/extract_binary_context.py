import argparse
import re
import sys
from pathlib import Path


TOKEN_RE = re.compile(r"(chatToken=)[A-Za-z0-9%._~-]+", re.I)
LONG_RE = re.compile(r"[A-Za-z0-9+/=_%-]{80,}")


def clean(data: bytes) -> str:
    text = data.decode("utf-8", "ignore")
    text = "".join(ch if ch.isprintable() or ch in "\r\n\t" else " " for ch in text)
    text = re.sub(r"\s+", " ", text)
    text = TOKEN_RE.sub(r"\1<redacted>", text)
    text = LONG_RE.sub("<long-redacted>", text)
    return text.strip()


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="Extract short sanitized binary contexts around keywords.")
    parser.add_argument("paths", nargs="+")
    parser.add_argument("--keyword", action="append", required=True)
    parser.add_argument("--window", type=int, default=500)
    parser.add_argument("--limit", type=int, default=80)
    args = parser.parse_args()

    keywords = [kw.encode("utf-8") for kw in args.keyword]
    seen = 0
    for root in [Path(p) for p in args.paths]:
        files = [root] if root.is_file() else [p for p in root.rglob("*") if p.is_file() and p.name.upper() != "LOCK"]
        for path in files:
            try:
                data = path.read_bytes()
            except Exception:
                continue
            lowered = data.lower()
            for keyword in keywords:
                start = 0
                while True:
                    idx = lowered.find(keyword.lower(), start)
                    if idx < 0:
                        break
                    lo = max(0, idx - args.window)
                    hi = min(len(data), idx + len(keyword) + args.window)
                    print(f"FILE {path}")
                    print(clean(data[lo:hi]))
                    print("---")
                    seen += 1
                    if seen >= args.limit:
                        return 0
                    start = idx + len(keyword)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
