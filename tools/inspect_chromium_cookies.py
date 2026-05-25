import argparse
import sqlite3
from collections import Counter
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect Chromium cookie metadata without printing cookie values.")
    parser.add_argument("cookies_db")
    args = parser.parse_args()

    path = Path(args.cookies_db)
    uri = path.absolute().as_uri() + "?mode=ro"
    con = sqlite3.connect(uri, uri=True)
    cur = con.cursor()
    rows = cur.execute(
        """
        select host_key, name, is_httponly, is_secure, expires_utc, length(encrypted_value), length(value)
        from cookies
        order by host_key, name
        """
    ).fetchall()
    con.close()

    print(f"cookies_db={path}")
    print(f"cookie_count={len(rows)}")
    domains = Counter(row[0] for row in rows)
    print("domains")
    for domain, count in domains.most_common():
        print(f"- {domain}: {count}")

    print("names_by_domain")
    for domain in sorted(domains):
        names = [
            f"{name}(httpOnly={bool(http_only)},secure={bool(secure)},encLen={enc_len or 0},plainLen={plain_len or 0})"
            for host, name, http_only, secure, _, enc_len, plain_len in rows
            if host == domain
        ]
        print(f"- {domain}: {', '.join(names)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
