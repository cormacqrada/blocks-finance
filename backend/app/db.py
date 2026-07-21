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
    # AUTOMATIC_MIGRATION lets newer ducklake extensions upgrade catalogs created
    # by older builds (e.g. local 1.3.2 writes v0.2, Render 1.4.3 needs v1.0).
    db.execute(
        f"ATTACH 'ducklake:postgres:{pg_url}' AS lake "
        f"(DATA_PATH '{data_path}', AUTOMATIC_MIGRATION TRUE)"
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
    """Upsert many rows using the set-based bulk_upsert below."""
    return bulk_upsert(conn, table, rows, conflict_keys)


def bulk_upsert(
    conn: duckdb.DuckDBPyConnection,
    table: str,
    rows: List[Dict[str, Any]],
    conflict_keys: List[str],
    batch_size: int = 500,
) -> int:
    """Upsert many rows in a single transaction with set-based SQL.

    This is the fast path for ingestion: instead of one MERGE/DELETE+INSERT
    per row (one network round-trip per row on DuckLake), it deletes every
    conflicting row in one statement and inserts the whole batch with a
    single multi-row INSERT. N round-trips collapse to ~2.

    Rows may have heterogeneous keys (ingest rows often only set a subset of
    the table's columns). We union the column superset, NULL-fill missing
    columns per row, and chunk into `batch_size`-row statements so we never
    build a SQL literal larger than the engine likes.

    DELETE is keyed on the FULL conflict-key tuple (row-valued IN), so it only
    removes rows whose (ck1, ck2, ...) tuple matches an incoming row — never
    unrelated rows that merely share one key value (e.g. it will not wipe
    every row for a ticker when only a few dates are being upserted). When the
    incoming batch itself contains duplicate conflict-key tuples, the last
    occurrence wins (matching per-row upsert semantics) and only one row is
    inserted per tuple.

    Works on both plain DuckDB and DuckLake (no PK constraints required).
    Returns the number of rows upserted.
    """
    if not rows:
        return 0
    if not conflict_keys:
        raise ValueError("bulk_upsert requires at least one conflict_key")

    # Column superset across all rows (stable order for reproducible SQL).
    cols: List[str] = []
    seen = set()
    for r in rows:
        for k in r.keys():
            if k not in seen:
                seen.add(k)
                cols.append(k)
    if not cols:
        return 0

    # Dedupe incoming rows by conflict-key tuple, last occurrence wins, so a
    # batch with duplicate keys upserts cleanly instead of producing duplicate
    # rows (DELETE removes the prior match, INSERT adds exactly one per tuple).
    ck_idx = [cols.index(k) for k in conflict_keys if k in cols]
    if ck_idx and len(ck_idx) == len(conflict_keys):
        deduped: List[Dict[str, Any]] = []
        order: Dict[tuple, int] = {}
        for r in rows:
            key = tuple(r.get(k) for k in conflict_keys)
            order[key] = len(deduped)
            deduped.append(r)
        if len(order) < len(rows):
            keep = set(order.values())
            rows = [deduped[i] for i in sorted(keep)]

    # Fast path: when all rows share the same key set we can build a flat
    # VALUES list. Otherwise NULL-fill to the superset.
    uniform = all(set(r.keys()) == seen for r in rows)

    # Look up the conflict-key column types once so the DELETE's row-valued
    # IN-list can cast placeholders to the real column type. Without this,
    # `?` in a VALUES list defaults to VARCHAR and won't compare against a
    # DATE/numeric column (BinderException: cannot compare DATE and VARCHAR).
    ck_types = _column_types(conn, table, conflict_keys)

    total = 0
    for chunk_start in range(0, len(rows), batch_size):
        chunk = rows[chunk_start : chunk_start + batch_size]
        total += _bulk_upsert_chunk(conn, table, chunk, cols, conflict_keys, uniform, ck_types)
    return total


def _column_types(
    conn: duckdb.DuckDBPyConnection,
    table: str,
    conflict_keys: List[str],
) -> Dict[str, str]:
    """Return {column: duckdb_type_str} for the given conflict keys."""
    try:
        desc = conn.execute(f"DESCRIBE {table}").fetchall()
        # DESCRIBE rows: (name, type, null, key, default, extra)
        types = {row[0]: str(row[1]) for row in desc}
        return {k: types.get(k, "") for k in conflict_keys}
    except Exception:
        return {k: "" for k in conflict_keys}


def _bulk_upsert_chunk(
    conn: duckdb.DuckDBPyConnection,
    table: str,
    chunk: List[Dict[str, Any]],
    cols: List[str],
    conflict_keys: List[str],
    uniform: bool,
    ck_types: Dict[str, str],
) -> int:
    """One transaction: DELETE rows matching any incoming conflict-key tuple,
    then INSERT the chunk."""
    col_names = ", ".join(cols)
    placeholders_per_row = "(" + ", ".join("?" for _ in cols) + ")"
    values_clause = ", ".join(placeholders_per_row for _ in chunk)

    # Build the flat parameter list. For uniform rows we read cols directly;
    # otherwise NULL-fill missing columns so every row has the same arity.
    flat: List[Any] = []
    if uniform:
        for r in chunk:
            flat.extend(r[c] for c in cols)
    else:
        for r in chunk:
            flat.extend(r.get(c) for c in cols)

    # DELETE only rows whose FULL conflict-key tuple matches an incoming row,
    # using a row-valued IN-list. This is exact: it never removes a row that
    # merely shares one key value with an incoming row (which the old per-key
    # OR approach did, wiping e.g. all rows for a ticker when upserting a few
    # dates). Each placeholder is cast to the column's real type because `?`
    # in a VALUES list otherwise defaults to VARCHAR and won't compare against
    # a DATE/numeric column. DuckDB supports
    # `(c1, c2) IN (VALUES (CAST(? AS DATE), CAST(? AS BIGINT)), ...)`.
    ck_cols = "(" + ", ".join(conflict_keys) + ")"
    def _casted(k: str) -> str:
        t = ck_types.get(k, "") if ck_types else ""
        return f"CAST(? AS {t})" if t else "?"
    tuple_placeholder = "(" + ", ".join(_casted(k) for k in conflict_keys) + ")"
    tuples_clause = ", ".join(tuple_placeholder for _ in chunk)
    delete_params: List[Any] = []
    for r in chunk:
        delete_params.extend(r.get(k) for k in conflict_keys)
    delete_sql = f"DELETE FROM {table} WHERE {ck_cols} IN (VALUES {tuples_clause})"

    insert_sql = f"INSERT INTO {table} ({col_names}) VALUES {values_clause}"

    conn.execute("BEGIN")
    try:
        conn.execute(delete_sql, delete_params)
        conn.execute(insert_sql, flat)
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    return len(chunk)
