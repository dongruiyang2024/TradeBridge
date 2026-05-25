import argparse
import math
from pathlib import Path
import sqlite3


def shannon_entropy(data: bytes) -> float:
    if not data:
        return 0.0
    counts = [0] * 256
    for byte in data:
        counts[byte] += 1
    entropy = 0.0
    length = len(data)
    for count in counts:
        if count:
            p = count / length
            entropy -= p * math.log2(p)
    return entropy


def classify_magic(header: bytes) -> str:
    if header.startswith(b"SQLite format 3\x00"):
        return "sqlite"
    if header[:4] in (bytes.fromhex("377f0682"), bytes.fromhex("377f0683")):
        return "sqlite-wal"
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if header.startswith(b"{") or header.startswith(b"["):
        return "json-like"
    return "unknown/high-entropy" if shannon_entropy(header) > 5.0 else "unknown"


def sqlite_tables(path: Path) -> tuple[bool, str]:
    try:
        uri = path.absolute().as_uri() + "?mode=ro"
        con = sqlite3.connect(uri, uri=True)
        cur = con.cursor()
        tables = [
            row[0]
            for row in cur.execute(
                "select name from sqlite_master where type = 'table' order by name"
            )
        ]
        con.close()
        return True, ",".join(tables[:12])
    except Exception as exc:
        return False, type(exc).__name__ + ": " + str(exc)


def inspect(path: Path) -> None:
    try:
        with path.open("rb") as fh:
            sample = fh.read(65536)
    except Exception as exc:
        print(f"{path}\n  open: ERR {type(exc).__name__}: {exc}")
        return

    header = sample[:32]
    magic = classify_magic(header)
    entropy = shannon_entropy(sample)
    size = path.stat().st_size
    print(f"{path}")
    print(f"  size={size} magic={magic} entropy64k={entropy:.3f}")
    print(f"  header32={header.hex(' ')}")

    if magic == "sqlite":
        ok, info = sqlite_tables(path)
        print(f"  sqlite_open={ok} tables={info}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Classify local storage files without reading row content.")
    parser.add_argument("paths", nargs="+")
    args = parser.parse_args()

    for item in args.paths:
        inspect(Path(item))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
