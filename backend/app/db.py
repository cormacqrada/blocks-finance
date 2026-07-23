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
    """Upsert many rows set-based: one MERGE INTO per chunk, all chunks inside
    a single BEGIN/COMMIT so each ingest call is all-or-nothing.

    Design notes:
    - MERGE INTO is one statement (one round trip) and atomic — no window
      where rows are deleted but not yet reinserted, unlike DELETE+INSERT.
      DuckLake has no PK/UNIQUE constraints, but MERGE needs none: it matches
      on an explicit ON clause, not a constraint. We still probe once and fall
      back to DELETE+INSERT (same as upsert_row) because some DuckLake builds
      reject MERGE; the fallback keeps the same single-transaction guarantee.
    - DuckDB's parameter binder has a ceiling well below a full FMP universe,
      so we chunk into ~`batch_size`-row MERGE statements. One BEGIN/COMMIT
      wraps the whole loop, so a failure rolls back every chunk for this call.
    - The VALUES-derived source table's column types are inferred from the
      first row; if FMP returns None/mixed types, later rows get silently
      coerced. We cast every placeholder to the target column's real type
      (via DESCRIBE) so the source table is typed correctly regardless of
      the first row's values.
    - Rows may be heterogeneous (ingest rows set a subset of columns). We
      union the column superset and NULL-fill missing columns per row.
    - Duplicate conflict-key tuples within a batch: last occurrence wins
      (matching per-row upsert semantics). NULL conflict keys never satisfy
      MATCHED (so MERGE would insert a new row each time); callers should keep
      conflict keys non-NULL, and run count_duplicate_keys() after the first
      real bulk run to confirm the table is clean.

    Works on plain DuckDB and DuckLake. Returns the number of rows upserted.
    """
    global _merge_supported
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

    # Dedupe incoming rows by conflict-key tuple, last occurrence wins.
    if all(k in seen for k in conflict_keys):
        deduped: List[Dict[str, Any]] = []
        order: Dict[tuple, int] = {}
        for r in rows:
            key = tuple(r.get(k) for k in conflict_keys)
            order[key] = len(deduped)
            deduped.append(r)
        if len(order) < len(rows):
            keep = set(order.values())
            rows = [deduped[i] for i in sorted(keep)]

    # Fast path: uniform rows share the same key set → flat VALUES list.
    uniform = all(set(r.keys()) == seen for r in rows)

    # Type every column (not just conflict keys) so the MERGE source table is
    # typed correctly. DESCRIBE is one cheap call per ingest.
    col_types = _table_types(conn, table)

    chunks = [rows[i : i + batch_size] for i in range(0, len(rows), batch_size)]

    # Try the MERGE path. If the first chunk reveals MERGE is unsupported on
    # this target (e.g. some DuckLake builds), roll back, flip the cached flag,
    # and redo the whole call with the DELETE+INSERT fallback in a fresh tx.
    if _merge_supported is not False:
        try:
            conn.execute("BEGIN")
            n = 0
            for chunk in chunks:
                _merge_chunk(conn, table, chunk, cols, conflict_keys, uniform, col_types)
                n += len(chunk)
            conn.execute("COMMIT")
            if _merge_supported is None:
                _merge_supported = True
            return n
        except Exception as e:
            try:
                conn.execute("ROLLBACK")
            except Exception:
                pass
            if _merge_supported is None:
                # First-ever probe failed → cache and fall back. Log once.
                _merge_supported = False
                print(f"[db] bulk MERGE unsupported on {table}, falling back to "
                      f"DELETE+INSERT: {type(e).__name__}: {e}")
                # fall through to DELETE+INSERT path below
            else:
                raise

    # DELETE+INSERT fallback (also the path when _merge_supported is False).
    conn.execute("BEGIN")
    try:
        n = 0
        for chunk in chunks:
            _delete_insert_chunk(conn, table, chunk, cols, conflict_keys, uniform, col_types)
            n += len(chunk)
        conn.execute("COMMIT")
    except Exception:
        try:
            conn.execute("ROLLBACK")
        except Exception:
            pass
        raise
    return n


def _table_types(
    conn: duckdb.DuckDBPyConnection,
    table: str,
) -> Dict[str, str]:
    """Return {column: duckdb_type_str} for ALL columns of `table`.

    Used to cast every placeholder in the MERGE source VALUES list so the
    derived source table is typed correctly even when the first row has NULLs.
    """
    try:
        desc = conn.execute(f"DESCRIBE {table}").fetchall()
        # DESCRIBE rows: (name, type, null, key, default, extra)
        return {row[0]: str(row[1]) for row in desc}
    except Exception:
        return {}


def _casted_placeholder(col: str, col_types: Dict[str, str]) -> str:
    """CAST(? AS <type>) if we know the column type, else bare `?`."""
    t = col_types.get(col, "") if col_types else ""
    return f"CAST(? AS {t})" if t else "?"


