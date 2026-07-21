"""
Database connection layer.

Env-aware: uses DuckLake (Postgres catalog + Cloudflare R2 data) when
``DUCKLAKE_ENABLED=1`` and the required R2/PG credentials are present,
otherwise falls back to a local DuckDB file for zero-setup local dev.

This is the single source of truth for connections — every other module
calls ``get_connection()`` and never opens a DuckDB connection directly.

Also provides ``upsert_row()``, a constraint-free upsert helper that tries
``MERGE INTO`` first and falls back to ``DELETE``+``INSERT`` if the target
table cannot use MERGE (e.g. DuckLake tables have no PK/UNIQUE constraints).
The fallback decision is cached after the first probe so we don't pay the
try/catch cost on every row.
"""

from __future__ import annotations

import os
import threading
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

import duckdb

# Local-dev file path (used when DUCKLAKE_ENABLED is not set)
DB_PATH = Path(__file__).parent.parent / "data" / "finance.duckdb"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

# Module-level DuckLake instance + lock. We keep ONE in-memory DuckDB with the
# lake attached, and hand out cursors from it. Cursors share the attached lake
# but are independently thread-safe to use — the recommended DuckDB pattern for
# multi-request servers.
_lake_db: Optional[duckdb.DuckDBPyConnection] = None
_lake_lock = threading.Lock()

# Cached MERGE-vs-DELETE+INSERT decision for upsert_row.
# None = not probed yet; True = MERGE works; False = use DELETE+INSERT.
_merge_supported: Optional[bool] = None


# ─── DuckLake detection ───────────────────────────────────────────────────────

def _ducklake_enabled() -> bool:
    """True when DUCKLAKE_ENABLED is set AND the required creds are present."""
    if os.getenv("DUCKLAKE_ENABLED", "").strip().lower() not in ("1", "true", "yes"):
        return False
    required = ["R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT"]
    if any(not os.getenv(v) for v in required):
        return False
    if not (os.getenv("PG_CATALOG_URL") or os.getenv("PG_CATALOG_HOST")):
        return False
    return True


def _build_ducklake() -> duckdb.DuckDBPyConnection:
    """Create an in-memory DuckDB, load extensions, configure R2 secret,
    ATTACH the DuckLake (Postgres catalog + R2 data path), and return it.

    Called once under _lake_lock; callers get cursors via get_connection().
    """
    db = duckdb.connect(":memory:")

    # Load the extensions DuckLake needs. INSTALL is idempotent; LOAD makes
    # them available in this connection.
    db.execute("INSTALL ducklake; LOAD ducklake;")
    db.execute("INSTALL postgres; LOAD postgres;")
    db.execute("INSTALL httpfs; LOAD httpfs;")

    # R2 is S3-compatible. URL_STYLE 'path' + REGION 'auto' works for R2.
    r2_endpoint = os.getenv("R2_ENDPOINT", "").rstrip("/")
    # Strip the scheme for the ENDPOINT param (DuckDB wants host[:port])
    if r2_endpoint.startswith("https://"):
        r2_endpoint = r2_endpoint[len("https://"):]
    elif r2_endpoint.startswith("http://"):
        r2_endpoint = r2_endpoint[len("http://"):]

    db.execute(
        """
        CREATE OR REPLACE SECRET r2_secret (
            TYPE S3,
            KEY_ID ?,
            SECRET ?,
            ENDPOINT ?,
            URL_STYLE 'path',
            REGION 'auto',
            USE_SSL true
        )
        """,
        [
            os.getenv("R2_ACCESS_KEY_ID", ""),
            os.getenv("R2_SECRET_ACCESS_KEY", ""),
            r2_endpoint,
        ],
    )

    # Postgres catalog connection string. Prefer a full URL, else assemble
    # from parts. Neon requires sslmode=require.
    pg_url = os.getenv("PG_CATALOG_URL")
    if not pg_url:
        pg_url = (
            f"dbname={os.getenv('PG_CATALOG_DBNAME', 'neondb')} "
            f"host={os.getenv('PG_CATALOG_HOST')} "
            f"port={os.getenv('PG_CATALOG_PORT', '5432')} "
            f"user={os.getenv('PG_CATALOG_USER')} "
            f"password={os.getenv('PG_CATALOG_PASSWORD')} "
            f"sslmode=require"
        )
    elif "sslmode" not in pg_url:
        pg_url = pg_url + ("&" if "?" in pg_url else "?") + "sslmode=require"

    bucket = os.getenv("R2_BUCKET", "").strip("/")
    data_path = f"s3://{bucket}/lake/"

    # ATTACH creates the DuckLake if absent (create_if_not_exists defaults true).
    db.execute(
        f"ATTACH 'ducklake:postgres:{pg_url}' AS lake (DATA_PATH '{data_path}')"
    )
    db.execute("USE lake")
    # Bootstrap schema + seed reference data on the fresh lake.
    _bootstrap(db)
    return db


# ─── Public connection API ────────────────────────────────────────────────────

