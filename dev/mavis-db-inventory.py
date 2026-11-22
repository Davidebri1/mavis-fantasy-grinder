"""Inventory the local Django database: table list and row counts.

Read-only. Used to confirm a copied dev database arrived with its data
intact, and to see what the optimizer reads at rest.

Usage:
    python dev/mavis-db-inventory.py [path-to-db.sqlite3]
"""

import os
import sqlite3
import sys

DEFAULT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "backend",
    "django",
    "db.sqlite3",
)


def main() -> int:
    db_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    if not os.path.exists(db_path):
        print(f"MISSING {db_path}")
        return 1

    size = os.path.getsize(db_path)
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        tables = [
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        print(f"DB {db_path}")
        print(f"BYTES {size}")
        print(f"TABLES {len(tables)}")
        for table in tables:
            try:
                count = conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
            except sqlite3.Error as exc:
                count = f"error: {exc}"
            print(f"  {table}: {count}")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
