import argparse
import re
import urllib.parse
from collections import Counter
from pathlib import Path


URL_RE = re.compile(rb"https?://[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]{8,500}")
SENSITIVE_KEYS = {
    "chatToken",
    "contactAccountIdEncrypt",
    "ownerAccountIdEncrypt",
    "ctoken",
    "_tb_token_",
    "token",
    "accessToken",
    "callback",
    "data",
    "sign",
    "t",
}


def redact_url(raw: str) -> str:
    parsed = urllib.parse.urlsplit(raw)
    pairs = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    clean_pairs = []
    for key, value in pairs:
        clean_pairs.append((key, "<redacted>" if key in SENSITIVE_KEYS or "token" in key.lower() else value))
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urllib.parse.urlencode(clean_pairs), ""))


def iter_files(paths):
    for path in paths:
        if path.is_file():
            yield path
        elif path.is_dir():
            for child in path.rglob("*"):
                if child.is_file() and child.name.upper() != "LOCK":
                    yield child


def main() -> int:
    parser = argparse.ArgumentParser(description="Summarize URLs embedded in Chromium cache files.")
    parser.add_argument("paths", nargs="+")
    parser.add_argument("--top", type=int, default=120)
    args = parser.parse_args()

    urls = Counter()
    by_path = Counter()
    by_domain = Counter()
    files_with_urls = Counter()

    for path in iter_files([Path(p) for p in args.paths]):
        try:
            data = path.read_bytes()
        except Exception:
            continue
        found = set()
        for match in URL_RE.finditer(data):
            raw = match.group(0).decode("utf-8", "ignore").rstrip(".,);'\"<>\\")
            if not raw:
                continue
            redacted = redact_url(raw)
            parsed = urllib.parse.urlsplit(redacted)
            if not parsed.netloc:
                continue
            urls[redacted] += 1
            by_domain[parsed.netloc] += 1
            by_path[f"{parsed.netloc}{parsed.path}"] += 1
            found.add(redacted)
        for url in found:
            files_with_urls[url] += 1

    print("domains")
    for key, value in by_domain.most_common(args.top):
        print(f"- {key}: {value}")
    print("paths")
    for key, value in by_path.most_common(args.top):
        print(f"- {key}: {value}")
    print("urls")
    for key, value in urls.most_common(args.top):
        print(f"- {key}: count={value} files={files_with_urls[key]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