def get_connection() -> duckdb.DuckDBPyConnection:
    """Return a connection to the active database.

    - DuckLake mode: a cursor on the shared in-memory DuckDB (cheap, safe to
      use per-request; the underlying lake attachment is created once).
    - Local-dev mode: a cached singleton connection to the local .duckdb file.

    Callers must NOT close the returned connection in DuckLake mode (it's a
    cursor on a shared db); in local mode the singleton is intentionally
    long-lived.
    """
    if _ducklake_enabled():
        global _lake_db
        if _lake_db is None:
            with _lake_lock:
                if _lake_db is None:  # double-checked locking
                    _lake_db = _build_ducklake()
        # NOTE: a fresh cursor does NOT inherit the parent connection's `USE lake`
        # default-database setting — unqualified table names (e.g. `FROM greenblatt_scores`)
        # would resolve against the empty in-memory `main` schema and raise
        # CatalogException. Re-establishing the default schema on each cursor fixes
        # every existing unqualified query without having to qualify ~60 call sites.
        cur = _lake_db.cursor()
        cur.execute("USE lake")
        return cur
    return _get_local_connection()


@lru_cache(maxsize=1)
def _get_local_connection() -> duckdb.DuckDBPyConnection:
    """Singleton local-file connection (dev mode). Bootstraps schema + seeds."""
    conn = duckdb.connect(str(DB_PATH))
    _bootstrap(conn)
    return conn


def _bootstrap(conn: duckdb.DuckDBPyConnection) -> None:
    """Create tables + seed reference data. Lazy-imported to avoid a circular
    import (seed.py imports upsert_row from this module)."""
    from app.seed import bootstrap
    bootstrap(conn)


def is_ducklake() -> bool:
    """True when the active backend is DuckLake (useful for migration/ingest logic)."""
    return _ducklake_enabled()


# ─── Constraint-free upsert helper ────────────────────────────────────────────

def upsert_row(
    conn: duckdb.DuckDBPyConnection,
    table: str,
    row: Dict[str, Any],
    conflict_keys: List[str],
) -> None:
    """Insert ``row`` into ``table``, or update the existing row matched by
    ``conflict_keys`` if one already exists.

    Works on BOTH the local DuckDB file (which has PK constraints) and DuckLake
    tables (which have no constraints). Tries ``MERGE INTO`` first because it is
    single-statement and atomic; falls back to ``DELETE`` + ``INSERT`` wrapped
    in a transaction if MERGE is unsupported on the target.

    ``row`` is an ordered dict of {column: value}; ``conflict_keys`` is the
    subset of columns that identify the row.
    """
    global _merge_supported
    cols = list(row.keys())
    values = list(row.values())
    if not cols:
        return

    if _merge_supported is not False:
        try:
            _merge_upsert(conn, table, cols, values, conflict_keys)
            if _merge_supported is None:
                _merge_supported = True
            return
        except Exception as e:
            # If MERGE fails (e.g. DuckLake rejects it), flip the flag once
            # and fall through to DELETE+INSERT. We probe on a real call rather
            # than a synthetic one to avoid touching tables unnecessarily.
            if _merge_supported is None:
                _merge_supported = False
                # Log once; not every row (the flag is cached).
                print(f"[db] MERGE INTO unsupported on {table}, falling back to "
                      f"DELETE+INSERT: {type(e).__name__}: {e}")
            else:
                # Already using fallback and it still failed — real error.
                raise

    _delete_insert_upsert(conn, table, cols, values, conflict_keys)


def _merge_upsert(
    conn: duckdb.DuckDBPyConnection,
    table: str,
    cols: List[str],
    values: List[Any],
    conflict_keys: List[str],
) -> None:
    """MERGE INTO ... USING (VALUES (...)) ... — single-statement upsert."""
    placeholders = ", ".join("?" for _ in cols)
    src_aliases = ", ".join(cols)  # name the VALUES columns after the real cols
    on_clause = " AND ".join(f"t.{k} = src.{k}" for k in conflict_keys)
    set_clause = ", ".join(
        f"t.{c} = src.{c}" for c in cols if c not in conflict_keys
    )
    insert_cols = ", ".join(cols)
    insert_vals = ", ".join(f"src.{c}" for c in cols)

    sql = (
        f"MERGE INTO {table} t "
        f"USING (VALUES ({placeholders})) AS src({src_aliases}) "
        f"ON {on_clause} "
        f"WHEN MATCHED THEN UPDATE SET {set_clause} "
        f"WHEN NOT MATCHED THEN INSERT ({insert_cols}) VALUES ({insert_vals})"
    )
    conn.execute(sql, values)


def _delete_insert_upsert(
    conn: duckdb.DuckDBPyConnection,
    table: str,
    cols: List[str],
    values: List[Any],
    conflict_keys: List[str],
) -> None:
    """DELETE the matching row then INSERT the new one, in one transaction."""
    where = " AND ".join(f"{k} = ?" for k in conflict_keys)
    delete_vals = [values[cols.index(k)] for k in conflict_keys]
    placeholders = ", ".join("?" for _ in cols)
    col_names = ", ".join(cols)

    conn.execute("BEGIN")
    try:
        conn.execute(f"DELETE FROM {table} WHERE {where}", delete_vals)
        conn.execute(
            f"INSERT INTO {table} ({col_names}) VALUES ({placeholders})", values
        )
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


def upsert_rows(
    conn: duckdb.DuckDBPyConnection,
    table: str,
    rows: List[Dict[str, Any]],
    conflict_keys: List[str],
) -> int:
    """Upsert many rows. Returns count inserted. Each row is upserted in its
    own statement (batching MERGE across heterogeneous rows is awkward); this
    matches the existing per-row ingest pattern."""
    count = 0
    for row in rows:
        upsert_row(conn, table, row, conflict_keys)
        count += 1
    return count
