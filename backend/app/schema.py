"""
Schema definitions for the finance database.

All ``CREATE TABLE`` statements live here, separate from the connection
factory (``app.db``) and the route layer (``app.main``). This is the single
source of truth for table shapes.

DuckLake note: DuckLake does not support PRIMARY KEY / FOREIGN KEY / UNIQUE /
CHECK constraints, so none of the DDL below includes them. The logical
"primary key" of each table is recorded in ``CONFLICT_KEYS`` so that
``db.upsert_row()`` can dedupe rows by those columns without needing a real
constraint. This works on both DuckLake and plain DuckDB.

Call ``create_all_tables(conn)`` once on a fresh connection to bootstrap the
schema (idempotent via ``IF NOT EXISTS``).
"""

from __future__ import annotations

import duckdb

# ─── Table DDL (constraint-free, DuckLake-compatible) ─────────────────────────
# Keep these in dependency order (independent tables first). All use
# IF NOT EXISTS so running on an existing DB is safe.

_TABLE_DDL: list[str] = [
    # ── Core domain ───────────────────────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS securities (
        ticker TEXT,
        company_name TEXT,
        sector TEXT,
        industry TEXT,
        exchange TEXT,
        country TEXT,
        updated_at TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS price_history (
        ticker TEXT,
        date DATE,
        open DOUBLE,
        high DOUBLE,
        low DOUBLE,
        close DOUBLE,
        adj_close DOUBLE,
        volume BIGINT,
        data_source TEXT,
        fetched_at TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS earnings_history (
        ticker TEXT,
        date DATE,
        period TEXT,
        eps DOUBLE,
        eps_estimate DOUBLE,
        revenue DOUBLE,
        revenue_estimate DOUBLE,
        surprise_pct DOUBLE,
        data_source TEXT,
        fetched_at TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS fundamentals_history (
        ticker TEXT,
        date DATE,
        period TEXT,
        gross_margin DOUBLE,
        operating_margin DOUBLE,
        net_margin DOUBLE,
        roic DOUBLE,
        roe DOUBLE,
        debt_to_equity DOUBLE,
        fcf DOUBLE,
        shares_outstanding DOUBLE,
        data_source TEXT,
        fetched_at TIMESTAMP
    )
    """,
    # ── SEC EDGAR ──────────────────────────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS institutional_holdings (
        ticker TEXT,
        holder_cik TEXT,
        holder_name TEXT,
        filing_date DATE,
        report_date DATE,
        shares BIGINT,
        value DOUBLE,
        pct_of_portfolio DOUBLE,
        change_shares BIGINT,
        change_pct DOUBLE,
        data_source TEXT,
        fetched_at TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS insider_transactions (
        ticker TEXT,
        filing_date DATE,
        trade_date DATE,
        insider_name TEXT,
        insider_title TEXT,
        transaction_type TEXT,
        shares BIGINT,
        price DOUBLE,
        value DOUBLE,
        shares_owned_after BIGINT,
        data_source TEXT,
        fetched_at TIMESTAMP
    )
    """,
    # ── Finnhub ────────────────────────────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS company_news (
        id TEXT,
        ticker TEXT,
        datetime TIMESTAMP,
        headline TEXT,
        summary TEXT,
        source TEXT,
        url TEXT,
        sentiment DOUBLE,
        data_source TEXT,
        fetched_at TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS analyst_recommendations (
        ticker TEXT,
        date DATE,
        strong_buy INTEGER,
        buy INTEGER,
        hold INTEGER,
        sell INTEGER,
        strong_sell INTEGER,
        data_source TEXT,
        fetched_at TIMESTAMP
    )
    """,
    # ── FRED ───────────────────────────────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS macro_indicators (
        series_id TEXT,
        date DATE,
        value DOUBLE,
        series_name TEXT,
        units TEXT,
        data_source TEXT,
        fetched_at TIMESTAMP
    )
    """,
    # ── Fundamentals (wide table) ──────────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS fundamentals (
        ticker TEXT,
        as_of DATE,

        company_name TEXT,
        sector TEXT,
        industry TEXT,

        ebit DOUBLE,
        enterprise_value DOUBLE,
        net_working_capital DOUBLE,

        revenue DOUBLE,
        revenue_growth_yoy DOUBLE,

        gross_margin DOUBLE,
        operating_margin DOUBLE,
        net_margin DOUBLE,

        free_cash_flow DOUBLE,
        fcf_yield DOUBLE,

        total_debt DOUBLE,
        total_equity DOUBLE,
        debt_to_equity DOUBLE,
        interest_coverage DOUBLE,

        book_value DOUBLE,
        tangible_book_value DOUBLE,
        book_value_per_share DOUBLE,

        market_cap DOUBLE,
        price DOUBLE,
        shares_outstanding DOUBLE,

        pe_ratio DOUBLE,
        pb_ratio DOUBLE,
        ps_ratio DOUBLE,
        ev_to_ebitda DOUBLE,
        ev_to_fcf DOUBLE,

        dividend_yield DOUBLE,
        payout_ratio DOUBLE,

        eps DOUBLE,
        eps_growth_yoy DOUBLE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS greenblatt_scores (
        ticker TEXT,
        as_of DATE,
        earnings_yield DOUBLE,
        return_on_capital DOUBLE,
        rank INTEGER
    )
    """,
    # ── Formula engine ─────────────────────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS formula_definitions (
        id TEXT,
        name TEXT NOT NULL,
        expression TEXT NOT NULL,
        description TEXT,
        category TEXT,
        output_format TEXT,
        created_by TEXT,
        is_system BOOLEAN,
        created_at TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS computed_metrics (
        ticker TEXT,
        as_of DATE,
        metric_name TEXT,
        formula_id TEXT,
        value DOUBLE,
        computed_at TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS screen_definitions (
        id TEXT,
        name TEXT NOT NULL,
        description TEXT,
        filters TEXT,
        rank_by TEXT,
        rank_order TEXT,
        columns TEXT,
        created_by TEXT,
        is_system BOOLEAN,
        created_at TIMESTAMP
    )
    """,
    # ── Taxonomy & ETF overlay ─────────────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS taxonomy_map (
        ticker TEXT,
        macro_sector TEXT,
        industry_cluster TEXT,
        business_model_group TEXT,
        themes TEXT,
        override_source TEXT,
        updated_at TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS etf_ticker_mapping (
        ticker TEXT,
        etf_symbol TEXT,
        etf_type TEXT,
        weight_pct DOUBLE,
        as_of DATE
    )
    """,
    # ── Computed score tables ──────────────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS value_compression_scores (
        ticker TEXT,
        as_of DATE,
        operational_stability DOUBLE,
        valuation_compression DOUBLE,
        shareholder_yield_pct DOUBLE,
        ivrv_pct DOUBLE,
        market_cap DOUBLE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS vrr_positions (
        ticker TEXT,
        as_of DATE,
        vrr_pct DOUBLE,
        spread_pct DOUBLE,
        velocity DOUBLE,
        velocity_label TEXT,
        current_price DOUBLE,
        intrinsic_value DOUBLE,
        marginal_irr_3yr DOUBLE,
        marginal_irr_7yr DOUBLE,
        kelly_fraction DOUBLE,
        action TEXT,
        market_cap DOUBLE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS compounding_discount_monitor (
        ticker TEXT,
        as_of DATE,
        pb_ratio DOUBLE,
        bvps_cagr_5yr DOUBLE,
        bvps_cagr_10yr DOUBLE,
        look_through_pb DOUBLE,
        arbitrage_gap DOUBLE,
        family_stake_pct DOUBLE,
        family_stake_flag BOOLEAN,
        quadrant TEXT,
        roe DOUBLE,
        tangible_bvps DOUBLE,
        net_cash_per_share DOUBLE,
        market_cap DOUBLE
    )
    """,
    # ── User-writable tables ───────────────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS portfolio_holdings (
        ticker TEXT,
        buy_date DATE,
        buy_price DOUBLE,
        shares DOUBLE,
        cost_basis DOUBLE,
        sector TEXT,
        notes TEXT,
        created_at TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS signal_strength_tracker (
        ticker TEXT,
        signal_date DATE,
        signal_type TEXT,
        signal_value DOUBLE,
        signal_label TEXT,
        return_1mo DOUBLE,
        return_3mo DOUBLE,
        return_6mo DOUBLE,
        return_1yr DOUBLE,
        was_correct BOOLEAN,
        computed_at TIMESTAMP
    )
    """,
]

# ─── Conflict keys (logical primary keys) ─────────────────────────────────────
# Maps table name → the columns that uniquely identify a row. Used by
# db.upsert_row() for dedup without a real constraint. Mirrors the former
# PRIMARY KEY clauses.
CONFLICT_KEYS: dict[str, list[str]] = {
    "securities": ["ticker"],
    "price_history": ["ticker", "date"],
    "earnings_history": ["ticker", "date", "period"],
    "fundamentals_history": ["ticker", "date"],
    "institutional_holdings": ["ticker", "holder_cik", "report_date"],
    "insider_transactions": ["ticker", "filing_date", "insider_name", "transaction_type"],
    "company_news": ["id"],
    "analyst_recommendations": ["ticker", "date"],
    "macro_indicators": ["series_id", "date"],
    "fundamentals": ["ticker", "as_of"],
    "computed_metrics": ["ticker", "as_of", "metric_name"],
    "formula_definitions": ["id"],
    "screen_definitions": ["id"],
    "taxonomy_map": ["ticker"],
    "etf_ticker_mapping": ["ticker", "etf_symbol"],
    "value_compression_scores": ["ticker", "as_of"],
    "vrr_positions": ["ticker", "as_of"],
    "compounding_discount_monitor": ["ticker", "as_of"],
    "portfolio_holdings": ["ticker", "buy_date"],
    "signal_strength_tracker": ["ticker", "signal_date", "signal_type"],
    # greenblatt_scores has no natural PK (recomputed wholesale); not listed.
}

# Tables that are wholesale-recomputed by the compute_* endpoints (DELETE all
# then INSERT SELECT). These don't need upsert; they need fast bulk delete.
# Registry only — all of these are also in _TABLE_DDL above.
RECOMPUTED_TABLES: tuple[str, ...] = (
    "greenblatt_scores",
    "value_compression_scores",
    "vrr_positions",
    "compounding_discount_monitor",
    "signal_strength_tracker",
)

# Ordered, de-duplicated list of all table names (useful for migrations).
_TABLE_NAMES: list[str] = []
for _ddl in _TABLE_DDL:
    _name = _ddl.split("CREATE TABLE IF NOT EXISTS")[1].split("(")[0].strip()
    if _name not in _TABLE_NAMES:
        _TABLE_NAMES.append(_name)
ALL_TABLES: tuple[str, ...] = tuple(_TABLE_NAMES)


# Columns added to existing tables after their initial creation. CREATE TABLE
# IF NOT EXISTS is a no-op on an existing table, so new columns must be added
# via ALTER TABLE. Each entry is (table, column, duckdb_type). Safe to re-run
# thanks to IF NOT EXISTS; wrapped in try/except at call site so a failure on
# one column (e.g. DuckLake metadata quirk) never blocks boot.
_COLUMN_MIGRATIONS: list[tuple[str, str, str]] = [
    ("fundamentals", "ev_to_fcf", "DOUBLE"),
]


def _migrate_columns(conn: duckdb.DuckDBPyConnection) -> None:
    """Add columns introduced after a table was first created (idempotent)."""
    for table, column, dtype in _COLUMN_MIGRATIONS:
        try:
            conn.execute(
                f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {dtype}"
            )
        except Exception as e:
            print(
                f"[schema] ALTER {table} ADD {column} skipped: "
                f"{type(e).__name__}: {e}"
            )


def create_all_tables(conn: duckdb.DuckDBPyConnection) -> None:
    """Create every table if it does not already exist, then migrate columns.

    On DuckLake this creates lake tables (no constraints). On a local DuckDB
    file this creates plain tables. Existing tables are left untouched by
    CREATE, then _migrate_columns adds any new columns via ALTER TABLE.
    """
    for ddl in _TABLE_DDL:
        conn.execute(ddl)
    _migrate_columns(conn)
