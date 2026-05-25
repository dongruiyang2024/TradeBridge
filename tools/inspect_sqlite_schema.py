import argparse
from pathlib import Path
import sqlite3


def quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def main() -> int:
    parser = argparse.ArgumentParser(description="Print SQLite schema metadata without reading row content.")
    parser.add_argument("database")
    parser.add_argument("--columns", action="store_true", help="Print columns for each table.")
    args = parser.parse_args()

    database_uri = Path(args.database).absolute().as_uri()
    con = sqlite3.connect(f"{database_uri}?mode=ro", uri=True)
    cur = con.cursor()
    tables = [
        row[0]
        for row in cur.execute(
            "select name from sqlite_master where type = 'table' order by name"
        )
    ]

    print(f"DATABASE {args.database}")
    print("TABLES")
    for table in tables:
        try:
            count = cur.execute(f"select count(*) from {quote_ident(table)}").fetchone()[0]
        except Exception as exc:
            count = f"ERR {exc}"
        print(f"- {table}: {count}")

        if args.columns:
            for column in cur.execute(f"pragma table_info({quote_ident(table)})"):
                _, name, type_name, not_null, default_value, pk = column
                flags = []
                if pk:
                    flags.append("pk")
                if not_null:
                    flags.append("not-null")
                suffix = f" ({', '.join(flags)})" if flags else ""
                default = f" default={default_value}" if default_value is not None else ""
                print(f"    {name}: {type_name}{suffix}{default}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
