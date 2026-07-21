"""
One-time migration: copy data from the local DuckDB file into DuckLake.

Run this ONCE, locally, with the DuckLake env vars set, before flipping the
deployed backend to DUCKLAKE_ENABLED=1. It opens the old local file (read),
attaches the DuckLake (write via app.db), and copies every table row-for-row.

Usage:
    # Set these to your R2 + Neon creds first:
    export DUCKLAKE_ENABLED=1
    export R2_BUCKET=blocks-finance-lake
    export R2_ACCESS_KEY_ID=...
    export R2_SECRET_ACCESS_KEY=...
    export R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
    export PG_CATALOG_URL="postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require"

    # From the backend/ directory:
    python -m app.migrate_to_ducklake

Safe to re-run: it upserts (dedup by conflict keys) so duplicate runs won't
double-insert. Large tables (price_history) may take a few minutes on first run.
"""

from __future__ import annotations

import duckdb

from app.db import get_connection, upsert_row, is_ducklake, DB_PATH
from app.schema import ALL_TABLES, CONFLICT_KEYS


def _row_count(conn: duckdb.DuckDBPyConnection, table: str) -> int:
    try:
        return conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0] or 0
    except Exception:
        return 0


def migrate() -> None:
    if not is_ducklake():
        raise SystemExit(
            "DUCKLAKE_ENABLED is not set (or R2/PG creds missing). "
            "Set the DuckLake env vars before running this migration."
        )
    if not DB_PATH.exists():
        raise SystemExit(f"Local DuckDB file not found: {DB_PATH}")

    # Source: the old local file (read-only).
    src = duckdb.connect(str(DB_PATH), read_only=True)

    # Destination: the DuckLake (this triggers bootstrap → creates tables).
    dst = get_connection()

    print(f"Migrating {len(ALL_TABLES)} tables from {DB_PATH} → DuckLake")
    total_copied = 0
    for table in ALL_TABLES:
        # Confirm the table exists in the source (it may not if never seeded).
        try:
            src.execute(f"SELECT * FROM {table} LIMIT 1")
        except Exception:
            print(f"  {table}: not present in source — skipped")
            continue

        cols = [c[0] for c in src.execute(f"DESCRIBE {table}").fetchall()]
        n = 0
        conflict = CONFLICT_KEYS.get(table)
        rows = src.execute(f"SELECT {', '.join(cols)} FROM {table}").fetchall()
        for row in rows:
            row_dict = dict(zip(cols, row))
            if conflict:
                upsert_row(dst, table, row_dict, conflict)
            else:
                # No natural PK (e.g. greenblatt_scores) — plain insert.
                placeholders = ", ".join("?" for _ in cols)
                dst.execute(
                    f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders})",
                    list(row_dict.values()),
                )
            n += 1
        total_copied += n
        print(f"  {table}: {n} rows copied")

    print(f"\nDone. {total_copied} rows migrated to DuckLake.")
    print("Next: set DUCKLAKE_ENABLED=1 on the deployed backend and verify reads.")


if __name__ == "__main__":
    migrate()
