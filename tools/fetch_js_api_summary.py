import argparse
import gzip
import json
import re
import urllib.request


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch a JS asset and summarize API-like strings.")
    parser.add_argument("url")
    parser.add_argument("--timeout", type=int, default=10)
    args = parser.parse_args()

    req = urllib.request.Request(
        args.url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/108 Safari/537.36",
            "Accept": "application/javascript,*/*;q=0.8",
            "Accept-Encoding": "gzip",
        },
    )
    with urllib.request.urlopen(req, timeout=args.timeout) as resp:
        body = resp.read(5_000_000)
        if resp.headers.get("Content-Encoding") == "gzip":
            body = gzip.decompress(body)

    text = body.decode("utf-8", "ignore")
    patterns = {
        "mtop": r"mtop\.[a-zA-Z0-9_.-]+",
        "urls": r"https?://[a-zA-Z0-9._~:/?#\[\]@!$&'()*+,;=%-]{8,220}",
        "paths": r"/[A-Za-z0-9_./-]*(?:message|conversation|history|chat|contact|group|token|account|manager)[A-Za-z0-9_./-]*",
        "methods": r"[A-Za-z0-9_.$-]*(?:listUserMessages|searchIMPaasHistoryMessage|listNewest|MessageManager|Conversation|chatToken|getSubAccount|message)[A-Za-z0-9_.$-]*",
        "bridge": r"[A-Za-z0-9_.$-]*(?:Bridge|JSBridge|native|Native|WindVane|Tarzan)[A-Za-z0-9_.$-]*",
    }
    result = {
        "url": args.url,
        "status": resp.status,
        "content_type": resp.headers.get("Content-Type"),
        "bytes": len(body),
        "matches": {},
    }
    for key, pattern in patterns.items():
        values = sorted(set(re.findall(pattern, text, re.I)))
        result["matches"][key] = values[:300]

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