def _flat_params(chunk: List[Dict[str, Any]], cols: List[str], uniform: bool) -> List[Any]:
    """Flatten chunk rows into one parameter list in `cols` order."""
    flat: List[Any] = []
    if uniform:
        for r in chunk:
            flat.extend(r[c] for c in cols)
    else:
        for r in chunk:
            flat.extend(r.get(c) for c in cols)
    return flat


def _merge_chunk(
    conn: duckdb.DuckDBPyConnection,
    table: str,
    chunk: List[Dict[str, Any]],
    cols: List[str],
    conflict_keys: List[str],
    uniform: bool,
    col_types: Dict[str, str],
) -> None:
    """Run one MERGE INTO for the chunk (no transaction control — caller wraps)."""
    src_cols = ", ".join(cols)
    casted_row = "(" + ", ".join(_casted_placeholder(c, col_types) for c in cols) + ")"
    values_clause = ", ".join(casted_row for _ in chunk)

    on_clause = " AND ".join(f"t.{k} = src.{k}" for k in conflict_keys)
    set_cols = [c for c in cols if c not in conflict_keys]
    set_clause = ", ".join(f"t.{c} = src.{c}" for c in set_cols) if set_cols else None
    insert_cols = ", ".join(cols)
    insert_vals = ", ".join(f"src.{c}" for c in cols)
    matched = f"WHEN MATCHED THEN UPDATE SET {set_clause} " if set_clause else ""

    sql = (
        f"MERGE INTO {table} t "
        f"USING (VALUES {values_clause}) AS src({src_cols}) "
        f"ON {on_clause} "
        f"{matched}"
        f"WHEN NOT MATCHED THEN INSERT ({insert_cols}) VALUES ({insert_vals})"
    )
    conn.execute(sql, _flat_params(chunk, cols, uniform))


def _delete_insert_chunk(
    conn: duckdb.DuckDBPyConnection,
    table: str,
    chunk: List[Dict[str, Any]],
    cols: List[str],
    conflict_keys: List[str],
    uniform: bool,
    col_types: Dict[str, str],
) -> None:
    """DELETE matching conflict-key tuples then INSERT the chunk.

    No transaction control here — the caller (bulk_upsert) wraps all chunks in
    one BEGIN/COMMIT so a failure rolls back the whole call.
    """
    col_names = ", ".join(cols)
    placeholders_per_row = "(" + ", ".join("?" for _ in cols) + ")"
    values_clause = ", ".join(placeholders_per_row for _ in chunk)

    # Row-valued IN on the FULL conflict-key tuple so we only delete exact
    # matches (never a row that merely shares one key value). Placeholders are
    # cast to the real column types because `?` in a VALUES list otherwise
    # defaults to VARCHAR and won't compare against DATE/numeric columns.
    ck_cols = "(" + ", ".join(conflict_keys) + ")"
    tuple_placeholder = "(" + ", ".join(_casted_placeholder(k, col_types) for k in conflict_keys) + ")"
    tuples_clause = ", ".join(tuple_placeholder for _ in chunk)
    delete_params: List[Any] = []
    for r in chunk:
        delete_params.extend(r.get(k) for k in conflict_keys)
    delete_sql = f"DELETE FROM {table} WHERE {ck_cols} IN (VALUES {tuples_clause})"
    insert_sql = f"INSERT INTO {table} ({col_names}) VALUES {values_clause}"

    conn.execute(delete_sql, delete_params)
    conn.execute(insert_sql, _flat_params(chunk, cols, uniform))


def count_duplicate_keys(
    conn: duckdb.DuckDBPyConnection,
    table: str,
    conflict_keys: List[str],
) -> List[dict]:
    """Return rows that violate the logical (conflict_keys) uniqueness.

    DuckLake can't enforce (ticker, as_of, ...) uniqueness as a constraint, and
    a NULL in a conflict key never satisfies MERGE MATCHED, so a bad batch can
    silently insert duplicates instead of updating. Run this after the first
    real bulk run to confirm the table is clean:
        count_duplicate_keys(conn, 'fundamentals', ['ticker', 'as_of'])
    Returns [] when clean, else [{'keys': {...}, 'count': N}, ...].
    """
    key_cols = ", ".join(conflict_keys)
    having = " AND ".join(f"{k} IS NOT NULL" for k in conflict_keys)
    rows = conn.execute(
        f"SELECT {key_cols}, COUNT(*) AS n FROM {table} "
        f"GROUP BY {key_cols} HAVING COUNT(*) > 1{' AND ' + having if having else ''} "
        f"ORDER BY n DESC LIMIT 100"
    ).fetchall()
    return [
        {"keys": {k: v for k, v in zip(conflict_keys, row[:-1])}, "count": int(row[-1])}
        for row in rows
    ]
