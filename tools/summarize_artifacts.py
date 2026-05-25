import argparse
import collections
import re
from pathlib import Path


API_RE = re.compile(rb"(?:api\.api=|api=|mtop\.)([a-zA-Z0-9_.-]*(?:message|im|conv|contact|group|black|chat|history|sync)[a-zA-Z0-9_.-]*)", re.I)
URL_RE = re.compile(rb"https?://[a-zA-Z0-9./?&_%=:#@+-]{8,220}", re.I)
DOMAIN_RE = re.compile(rb"(?:https?://)?([a-zA-Z0-9.-]*(?:alibaba|alicdn|taobao|tmall)[a-zA-Z0-9.-]*)", re.I)
KEYWORDS = [
    b"message",
    b"conversation",
    b"history",
    b"contact",
    b"group",
    b"onetalk",
    b"aim",
    b"im.sqlite",
    b"sqlite3_key",
    b"WangWangSimpleServer",
]


def safe_text(value: bytes) -> str:
    return value.decode("utf-8", "ignore").strip("\x00\r\n\t ")


def scan_file(path: Path, max_bytes: int) -> dict:
    try:
        data = path.read_bytes()
    except Exception as exc:
        return {"error": f"{type(exc).__name__}: {exc}"}
    if max_bytes and len(data) > max_bytes:
        data = data[:max_bytes]

    lowered = data.lower()
    apis = collections.Counter(safe_text(m.group(1)) for m in API_RE.finditer(data))
    domains = collections.Counter(safe_text(m.group(1)) for m in DOMAIN_RE.finditer(data))
    keyword_counts = {kw.decode(): lowered.count(kw.lower()) for kw in KEYWORDS}
    url_domains = collections.Counter()
    for match in URL_RE.finditer(data):
        url = safe_text(match.group(0))
        domain_match = re.match(r"https?://([^/?#]+)", url)
        if domain_match:
            url_domains[domain_match.group(1)] += 1

    return {
        "size": len(data),
        "apis": apis,
        "domains": domains,
        "url_domains": url_domains,
        "keywords": keyword_counts,
    }


def iter_files(paths: list[Path]):
    for path in paths:
        if path.is_file():
            yield path
        elif path.is_dir():
            for child in path.rglob("*"):
                if child.is_file() and child.name.upper() != "LOCK":
                    yield child


def main() -> int:
    parser = argparse.ArgumentParser(description="Summarize local logs/cache without printing message bodies.")
    parser.add_argument("paths", nargs="+")
    parser.add_argument("--max-bytes", type=int, default=8_000_000)
    parser.add_argument("--top", type=int, default=30)
    args = parser.parse_args()

    files = list(iter_files([Path(p) for p in args.paths]))
    total_keywords = collections.Counter()
    total_apis = collections.Counter()
    total_domains = collections.Counter()
    total_url_domains = collections.Counter()
    errors = []
    interesting_files = []

    for path in files:
        result = scan_file(path, args.max_bytes)
        if "error" in result:
            errors.append((path, result["error"]))
            continue
        keyword_sum = sum(result["keywords"].values())
        if keyword_sum or result["apis"] or result["url_domains"]:
            interesting_files.append((path, keyword_sum, len(result["apis"]), len(result["url_domains"])))
        total_keywords.update(result["keywords"])
        total_apis.update(result["apis"])
        total_domains.update(result["domains"])
        total_url_domains.update(result["url_domains"])

    print(f"files_scanned={len(files)} errors={len(errors)}")
    print("keywords")
    for key, value in total_keywords.most_common():
        print(f"- {key}: {value}")

    print("apis")
    for key, value in total_apis.most_common(args.top):
        print(f"- {key}: {value}")

    print("url_domains")
    for key, value in total_url_domains.most_common(args.top):
        print(f"- {key}: {value}")

    print("domains")
    for key, value in total_domains.most_common(args.top):
        print(f"- {key}: {value}")

    print("interesting_files")
    for path, keyword_sum, api_count, url_domain_count in sorted(interesting_files, key=lambda x: x[1], reverse=True)[: args.top]:
        print(f"- {path} keywords={keyword_sum} apis={api_count} url_domains={url_domain_count}")

    if errors:
        print("errors")
        for path, error in errors[: args.top]:
            print(f"- {path}: {error}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
