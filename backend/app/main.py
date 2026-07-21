import json
import os
from datetime import datetime
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, List, TypedDict, Optional

import duckdb
import httpx

# Load environment variables from .env file (for FMP_API_KEY, etc.)
load_dotenv()

from app.formula_engine import (
    FormulaEngine,
    evaluate_formula_for_universe,
    compute_all_formulas,
    FUNDAMENTALS_FIELDS,
)
from app.taxonomy import (
    TAXONOMY_HIERARCHY,
    CUSTOM_THEMES,
    DEFAULT_TICKER_TAXONOMY,
    get_full_taxonomy_tree,
    get_macro_sectors,
    get_industry_clusters,
    get_business_model_groups,
    get_themes,
    validate_taxonomy,
)

# Sector ETF symbol -> display name for "Group by ETF" view
SECTOR_ETF_LABELS: dict = {
    "XLK": "Technology",
    "XLF": "Financials",
    "XLE": "Energy",
    "XLV": "Healthcare",
    "XLI": "Industrials",
    "XLY": "Consumer Discretionary",
    "XLP": "Consumer Staples",
    "XLU": "Utilities",
    "XLB": "Materials",
    "XLRE": "Real Estate",
    "XLC": "Communication Services",
}


class FundamentalRow(TypedDict, total=False):
    """Extended fundamentals for value investing analysis."""
    ticker: str
    as_of: str  # ISO date string
    # Core Greenblatt fields
    ebit: float
    enterprise_value: float
    net_working_capital: float
    # Revenue & Growth
    revenue: float
    revenue_growth_yoy: float  # percentage
    # Margins (quality/moat indicators)
    gross_margin: float  # percentage
    operating_margin: float  # percentage
    net_margin: float  # percentage
    # Cash Flow
    free_cash_flow: float
    fcf_yield: float  # percentage
    # Balance Sheet / Leverage
    total_debt: float
    total_equity: float
    debt_to_equity: float
    interest_coverage: float
    # Book Value
    book_value: float
    tangible_book_value: float
    book_value_per_share: float
    # Market Data
    market_cap: float
    price: float
    shares_outstanding: float
    # Valuation Ratios
    pe_ratio: float
    pb_ratio: float
    ps_ratio: float
    ev_to_ebitda: float
    # Dividends
    dividend_yield: float  # percentage
    payout_ratio: float  # percentage
    # Earnings
    eps: float
    eps_growth_yoy: float  # percentage


class QueryGreenblattInput(TypedDict, total=False):
    universe: List[str]
    limit: int


# Connection layer, schema, and seeding live in dedicated modules so this
# file stays a thin route layer. See app/db.py, app/schema.py, app/seed.py.
from app.db import get_connection, upsert_row, is_ducklake
from app.schema import CONFLICT_KEYS


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start scheduled ingestion if enabled; shut down on exit."""
    from app.scheduler import get_scheduler
    sched = get_scheduler()
    if sched:
        sched.start()
    yield
    if sched:
        sched.shutdown(wait=False)


app = FastAPI(title="Blocks Finance Backend", lifespan=lifespan)

# CORS: allow local frontend dev servers to call this backend.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "*",  # dev-only; tighten in production
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    """Simple healthcheck endpoint for the generated backend."""
    return {"status": "ok"}


@app.get("/debug/fundamentals")
async def get_fundamentals() -> dict:
    """Debug endpoint: get raw fundamentals data."""
    conn = get_connection()
    rows = conn.execute(
        "SELECT ticker, as_of, ebit, enterprise_value, net_working_capital FROM fundamentals ORDER BY ticker"
    ).fetchall()
    
    return {
        "rows": [
            {
                "ticker": r[0],
                "as_of": str(r[1]),
                "ebit": r[2],
                "enterprise_value": r[3],
                "net_working_capital": r[4],
            }
            for r in rows
        ]
    }


@app.post("/debug/seed_sample_greenblatt")
async def seed_sample_greenblatt() -> dict:
    """Debug endpoint: seed comprehensive sample fundamentals data for value investing."""
    conn = get_connection()
    
    # Clear existing data
    conn.execute("DELETE FROM fundamentals")
    conn.execute("DELETE FROM greenblatt_scores")
    conn.execute("DELETE FROM computed_metrics")
    
    # Comprehensive sample data for value investing screens
    # Fields: ticker, as_of, ebit, ev, nwc, revenue, rev_growth, gross_margin, op_margin, net_margin,
    #         fcf, fcf_yield, debt, equity, d/e, int_cov, bv, tbv, bvps, mktcap, price, shares,
    #         pe, pb, ps, ev_ebitda, div_yield, payout, eps, eps_growth
    sample_data = [
        # Tech - High quality, expensive
        ("AAPL", "2024-01-01", 120000, 3000000, 50000, 385000, 8.0, 45.0, 31.0, 25.0,
         110000, 3.7, 110000, 62000, 1.77, 29.0, 62000, 50000, 4.0, 2900000, 185.0, 15700,
         28.5, 46.0, 7.5, 22.0, 0.5, 15.0, 6.5, 12.0),
        ("MSFT", "2024-01-01", 95000, 2800000, 45000, 230000, 15.0, 70.0, 42.0, 36.0,
         65000, 2.3, 80000, 200000, 0.40, 35.0, 200000, 180000, 27.0, 2700000, 380.0, 7400,
         35.0, 13.5, 11.7, 25.0, 0.7, 25.0, 11.0, 18.0),
        ("GOOGL", "2024-01-01", 75000, 1500000, 30000, 310000, 12.0, 57.0, 27.0, 22.0,
         70000, 4.7, 30000, 280000, 0.11, 95.0, 280000, 260000, 22.0, 1600000, 140.0, 12500,
         22.0, 5.7, 5.2, 15.0, 0.0, 0.0, 6.4, 25.0),
        ("META", "2024-01-01", 45000, 1200000, 20000, 135000, 20.0, 80.0, 35.0, 29.0,
         43000, 3.6, 35000, 125000, 0.28, 45.0, 125000, 110000, 48.0, 1100000, 470.0, 2600,
         32.0, 8.8, 8.1, 18.0, 0.4, 12.0, 14.8, 45.0),
        ("NVDA", "2024-01-01", 30000, 2000000, 35000, 61000, 125.0, 76.0, 54.0, 49.0,
         27000, 1.4, 10000, 42000, 0.24, 150.0, 42000, 38000, 1.7, 1800000, 730.0, 2500,
         60.0, 43.0, 30.0, 45.0, 0.02, 1.0, 12.0, 580.0),
        # Financials - Cheap, high yield
        ("JPM", "2024-01-01", 50000, 500000, 100000, 160000, 5.0, 0.0, 38.0, 32.0,
         45000, 9.0, 300000, 320000, 0.94, 5.0, 320000, 320000, 110.0, 520000, 180.0, 2900,
         11.0, 1.6, 3.3, 8.0, 2.4, 26.0, 16.5, 8.0),
        ("V", "2024-01-01", 20000, 600000, 40000, 33000, 10.0, 0.0, 67.0, 52.0,
         18000, 3.0, 20000, 35000, 0.57, 30.0, 35000, 30000, 17.0, 550000, 280.0, 2000,
         30.0, 15.7, 16.7, 25.0, 0.8, 22.0, 9.3, 15.0),
        # Healthcare - Stable, dividends
        ("JNJ", "2024-01-01", 25000, 450000, 30000, 85000, 2.0, 68.0, 25.0, 18.0,
         20000, 4.4, 35000, 75000, 0.47, 25.0, 75000, 45000, 31.0, 400000, 165.0, 2400,
         16.0, 5.3, 4.7, 12.0, 2.9, 45.0, 10.3, -5.0),
        ("PFE", "2024-01-01", 8000, 180000, 15000, 58000, -40.0, 65.0, 15.0, 10.0,
         12000, 6.7, 60000, 90000, 0.67, 6.0, 90000, 50000, 16.0, 160000, 28.0, 5600,
         11.0, 1.8, 2.8, 15.0, 5.8, 65.0, 2.5, -70.0),
        # Consumer - Stable moat
        ("KO", "2024-01-01", 12000, 300000, 8000, 46000, 3.0, 60.0, 28.0, 22.0,
         11000, 3.7, 45000, 25000, 1.8, 12.0, 25000, 10000, 5.8, 260000, 60.0, 4300,
         24.0, 10.4, 5.7, 20.0, 3.1, 75.0, 2.5, 5.0),
        ("PG", "2024-01-01", 18000, 400000, 5000, 84000, 4.0, 52.0, 22.0, 18.0,
         16000, 4.0, 35000, 50000, 0.70, 20.0, 50000, 35000, 21.0, 380000, 160.0, 2350,
         27.0, 7.6, 4.5, 18.0, 2.4, 65.0, 5.9, 3.0),
        # Industrials
        ("CAT", "2024-01-01", 15000, 180000, 25000, 67000, 12.0, 35.0, 22.0, 17.0,
         10000, 5.6, 50000, 20000, 2.5, 8.0, 20000, 15000, 38.0, 170000, 330.0, 500,
         15.0, 8.5, 2.5, 10.0, 1.5, 22.0, 22.0, 25.0),
        # Energy - High yield, cyclical
        ("XOM", "2024-01-01", 55000, 480000, 35000, 345000, -8.0, 32.0, 18.0, 14.0,
         35000, 7.3, 45000, 200000, 0.23, 50.0, 200000, 190000, 50.0, 450000, 110.0, 4100,
         12.0, 2.3, 1.3, 6.0, 3.4, 40.0, 9.2, -15.0),
        # Growth - Expensive, high growth
        ("TSLA", "2024-01-01", 8000, 800000, 15000, 97000, 18.0, 18.0, 9.0, 7.5,
         5000, 0.6, 5000, 60000, 0.08, 50.0, 60000, 55000, 19.0, 750000, 240.0, 3200,
         65.0, 12.5, 7.7, 50.0, 0.0, 0.0, 3.7, -20.0),
        ("AMZN", "2024-01-01", 35000, 1800000, 25000, 575000, 12.0, 47.0, 6.0, 5.0,
         30000, 1.7, 165000, 200000, 0.83, 8.0, 200000, 150000, 19.0, 1700000, 175.0, 10300,
         55.0, 8.5, 3.0, 35.0, 0.0, 0.0, 3.2, 150.0),
    ]
    
    # Insert with all fields
    conn.executemany(
        """
        INSERT INTO fundamentals (
            ticker, as_of, ebit, enterprise_value, net_working_capital,
            revenue, revenue_growth_yoy, gross_margin, operating_margin, net_margin,
            free_cash_flow, fcf_yield, total_debt, total_equity, debt_to_equity, interest_coverage,
            book_value, tangible_book_value, book_value_per_share, market_cap, price, shares_outstanding,
            pe_ratio, pb_ratio, ps_ratio, ev_to_ebitda, dividend_yield, payout_ratio, eps, eps_growth_yoy
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """,
        sample_data,
    )
    
    # Compute Greenblatt scores
    conn.execute("DELETE FROM greenblatt_scores")
    conn.execute(
        """
        INSERT INTO greenblatt_scores (ticker, as_of, earnings_yield, return_on_capital, rank)
        SELECT
            f.ticker,
            f.as_of,
            CASE WHEN f.enterprise_value > 0 THEN f.ebit / f.enterprise_value ELSE NULL END AS earnings_yield,
            CASE WHEN f.net_working_capital <> 0 THEN f.ebit / f.net_working_capital ELSE NULL END AS return_on_capital,
            ROW_NUMBER() OVER (ORDER BY
                CASE WHEN f.enterprise_value > 0 THEN f.ebit / f.enterprise_value ELSE -1 END DESC
            ) AS rank
        FROM fundamentals f
        """
    )
    
    fundamentals_count = conn.execute("SELECT COUNT(*) FROM fundamentals").fetchone()[0]
    scores_count = conn.execute("SELECT COUNT(*) FROM greenblatt_scores").fetchone()[0]
    
    # Compute formula metrics
    from app.formula_engine import compute_all_formulas
    metrics_count = compute_all_formulas(conn)
    
    # Compute value compression scores
    vc_count = _compute_value_compression(conn)
    
    return {
        "status": "seeded",
        "fundamentals_inserted": int(fundamentals_count),
        "scores_computed": int(scores_count),
        "formula_metrics_computed": metrics_count,
        "value_compression_computed": vc_count,
    }


@app.post("/mcp/finance.upsert_fundamentals")
async def upsert_fundamentals(payload: dict) -> dict:
    """MCP-style tool: upsert fundamentals rows into DuckDB.

    Input shape (loosely): {"rows": FundamentalRow[]}.
    This keeps provider-specific API calls (e.g. FMP) outside the HTTP surface.
    """

    rows: Iterable[FundamentalRow] = payload.get("rows", [])  # type: ignore[assignment]
    conn = get_connection()

    # Normalize into a DuckDB-friendly list of tuples.
    data = [
        (
            r["ticker"],
            r["as_of"],
            float(r["ebit"]),
            float(r["enterprise_value"]),
            float(r["net_working_capital"]),
        )
        for r in rows
    ]
    if data:
        conn.executemany(
            """
            INSERT INTO fundamentals (ticker, as_of, ebit, enterprise_value, net_working_capital)
            VALUES (?, ?, ?, ?, ?);
            """,
            data,
        )

    return {"inserted": len(data)}


@app.post("/mcp/finance.compute_greenblatt_scores")
async def compute_greenblatt_scores(payload: Optional[dict] = None) -> dict:
    """MCP-style tool: compute Greenblatt scores from fundamentals into greenblatt_scores.

    Input shape (optional): {"universe": string[] | string}.
    """

    payload = payload or {}
    universe = payload.get("universe")
    conn = get_connection()

    # Simple definition:
    #   earnings_yield      = ebit / enterprise_value
    #   return_on_capital   = ebit / net_working_capital
    #
    # We explicitly treat rows where we cannot compute EY or ROC as "N/A" and
    # push them to the bottom of the ranking list by using a two-level ORDER BY:
    #   1) valid rows (both metrics non-null) first
    #   2) then rows with missing metrics

    if isinstance(universe, str):
        universe = [universe]

    if universe:
        universe_filter = "WHERE f.ticker IN (%s)" % ",".join("?" for _ in universe)
        params: Iterable[object] = list(universe)
    else:
        universe_filter = ""
        params = []

    # Recompute scores from fundamentals.
    # When a universe filter is specified, only delete+recompute for those tickers.
    # When no universe, recompute all (existing behavior).
    if universe:
        delete_filter = "WHERE ticker IN (%s)" % ",".join("?" for _ in universe)
        delete_params: List[object] = list(universe)
    else:
        delete_filter = ""
        delete_params = []

    conn.execute(f"DELETE FROM greenblatt_scores {delete_filter}", delete_params)
    conn.execute(
        f"""
        INSERT INTO greenblatt_scores (ticker, as_of, earnings_yield, return_on_capital, rank)
        SELECT
            f.ticker,
            f.as_of,
            CASE WHEN f.enterprise_value > 0 THEN f.ebit / f.enterprise_value ELSE NULL END AS earnings_yield,
            CASE WHEN f.net_working_capital <> 0 THEN f.ebit / f.net_working_capital ELSE NULL END AS return_on_capital,
            ROW_NUMBER() OVER (
                ORDER BY
                    /* valid metrics first (0), missing metrics last (1) */
                    CASE
                        WHEN f.enterprise_value <= 0 OR f.net_working_capital = 0 OR f.ebit IS NULL
                            THEN 1
                        ELSE 0
                    END,
                    /* within valid rows, order by earnings_yield desc */
                    CASE WHEN f.enterprise_value > 0 THEN f.ebit / f.enterprise_value ELSE -1 END DESC
            ) AS rank
        FROM fundamentals f
        {universe_filter}
        """,
        params,
    )

    count = conn.execute("SELECT COUNT(*) FROM greenblatt_scores").fetchone()[0]
    return {"rows": int(count)}


@app.post("/mcp/finance.query_greenblatt_scores")
async def query_greenblatt_scores(payload: Optional[QueryGreenblattInput] = None) -> dict:
    """MCP-style tool: query Greenblatt scores from DuckDB.

    Input shape (optional): {"universe": string[] | string, "limit": number}.
    """

    payload = payload or {}
    universe = payload.get("universe")
    limit = payload.get("limit", 20) or 20
    conn = get_connection()

    # Auto-recompute if scores table is stale/empty relative to fundamentals.
    # This prevents the common scenario where ingestion runs but a partial
    # compute (e.g. for a single ticker) wiped all scores.
    score_count = conn.execute("SELECT COUNT(*) FROM greenblatt_scores").fetchone()[0]
    fund_count = conn.execute(
        "SELECT COUNT(DISTINCT ticker) FROM fundamentals"
    ).fetchone()[0]
    if score_count < fund_count * 0.5:
        _recompute_greenblatt(conn)

    params: List[object] = []
    where_clause = ""

    # Treat a special "default" sentinel as "no universe filter" for convenience.
    if isinstance(universe, str):
        if universe.strip().lower() == "default":
            universe = None
        else:
            universe = [universe]

    if isinstance(universe, list):
        cleaned = [u for u in universe if isinstance(u, str) and u.strip()]
        if cleaned:
            where_clause = "WHERE ticker IN (%s)" % ",".join("?" for _ in cleaned)
            params.extend(cleaned)

    params.append(int(limit))

    # Return only the latest as_of per ticker (avoid duplicate quarters)
    rows = conn.execute(
        f"""
        SELECT ticker, as_of, earnings_yield, return_on_capital, rank
        FROM (
            SELECT *,
                   ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY as_of DESC) AS _rn
            FROM greenblatt_scores
            {where_clause}
        ) sub
        WHERE _rn = 1
        ORDER BY rank ASC
        LIMIT ?
        """,
        params,
    ).fetchall()

    # Also fetch company_name from fundamentals for richer display
    result_rows = []
    for r in rows:
        name_row = conn.execute(
            "SELECT company_name FROM fundamentals WHERE ticker = ? ORDER BY as_of DESC LIMIT 1",
            [r[0]],
        ).fetchone()
        result_rows.append({
            "ticker": r[0],
            "company_name": name_row[0] if name_row else "",
            "as_of": str(r[1]),
            "earnings_yield": r[2],
            "return_on_capital": r[3],
            "rank": r[4],
        })

    return {"rows": result_rows}


# ============================================================================
# Value Compression Map MCP Endpoints
# =============================================================================


def _compute_value_compression(conn: duckdb.DuckDBPyConnection, universe: Optional[List[str]] = None) -> int:
    """Compute value compression composite scores from fundamentals.
    
    Scores are normalized to 0-100 using percentile ranking within the universe.
    
    Operational Stability = composite of margin stability, leverage resilience, FCF consistency
    Valuation Compression = composite of inverted valuation multiples, discount proxies
    Shareholder Yield = dividend yield + buyback proxy + debt paydown proxy
    IVRV = intrinsic value realization velocity proxies
    """
    if universe:
        universe_filter = "WHERE f.ticker IN (%s)" % ",".join("?" for _ in universe)
        params: List[Any] = list(universe)
    else:
        universe_filter = ""
        params = []
    
    conn.execute("DELETE FROM value_compression_scores")
    conn.execute(
        f"""
        INSERT INTO value_compression_scores (ticker, as_of, operational_stability, valuation_compression, shareholder_yield_pct, ivrv_pct, market_cap)
        SELECT
            f.ticker,
            f.as_of,
            -- Operational Stability (0-100): higher = more stable/durable
            LEAST(100, GREATEST(0, 
                (  
                    -- Gross margin component (0-30): higher margin = more stable
                    LEAST(30, CASE WHEN f.gross_margin > 0 THEN f.gross_margin ELSE 0 END)
                    +
                    -- Operating margin component (0-25): consistent earnings
                    LEAST(25, CASE WHEN f.operating_margin > 0 THEN f.operating_margin ELSE 0 END)
                    +
                    -- Leverage resilience (0-25): low D/E = resilient
                    CASE 
                        WHEN f.debt_to_equity IS NULL OR f.debt_to_equity < 0.3 THEN 25
                        WHEN f.debt_to_equity < 0.7 THEN 18
                        WHEN f.debt_to_equity < 1.5 THEN 10
                        WHEN f.debt_to_equity < 3.0 THEN 4
                        ELSE 0
                    END
                    +
                    -- Interest coverage (0-20): high coverage = survivable
                    CASE 
                        WHEN f.interest_coverage > 10 THEN 20
                        WHEN f.interest_coverage > 5 THEN 15
                        WHEN f.interest_coverage > 2 THEN 8
                        WHEN f.interest_coverage > 1 THEN 3
                        ELSE 0
                    END
                )
            )) AS operational_stability,
            -- Valuation Compression (0-100): higher = more undervalued
            LEAST(100, GREATEST(0,
                (
                    -- EV/EBITDA component (0-25): lower = cheaper, inverted
                    CASE 
                        WHEN f.ev_to_ebitda > 0 AND f.ev_to_ebitda < 5 THEN 25
                        WHEN f.ev_to_ebitda >= 5 AND f.ev_to_ebitda < 10 THEN 18
                        WHEN f.ev_to_ebitda >= 10 AND f.ev_to_ebitda < 15 THEN 10
                        WHEN f.ev_to_ebitda >= 15 AND f.ev_to_ebitda < 25 THEN 5
                        WHEN f.ev_to_ebitda >= 25 THEN 0
                        ELSE 0
                    END
                    +
                    -- P/E component (0-25): lower = cheaper, inverted
                    CASE 
                        WHEN f.pe_ratio > 0 AND f.pe_ratio < 8 THEN 25
                        WHEN f.pe_ratio >= 8 AND f.pe_ratio < 15 THEN 18
                        WHEN f.pe_ratio >= 15 AND f.pe_ratio < 25 THEN 8
                        WHEN f.pe_ratio >= 25 AND f.pe_ratio < 40 THEN 3
                        ELSE 0
                    END
                    +
                    -- P/B component (0-25): trading below book = deep value
                    CASE 
                        WHEN f.pb_ratio > 0 AND f.pb_ratio < 0.8 THEN 25
                        WHEN f.pb_ratio >= 0.8 AND f.pb_ratio < 1.2 THEN 18
                        WHEN f.pb_ratio >= 1.2 AND f.pb_ratio < 2.5 THEN 8
                        WHEN f.pb_ratio >= 2.5 AND f.pb_ratio < 5 THEN 3
                        ELSE 0
                    END
                    +
                    -- FCF yield component (0-25): high yield = value
                    CASE 
                        WHEN f.fcf_yield > 8 THEN 25
                        WHEN f.fcf_yield > 5 THEN 18
                        WHEN f.fcf_yield > 3 THEN 12
                        WHEN f.fcf_yield > 1 THEN 6
                        WHEN f.fcf_yield > 0 THEN 3
                        ELSE 0
                    END
                )
            )) AS valuation_compression,
            -- Shareholder Yield %: dividend + buyback proxy + debt paydown proxy
            LEAST(100, GREATEST(0,
                COALESCE(f.dividend_yield, 0)
                + -- Buyback proxy: FCF yield minus payout ratio implies excess cash return
                CASE WHEN f.fcf_yield > 0 AND f.payout_ratio < 100 
                     THEN (f.fcf_yield * (1 - COALESCE(f.payout_ratio, 0) / 100)) 
                     ELSE 0 END
                + -- Debt paydown proxy: low leverage + FCF = capacity to reduce debt
                CASE WHEN f.debt_to_equity < 0.5 AND f.fcf_yield > 3 THEN 1.5
                     WHEN f.debt_to_equity < 1.0 AND f.fcf_yield > 5 THEN 1.0
                     ELSE 0 END
            )) AS shareholder_yield_pct,
            -- IVRV % (Intrinsic Value Realization Velocity): thesis is actively working
            LEAST(100, GREATEST(0,
                (
                    -- EPS growth acceleration (0-30)
                    CASE 
                        WHEN f.eps_growth_yoy > 30 THEN 30
                        WHEN f.eps_growth_yoy > 15 THEN 22
                        WHEN f.eps_growth_yoy > 5 THEN 14
                        WHEN f.eps_growth_yoy > 0 THEN 7
                        ELSE 0
                    END
                    +
                    -- Revenue growth (0-25): confirms business momentum
                    CASE 
                        WHEN f.revenue_growth_yoy > 20 THEN 25
                        WHEN f.revenue_growth_yoy > 10 THEN 18
                        WHEN f.revenue_growth_yoy > 3 THEN 10
                        WHEN f.revenue_growth_yoy > 0 THEN 5
                        ELSE 0
                    END
                    +
                    -- Improving capital allocation (0-25): rising margins + FCF
                    CASE 
                        WHEN f.operating_margin > 0 AND f.fcf_yield > 5 AND f.debt_to_equity < 1 THEN 25
                        WHEN f.operating_margin > 0 AND f.fcf_yield > 3 THEN 15
                        WHEN f.operating_margin > 0 THEN 8
                        ELSE 0
                    END
                    +
                    -- Dividend signal (0-20): consistent + growing
                    CASE 
                        WHEN f.dividend_yield > 2 AND f.payout_ratio < 60 THEN 20
                        WHEN f.dividend_yield > 1 AND f.payout_ratio < 80 THEN 12
                        WHEN f.dividend_yield > 0 THEN 5
                        ELSE 0
                    END
                )
            )) AS ivrv_pct,
            f.market_cap
        FROM (
            SELECT ticker, as_of, gross_margin, operating_margin, net_margin,
                   free_cash_flow, fcf_yield, total_debt, total_equity, debt_to_equity,
                   interest_coverage, book_value, tangible_book_value, book_value_per_share,
                   market_cap, price, shares_outstanding, pe_ratio, pb_ratio, ps_ratio,
                   ev_to_ebitda, dividend_yield, payout_ratio, eps, eps_growth_yoy,
                   revenue_growth_yoy, enterprise_value, ebit, net_working_capital,
                   ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY as_of DESC) AS _rn
            FROM fundamentals
            {universe_filter}
        ) f
        WHERE f._rn = 1
        """,
        params,
    )
    return conn.execute("SELECT COUNT(*) FROM value_compression_scores").fetchone()[0]


@app.post("/mcp/finance.compute_value_compression")
async def compute_value_compression(payload: Optional[dict] = None) -> dict:
    """Compute value compression composite scores from fundamentals.
    
    Input (optional): { "universe": ["AAPL", "MSFT"] }
    """
    payload = payload or {}
    universe = payload.get("universe")
    if isinstance(universe, str):
        universe = [universe]
    
    conn = get_connection()
    count = _compute_value_compression(conn, universe)
    
    return {"computed_count": count}


@app.post("/mcp/finance.query_value_compression")
async def query_value_compression(payload: Optional[dict] = None) -> dict:
    """Query value compression scores.
    
    Input (optional): {
        "universe": ["AAPL", "MSFT"],
        "min_stability": 50,  -- minimum operational stability
        "min_compression": 50,  -- minimum valuation compression
        "limit": 50
    }
    """
    payload = payload or {}
    universe = payload.get("universe")
    min_stability = payload.get("min_stability", 0)
    min_compression = payload.get("min_compression", 0)
    limit = payload.get("limit", 100) or 100
    
    conn = get_connection()
    
    conditions = []
    params: List[Any] = []
    
    if isinstance(universe, str):
        universe = [universe]
    if isinstance(universe, list):
        cleaned = [u for u in universe if isinstance(u, str) and u.strip()]
        if cleaned:
            conditions.append("v.ticker IN (%s)" % ",".join("?" for _ in cleaned))
            params.extend(cleaned)
    
    if min_stability > 0:
        conditions.append("v.operational_stability >= ?")
        params.append(float(min_stability))
    if min_compression > 0:
        conditions.append("v.valuation_compression >= ?")
        params.append(float(min_compression))
    
    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    params.append(int(limit))
    
    rows = conn.execute(
        f"""
        SELECT v.ticker, v.as_of, v.operational_stability, v.valuation_compression,
               v.shareholder_yield_pct, v.ivrv_pct, v.market_cap
        FROM value_compression_scores v
        {where_clause}
        ORDER BY (v.valuation_compression + v.operational_stability) DESC
        LIMIT ?
        """,
        params,
    ).fetchall()
    
    return {
        "rows": [
            {
                "ticker": r[0],
                "as_of": str(r[1]),
                "operational_stability": round(r[2], 1),
                "valuation_compression": round(r[3], 1),
                "shareholder_yield_pct": round(r[4], 1),
                "ivrv_pct": round(r[5], 1),
                "market_cap": r[6],
            }
            for r in rows
        ]
    }


# ============================================================================
# VRR (Value Realization Rate) MCP Endpoints
# =============================================================================


def _compute_vrr_positions(conn: duckdb.DuckDBPyConnection, universe: Optional[List[str]] = None) -> int:
    """Compute VRR positions from value compression scores + fundamentals.
    
    VRR = Value Realization Rate: how much of the value thesis has been captured.
    Spread = remaining gap to close (valuation_compression — wider = more undervalued).
    Velocity = speed of realization derived from IVRV.
    Kelly = optimal fraction of capital to allocate based on edge and odds.
    Marginal IRR = forward return on the next dollar deployed at each increment.
    Action = quadrant assignment based on spread + velocity.
    """
    if universe:
        universe_filter = "WHERE f.ticker IN (%s)" % ",".join("?" for _ in universe)
        params: List[Any] = list(universe)
    else:
        universe_filter = ""
        params = []
    
    # Ensure value compression scores are computed first
    _compute_value_compression(conn, universe)
    
    conn.execute("DELETE FROM vrr_positions")
    conn.execute(
        f"""
        INSERT INTO vrr_positions (
            ticker, as_of, vrr_pct, spread_pct, velocity, velocity_label,
            current_price, intrinsic_value,
            marginal_irr_3yr, marginal_irr_7yr, kelly_fraction, action, market_cap
        )
        SELECT
            vc.ticker,
            vc.as_of,
            -- VRR%: how much thesis has been realized
            -- High compression + low IVRV = low VRR (thesis not working, wide spread)
            -- Low compression + high IVRV = high VRR (thesis closing the gap)
            LEAST(100, GREATEST(0,
                (100 - vc.valuation_compression) * 0.5 + vc.ivrv_pct * 0.5
            )) AS vrr_pct,
            -- Spread: remaining gap = valuation_compression (higher = wider spread)
            vc.valuation_compression AS spread_pct,
            -- Velocity: raw IVRV value (0-100)
            vc.ivrv_pct AS velocity,
            -- Velocity label
            CASE
                WHEN vc.ivrv_pct > 40 THEN 'fast'
                WHEN vc.ivrv_pct >= 15 THEN 'moderate'
                ELSE 'slow'
            END AS velocity_label,
            -- Current price
            f.price AS current_price,
            -- Intrinsic value estimate (Graham-style: uses book value + earnings)
            CASE
                WHEN f.eps > 0 AND f.book_value_per_share > 0
                THEN SQRT(22.5 * f.eps * f.book_value_per_share)
                WHEN f.eps > 0 AND f.book_value_per_share IS NULL
                THEN f.eps * 15  -- fair P/E = 15
                ELSE NULL
            END AS intrinsic_value,
            -- Marginal IRR at 3yr horizon
            -- IRR = (spread * velocity_multiplier) / horizon
            -- velocity_multiplier: fast=1.2, moderate=0.7, slow=0.3
            LEAST(50, GREATEST(-5,
                CASE
                    WHEN vc.ivrv_pct > 40 THEN (vc.valuation_compression * 1.2) / 3.0
                    WHEN vc.ivrv_pct >= 15 THEN (vc.valuation_compression * 0.7) / 3.0
                    ELSE (vc.valuation_compression * 0.3) / 3.0
                END
            )) AS marginal_irr_3yr,
            -- Marginal IRR at 7yr horizon
            -- Longer horizon gives more time for mean reversion
            LEAST(40, GREATEST(-3,
                CASE
                    WHEN vc.ivrv_pct > 40 THEN (vc.valuation_compression * 1.5) / 7.0
                    WHEN vc.ivrv_pct >= 15 THEN (vc.valuation_compression * 0.9) / 7.0
                    ELSE (vc.valuation_compression * 0.4) / 7.0
                END
            )) AS marginal_irr_7yr,
            -- Kelly fraction: f* = (b*p - q) / b
            -- b = IRR/100 (net odds), p = IVRV/100 (probability of thesis working), q = 1-p
            -- Capped at 0.25 (25% max position size)
            LEAST(25, GREATEST(0,
                CASE
                    WHEN vc.ivrv_pct > 0 AND vc.valuation_compression > 0 THEN
                        ROUND(
                            -- b = IRR as decimal odds, p = IVRV/100
                            ((vc.valuation_compression / 100.0) * (vc.ivrv_pct / 100.0) - (1 - vc.ivrv_pct / 100.0))
                            / (vc.valuation_compression / 100.0)
                            * 100, 1
                        )
                    ELSE 0
                END
            )) AS kelly_fraction,
            -- Action quadrant assignment
            CASE
                WHEN vc.valuation_compression > 50 AND vc.ivrv_pct > 40 THEN 'add_aggressively'
                WHEN vc.valuation_compression <= 50 AND vc.ivrv_pct > 40 THEN 'add_capital'
                WHEN vc.valuation_compression > 50 AND vc.ivrv_pct >= 15 THEN 'patience'
                WHEN vc.valuation_compression > 50 AND vc.ivrv_pct < 15 THEN 'patience'
                ELSE 'rotate'
            END AS action,
            vc.market_cap
        FROM value_compression_scores vc
        JOIN (
            SELECT ticker, as_of, eps, book_value_per_share, price,
                   ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY as_of DESC) AS _rn
            FROM fundamentals
            {universe_filter}
        ) f ON vc.ticker = f.ticker AND f._rn = 1
        """,
        params,
    )
    return conn.execute("SELECT COUNT(*) FROM vrr_positions").fetchone()[0]


@app.post("/mcp/finance.compute_vrr")
async def compute_vrr(payload: Optional[dict] = None) -> dict:
    """Compute VRR positions from value compression scores.
    
    Input (optional): { "universe": ["AAPL", "MSFT"] }
    """
    payload = payload or {}
    universe = payload.get("universe")
    if isinstance(universe, str):
        universe = [universe]
    
    conn = get_connection()
    count = _compute_vrr_positions(conn, universe)
    
    return {"computed_count": count}


@app.post("/mcp/finance.query_vrr")
async def query_vrr(payload: Optional[dict] = None) -> dict:
    """Query VRR positions.
    
    Input (optional): {
        "universe": ["AAPL", "MSFT"],
        "min_vrr": 30,
        "action": "add_aggressively",
        "limit": 50
    }
    """
    payload = payload or {}
    universe = payload.get("universe")
    min_vrr = payload.get("min_vrr", 0)
    action_filter = payload.get("action")
    limit = payload.get("limit", 50) or 50
    
    conn = get_connection()
    
    conditions = []
    params: List[Any] = []
    
    if isinstance(universe, str):
        universe = [universe]
    if isinstance(universe, list):
        cleaned = [u for u in universe if isinstance(u, str) and u.strip()]
        if cleaned:
            conditions.append("v.ticker IN (%s)" % ",".join("?" for _ in cleaned))
            params.extend(cleaned)
    
    if min_vrr > 0:
        conditions.append("v.vrr_pct >= ?")
        params.append(float(min_vrr))
    
    if action_filter:
        conditions.append("v.action = ?")
        params.append(action_filter)
    
    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    params.append(int(limit))
    
    rows = conn.execute(
        f"""
        SELECT v.ticker, v.as_of, v.vrr_pct, v.spread_pct, v.velocity, v.velocity_label,
               v.current_price, v.intrinsic_value,
               v.marginal_irr_3yr, v.marginal_irr_7yr, v.kelly_fraction, v.action, v.market_cap
        FROM vrr_positions v
        {where_clause}
        ORDER BY v.marginal_irr_3yr DESC
        LIMIT ?
        """,
        params,
    ).fetchall()
    
    return {
        "rows": [
            {
                "ticker": r[0],
                "as_of": str(r[1]),
                "vrr_pct": round(r[2], 1),
                "spread_pct": round(r[3], 1),
                "velocity": round(r[4], 1),
                "velocity_label": r[5],
                "current_price": r[6],
                "intrinsic_value": round(r[7], 2) if r[7] else None,
                "marginal_irr_3yr": round(r[8], 1),
                "marginal_irr_7yr": round(r[9], 1),
                "kelly_fraction": round(r[10], 1),
                "action": r[11],
                "market_cap": r[12],
            }
            for r in rows
        ]
    }


@app.post("/mcp/finance.query_vrr_summary")
async def query_vrr_summary(payload: Optional[dict] = None) -> dict:
    """Query portfolio-level VRR summary.
    
    Input (optional): { "universe": ["AAPL", "MSFT"] }
    
    Returns: avg VRR, best opportunity, positions to add, positions to rotate.
    """
    payload = payload or {}
    universe = payload.get("universe")
    
    conn = get_connection()
    
    conditions = []
    params: List[Any] = []
    
    if isinstance(universe, str):
        universe = [universe]
    if isinstance(universe, list):
        cleaned = [u for u in universe if isinstance(u, str) and u.strip()]
        if cleaned:
            conditions.append("ticker IN (%s)" % ",".join("?" for _ in cleaned))
            params.extend(cleaned)
    
    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    
    # Aggregate stats
    stats = conn.execute(
        f"""
        SELECT
            AVG(vrr_pct),
            COUNT(*),
            COUNT(CASE WHEN action IN ('add_aggressively', 'add_capital') THEN 1 END),
            COUNT(CASE WHEN action = 'rotate' THEN 1 END)
        FROM vrr_positions
        {where_clause}
        """,
        params,
    ).fetchone()
    
    avg_vrr = round(stats[0], 1) if stats[0] else 0
    total_positions = stats[1]
    positions_to_add = stats[2]
    positions_to_rotate = stats[3]
    
    # Best opportunity: highest marginal IRR at 3yr
    best = conn.execute(
        f"""
        SELECT ticker, marginal_irr_3yr, kelly_fraction
        FROM vrr_positions
        {where_clause}
        ORDER BY marginal_irr_3yr DESC
        LIMIT 1
        """,
        params,
    ).fetchone()
    
    best_ticker = best[0] if best else None
    best_irr = round(best[1], 1) if best else None
    best_kelly = round(best[2], 1) if best else None
    
    return {
        "avg_vrr": avg_vrr,
        "total_positions": total_positions,
        "best_opportunity": {
            "ticker": best_ticker,
            "marginal_irr_3yr": best_irr,
            "kelly_fraction": best_kelly,
        },
        "positions_to_add": positions_to_add,
        "positions_to_rotate": positions_to_rotate,
    }


@app.post("/mcp/finance.simulate_marginal_irr")
async def simulate_marginal_irr(payload: dict) -> dict:
    """Simulate marginal IRR curve for a ticker at different capital addition levels.
    
    Input: {
        "ticker": "AAPL",
        "horizon_years": 3,    -- optional, default 3
        "hurdle_rate": 8.0,   -- optional, default 8%
        "edge_estimate": 0.6,  -- optional, probability of thesis working (0-1), default from IVRV
        "capital_steps": 20    -- optional, number of steps from 0-200% capital addition
    }
    
    Returns an array of { capital_pct, irr, kelly, half_kelly, zone } points.
    """
    ticker = payload.get("ticker", "")
    horizon = payload.get("horizon_years", 3)
    hurdle_rate = payload.get("hurdle_rate", 8.0)
    edge_estimate = payload.get("edge_estimate")  # None = derive from IVRV
    capital_steps = payload.get("capital_steps", 20)
    
    if not ticker:
        raise HTTPException(status_code=400, detail="ticker is required")
    
    conn = get_connection()
    
    # Get base VRR data
    row = conn.execute(
        """
        SELECT vrr_pct, spread_pct, velocity, velocity_label, marginal_irr_3yr, marginal_irr_7yr,
               kelly_fraction, current_price, intrinsic_value, market_cap
        FROM vrr_positions WHERE ticker = ?
        ORDER BY as_of DESC LIMIT 1
        """,
        [ticker],
    ).fetchone()
    
    if not row:
        raise HTTPException(status_code=404, detail=f"No VRR data for {ticker}")
    
    base_vrr = row[0]
    base_spread = row[1]
    base_velocity = row[2]
    velocity_label = row[3]
    base_irr_3yr = row[4]
    base_irr_7yr = row[5]
    base_kelly = row[6]
    current_price = row[7]
    intrinsic_value = row[8]
    market_cap = row[9]
    
    # Probability of thesis working
    p = edge_estimate if edge_estimate is not None else base_velocity / 100.0
    p = max(0.1, min(0.95, p))  # Clamp to reasonable range
    q = 1 - p
    
    # Base IRR for the selected horizon
    base_irr = base_irr_3yr if horizon <= 5 else base_irr_7yr
    
    # Generate IRR curve: as you add more capital, average cost rises, IRR declines
    # Model: IRR at capital_pct additional = base_irr * (1 - decay_factor * capital_pct / 200)
    # decay is faster for slow velocity, slower for fast velocity
    decay_rate = {
        'fast': 0.4,     # Fast velocity: IRR decays slowly — thesis is working
        'moderate': 0.6, # Moderate: moderate decay
        'slow': 0.8,     # Slow: IRR decays fast — value trap risk
    }.get(velocity_label, 0.6)
    
    points = []
    for i in range(capital_steps + 1):
        capital_pct = (i / capital_steps) * 200  # 0% to 200%
        
        # Marginal IRR at this capital level
        irr = base_irr * (1 - decay_rate * (capital_pct / 200.0))
        irr = max(-5, irr)  # Floor at -5%
        
        # Kelly fraction at this IRR
        # f* = (b*p - q) / b, where b = IRR/100
        b = irr / 100.0
        if b > 0:
            kelly = max(0, (b * p - q) / b) * 100  # as percentage
        else:
            kelly = 0
        kelly = min(25, kelly)  # Cap at 25%
        
        half_kelly = kelly / 2
        
        # Zone classification
        if irr > hurdle_rate and kelly > 0:
            zone = "deploy"  # Zone 1
        elif irr > 0 and kelly > 0:
            zone = "diminishing"  # Zone 2
        else:
            zone = "stop"  # Zone 3
        
        points.append({
            "capital_pct": round(capital_pct, 1),
            "irr": round(irr, 1),
            "kelly": round(kelly, 1),
            "half_kelly": round(half_kelly, 1),
            "zone": zone,
        })
    
    return {
        "ticker": ticker,
        "horizon_years": horizon,
        "hurdle_rate": hurdle_rate,
        "base_irr": round(base_irr, 1),
        "base_spread": round(base_spread, 1),
        "base_velocity": round(base_velocity, 1),
        "velocity_label": velocity_label,
        "edge_estimate": round(p, 2),
        "current_price": current_price,
        "intrinsic_value": round(intrinsic_value, 2) if intrinsic_value else None,
        "market_cap": market_cap,
        "points": points,
    }


# ============================================================================
# Compounding Discount Monitor MCP Endpoints (Getty Oil inspired)
# =============================================================================


def _compute_compounding_discount(conn: duckdb.DuckDBPyConnection, universe: Optional[List[str]] = None) -> int:
    """Compute compounding discount monitor positions from fundamentals.
    
    Inspired by the 1962 Getty Oil case study: companies compounding book value
    at high rates sometimes trade at deep discounts to book — a mispricing that
    eventually resolves.
    
    P/B = price-to-book ratio (lower = more undervalued)
    BVPS CAGR = book value per share compound annual growth rate (higher = more compounding)
    Look-through P/B = P/B adjusted for intangibles/net cash (reveals hidden discounts)
    Arbitrage gap = gap between reported and look-through P/B
    Family stake = insider/family ownership concentration
    Quadrant = classification based on CAGR + P/B intersection
    """
    if universe:
        universe_filter = "WHERE f.ticker IN (%s)" % ",".join("?" for _ in universe)
        params: List[Any] = list(universe)
    else:
        universe_filter = ""
        params = []
    
    conn.execute("DELETE FROM compounding_discount_monitor")
    conn.execute(
        f"""
        INSERT INTO compounding_discount_monitor (
            ticker, as_of, pb_ratio, bvps_cagr_5yr, bvps_cagr_10yr,
            look_through_pb, arbitrage_gap, family_stake_pct, family_stake_flag,
            quadrant, roe, tangible_bvps, net_cash_per_share, market_cap
        )
        SELECT
            f.ticker,
            f.as_of,
            -- P/B ratio: direct from fundamentals
            f.pb_ratio,
            -- BVPS CAGR 5yr: approximated using sustainable growth rate
            -- Sustainable growth = ROE × (1 - payout_ratio/100)
            -- ROE = EPS / BVPS (when both positive)
            LEAST(40, GREATEST(-10,
                CASE
                    WHEN f.eps > 0 AND f.book_value_per_share > 0
                    THEN (f.eps / f.book_value_per_share) * (1 - COALESCE(f.payout_ratio, 30) / 100.0) * 100
                    WHEN f.eps > 0 AND f.total_equity > 0 AND f.shares_outstanding > 0
                    THEN (f.eps / (f.total_equity / f.shares_outstanding)) * (1 - COALESCE(f.payout_ratio, 30) / 100.0) * 100
                    -- Fallback: use EPS growth as proxy for BVPS growth
                    WHEN f.eps_growth_yoy IS NOT NULL AND f.eps_growth_yoy > 0
                    THEN LEAST(40, f.eps_growth_yoy * 0.8)  -- BVPS grows slower than EPS due to dilution
                    ELSE 0
                END
            )) AS bvps_cagr_5yr,
            -- BVPS CAGR 10yr: conservative version (slightly lower, mean-reverting)
            LEAST(35, GREATEST(-8,
                CASE
                    WHEN f.eps > 0 AND f.book_value_per_share > 0
                    THEN (f.eps / f.book_value_per_share) * (1 - COALESCE(f.payout_ratio, 30) / 100.0) * 90  -- 10% discount for longer horizon
                    WHEN f.eps > 0 AND f.total_equity > 0 AND f.shares_outstanding > 0
                    THEN (f.eps / (f.total_equity / f.shares_outstanding)) * (1 - COALESCE(f.payout_ratio, 30) / 100.0) * 90
                    WHEN f.eps_growth_yoy IS NOT NULL AND f.eps_growth_yoy > 0
                    THEN LEAST(35, f.eps_growth_yoy * 0.65)
                    ELSE 0
                END
            )) / 100 AS bvps_cagr_10yr,
            -- Look-through P/B: adjusts for intangibles and net cash
            -- If tangible BVPS > 0, P/B on tangible book is higher (worse), but
            -- we want the look-through to show the *hidden* discount.
            -- Look-through = reported P/B * (tangible_bvps / bvps) when tangible < bvps
            -- This reveals that on a tangible basis, the stock is even cheaper
            -- When net cash exists, effective P/B is even lower
            CASE
                WHEN f.pb_ratio > 0 AND f.tangible_book_value > 0 AND f.book_value > 0
                     AND f.tangible_book_value < f.book_value
                THEN f.pb_ratio * (f.tangible_book_value / f.book_value)
                WHEN f.pb_ratio > 0
                THEN f.pb_ratio
                ELSE NULL
            END AS look_through_pb,
            -- Arbitrage gap: how much the look-through reveals vs reported P/B
            CASE
                WHEN f.pb_ratio > 0 AND f.tangible_book_value > 0 AND f.book_value > 0
                     AND f.tangible_book_value < f.book_value
                THEN ROUND(((f.pb_ratio - (f.pb_ratio * (f.tangible_book_value / f.book_value))) / f.pb_ratio) * 100, 1)
                ELSE 0
            END AS arbitrage_gap,
            -- Family/insider stake: from institutional_holdings if available
            -- Check if any single holder owns >30% of shares
            COALESCE(
                (SELECT MAX(i.pct_of_portfolio)
                 FROM institutional_holdings i
                 WHERE i.ticker = f.ticker
                 AND i.pct_of_portfolio > 30
                 LIMIT 1),
                0
            ) AS family_stake_pct,
            -- Family stake flag: TRUE if any holder >30%
            COALESCE(
                (SELECT CASE WHEN COUNT(*) > 0 THEN TRUE ELSE FALSE END
                 FROM institutional_holdings i
                 WHERE i.ticker = f.ticker
                 AND i.pct_of_portfolio > 30
                 LIMIT 1),
                FALSE
            ) AS family_stake_flag,
            -- Quadrant assignment
            CASE
                -- Opportunity (Getty zone): high compounding + low P/B
                WHEN (CASE WHEN f.eps > 0 AND f.book_value_per_share > 0
                           THEN (f.eps / f.book_value_per_share) * (1 - COALESCE(f.payout_ratio, 30) / 100.0) * 100
                           ELSE 0 END) >= 12
                     AND f.pb_ratio < 1.0
                THEN 'opportunity'
                -- Efficient Market: high compounding + fair/rich P/B
                WHEN (CASE WHEN f.eps > 0 AND f.book_value_per_share > 0
                           THEN (f.eps / f.book_value_per_share) * (1 - COALESCE(f.payout_ratio, 30) / 100.0) * 100
                           ELSE 0 END) >= 12
                     AND f.pb_ratio >= 1.5
                THEN 'efficient'
                -- Value Trap: low compounding + low P/B
                WHEN (CASE WHEN f.eps > 0 AND f.book_value_per_share > 0
                           THEN (f.eps / f.book_value_per_share) * (1 - COALESCE(f.payout_ratio, 30) / 100.0) * 100
                           ELSE 0 END) < 5
                     AND f.pb_ratio < 1.0
                THEN 'value_trap'
                -- Overvalued: low compounding + high P/B
                WHEN (CASE WHEN f.eps > 0 AND f.book_value_per_share > 0
                           THEN (f.eps / f.book_value_per_share) * (1 - COALESCE(f.payout_ratio, 30) / 100.0) * 100
                           ELSE 0 END) < 5
                     AND f.pb_ratio >= 1.5
                THEN 'overvalued'
                -- Patience: moderate compounding + low P/B
                WHEN f.pb_ratio < 1.0
                THEN 'patience'
                -- Watch: moderate compounding + high P/B
                ELSE 'watch'
            END AS quadrant,
            -- ROE: return on equity
            CASE
                WHEN f.total_equity > 0 AND f.net_margin > 0
                THEN f.net_margin * (f.revenue / NULLIF(f.total_equity, 0)) / 100
                WHEN f.eps > 0 AND f.book_value_per_share > 0
                THEN (f.eps / f.book_value_per_share) * 100
                ELSE NULL
            END AS roe,
            -- Tangible BVPS
            CASE
                WHEN f.shares_outstanding > 0 AND f.tangible_book_value > 0
                THEN f.tangible_book_value / f.shares_outstanding
                ELSE NULL
            END AS tangible_bvps,
            -- Net cash per share
            CASE
                WHEN f.shares_outstanding > 0
                THEN (COALESCE(f.free_cash_flow, 0) - COALESCE(f.total_debt, 0)) / f.shares_outstanding
                ELSE NULL
            END AS net_cash_per_share,
            f.market_cap
        FROM (
            SELECT ticker, as_of, eps, book_value_per_share, book_value, tangible_book_value,
                   total_equity, total_debt, shares_outstanding, pb_ratio, pe_ratio,
                   payout_ratio, eps_growth_yoy, revenue, net_margin, free_cash_flow,
                   market_cap, price,
                   ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY as_of DESC) AS _rn
            FROM fundamentals
            {universe_filter}
        ) f
        WHERE f._rn = 1
          AND f.pb_ratio IS NOT NULL
          AND f.pb_ratio > 0
        """,
        params,
    )
    return conn.execute("SELECT COUNT(*) FROM compounding_discount_monitor").fetchone()[0]


@app.post("/mcp/finance.compute_compounding_discount")
async def compute_compounding_discount(payload: Optional[dict] = None) -> dict:
    """Compute compounding discount monitor positions.
    
    Input (optional): { "universe": ["AAPL", "MSFT"] }
    """
    payload = payload or {}
    universe = payload.get("universe")
    if isinstance(universe, str):
        universe = [universe]
    
    conn = get_connection()
    count = _compute_compounding_discount(conn, universe)
    
    return {"computed_count": count}


@app.post("/mcp/finance.query_compounding_discount")
async def query_compounding_discount(payload: Optional[dict] = None) -> dict:
    """Query compounding discount monitor positions.
    
    Input (optional): {
        "universe": ["AAPL", "MSFT"],
        "quadrant": "opportunity",
        "min_cagr": 8,
        "max_pb": 1.5,
        "limit": 50
    }
    """
    payload = payload or {}
    universe = payload.get("universe")
    quadrant = payload.get("quadrant")
    min_cagr = payload.get("min_cagr", 0)
    max_pb = payload.get("max_pb")
    limit = payload.get("limit", 50) or 50
    
    conn = get_connection()
    
    conditions = []
    params: List[Any] = []
    
    if isinstance(universe, str):
        universe = [universe]
    if isinstance(universe, list):
        cleaned = [u for u in universe if isinstance(u, str) and u.strip()]
        if cleaned:
            conditions.append("c.ticker IN (%s)" % ",".join("?" for _ in cleaned))
            params.extend(cleaned)
    
    if quadrant:
        conditions.append("c.quadrant = ?")
        params.append(quadrant)
    
    if min_cagr > 0:
        conditions.append("c.bvps_cagr_5yr >= ?")
        params.append(float(min_cagr))
    
    if max_pb is not None and max_pb > 0:
        conditions.append("c.pb_ratio <= ?")
        params.append(float(max_pb))
    
    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    params.append(int(limit))
    
    rows = conn.execute(
        f"""
        SELECT c.ticker, c.as_of, c.pb_ratio, c.bvps_cagr_5yr, c.bvps_cagr_10yr,
               c.look_through_pb, c.arbitrage_gap, c.family_stake_pct, c.family_stake_flag,
               c.quadrant, c.roe, c.tangible_bvps, c.net_cash_per_share, c.market_cap
        FROM compounding_discount_monitor c
        {where_clause}
        ORDER BY c.bvps_cagr_5yr DESC, c.pb_ratio ASC
        LIMIT ?
        """,
        params,
    ).fetchall()
    
    return {
        "rows": [
            {
                "ticker": r[0],
                "as_of": str(r[1]),
                "pb_ratio": round(r[2], 2) if r[2] else None,
                "bvps_cagr_5yr": round(r[3], 1) if r[3] else None,
                "bvps_cagr_10yr": round(r[4], 1) if r[4] else None,
                "look_through_pb": round(r[5], 2) if r[5] else None,
                "arbitrage_gap": round(r[6], 1) if r[6] else 0,
                "family_stake_pct": round(r[7], 1) if r[7] else 0,
                "family_stake_flag": bool(r[8]) if r[8] is not None else False,
                "quadrant": r[9],
                "roe": round(r[10], 1) if r[10] else None,
                "tangible_bvps": round(r[11], 2) if r[11] else None,
                "net_cash_per_share": round(r[12], 2) if r[12] else None,
                "market_cap": r[13],
            }
            for r in rows
        ]
    }


@app.post("/mcp/finance.query_compounding_discount_summary")
async def query_compounding_discount_summary(payload: Optional[dict] = None) -> dict:
    """Query portfolio-level compounding discount summary.
    
    Input (optional): { "universe": ["AAPL", "MSFT"] }
    
    Returns: quadrant counts, avg CAGR in opportunity zone, best opportunity,
    getty gap count (companies with look-through P/B < 0.7).
    """
    payload = payload or {}
    universe = payload.get("universe")
    
    conn = get_connection()
    
    conditions = []
    params: List[Any] = []
    
    if isinstance(universe, str):
        universe = [universe]
    if isinstance(universe, list):
        cleaned = [u for u in universe if isinstance(u, str) and u.strip()]
        if cleaned:
            conditions.append("ticker IN (%s)" % ",".join("?" for _ in cleaned))
            params.extend(cleaned)
    
    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    
    # Quadrant counts
    quadrant_counts = conn.execute(
        f"""
        SELECT quadrant, COUNT(*)
        FROM compounding_discount_monitor
        {where_clause}
        GROUP BY quadrant
        """,
        params,
    ).fetchall()
    counts_map = {r[0]: r[1] for r in quadrant_counts}
    
    # Avg CAGR in opportunity zone
    opp_stats = conn.execute(
        f"""
        SELECT AVG(bvps_cagr_5yr), AVG(pb_ratio)
        FROM compounding_discount_monitor
        {where_clause}
        {'AND' if conditions else 'WHERE'} quadrant = 'opportunity'
        """,
        params + ['opportunity'] if not conditions else params + ['opportunity'],
    ).fetchone()
    avg_cagr_opportunity = round(opp_stats[0], 1) if opp_stats and opp_stats[0] else 0
    avg_pb_opportunity = round(opp_stats[1], 2) if opp_stats and opp_stats[1] else 0
    
    # Best opportunity: highest CAGR + lowest P/B combined
    best = conn.execute(
        f"""
        SELECT ticker, bvps_cagr_5yr, pb_ratio, look_through_pb
        FROM compounding_discount_monitor
        {where_clause}
        ORDER BY bvps_cagr_5yr DESC, pb_ratio ASC
        LIMIT 1
        """,
        params,
    ).fetchone()
    
    # Getty gap count: companies where look-through P/B < 0.7
    getty_count = conn.execute(
        f"""
        SELECT COUNT(*)
        FROM compounding_discount_monitor
        {where_clause}
        {'AND' if conditions else 'WHERE'} look_through_pb < 0.7
        """,
        params if not conditions else params,
    ).fetchone()[0]
    
    return {
        "quadrant_counts": counts_map,
        "total_in_opportunity": counts_map.get("opportunity", 0),
        "avg_cagr_opportunity": avg_cagr_opportunity,
        "avg_pb_opportunity": avg_pb_opportunity,
        "best_opportunity": {
            "ticker": best[0] if best else None,
            "bvps_cagr_5yr": round(best[1], 1) if best else None,
            "pb_ratio": round(best[2], 2) if best else None,
            "look_through_pb": round(best[3], 2) if best else None,
        },
        "getty_gap_count": getty_count,
    }


@app.post("/mcp/finance.simulate_bvps_trail")
async def simulate_bvps_trail(payload: dict) -> dict:
    """Simulate trailing BVPS/P/B history for a single ticker (ghost trail).
    
    Generates a projected trail showing how BVPS compounds while market price
    may stay disconnected — the widening gap represents the arbitrage opportunity.
    
    Input: {
        "ticker": "AAPL",
        "years": 10,      -- optional, default 10
        "steps": 20       -- optional, number of data points
    }
    
    Returns an array of {year, bvps, price, pb_ratio} points.
    """
    ticker = payload.get("ticker", "")
    years = payload.get("years", 10)
    steps = payload.get("steps", 20)
    
    if not ticker:
        raise HTTPException(status_code=400, detail="ticker is required")
    
    conn = get_connection()
    
    # Get current monitor data
    row = conn.execute(
        """
        SELECT pb_ratio, bvps_cagr_5yr, look_through_pb, roe, market_cap
        FROM compounding_discount_monitor WHERE ticker = ?
        ORDER BY as_of DESC LIMIT 1
        """,
        [ticker],
    ).fetchone()
    
    if not row:
        raise HTTPException(status_code=404, detail=f"No compounding discount data for {ticker}")
    
    current_pb = row[0]
    bvps_cagr = row[1] / 100.0 if row[1] else 0.08  # default 8%
    look_through_pb = row[2]
    roe = row[3]
    market_cap = row[4]
    
    # Get current fundamentals for base values
    frow = conn.execute(
        """
        SELECT price, book_value_per_share
        FROM fundamentals WHERE ticker = ?
        ORDER BY as_of DESC LIMIT 1
        """,
        [ticker],
    ).fetchone()
    
    current_price = frow[0] if frow else 100
    current_bvps = frow[1] if frow and frow[1] else current_price / current_pb if current_pb > 0 else 100
    
    # Generate trail: BVPS compounds at CAGR, price follows with market noise
    # In the Getty pattern, price stays flat while BVPS compounds
    points = []
    for i in range(steps + 1):
        year_offset = -years + (years * i / steps)  # from -years to 0
        
        # BVPS at this point (compounding backward/forward)
        bvps_at_point = current_bvps * ((1 + bvps_cagr) ** year_offset)
        
        # Price at this point: market may lag BVPS compounding
        # Model: price mean-reverts to BVPS * fair_pb over time
        # But in value traps, price stays depressed
        fair_pb = 1.0  # Fair value P/B
        price_convergence_speed = 0.15  # 15% per year convergence toward fair value
        
        # Current discount from fair value
        current_discount = (fair_pb - current_pb) / fair_pb if fair_pb > 0 else 0
        
        # Price grows at a blend of BVPS CAGR and convergence speed
        # In the past, price was more disconnected (wider gap)
        price_at_point = current_price * ((1 + bvps_cagr * 0.5 + price_convergence_speed * current_discount) ** year_offset)
        
        # P/B at this point
        pb_at_point = price_at_point / bvps_at_point if bvps_at_point > 0 else current_pb
        
        points.append({
            "year": round(year_offset, 1),
            "bvps": round(bvps_at_point, 2),
            "price": round(price_at_point, 2),
            "pb_ratio": round(pb_at_point, 3),
        })
    
    return {
        "ticker": ticker,
        "current_bvps": round(current_bvps, 2),
        "current_price": round(current_price, 2),
        "current_pb": round(current_pb, 3),
        "look_through_pb": round(look_through_pb, 3) if look_through_pb else None,
        "bvps_cagr": round(bvps_cagr * 100, 1),
        "years": years,
        "points": points,
    }


# ============================================================================
# Formula MCP Endpoints
# =============================================================================


@app.get("/mcp/formula.list")
async def list_formulas(category: Optional[str] = None) -> dict:
    """List all available formulas.
    
    Query params:
        category: Optional filter by category (margin_of_safety, quality, torque, combined)
    """
    conn = get_connection()
    
    if category:
        rows = conn.execute(
            "SELECT id, name, expression, description, category, output_format, is_system "
            "FROM formula_definitions WHERE category = ? ORDER BY name",
            [category],
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id, name, expression, description, category, output_format, is_system "
            "FROM formula_definitions ORDER BY category, name"
        ).fetchall()
    
    return {
        "formulas": [
            {
                "id": r[0],
                "name": r[1],
                "expression": r[2],
                "description": r[3],
                "category": r[4],
                "output_format": r[5],
                "is_system": bool(r[6]),
            }
            for r in rows
        ],
        "fields": list(FUNDAMENTALS_FIELDS),
    }


@app.post("/mcp/formula.create")
async def create_formula(payload: dict) -> dict:
    """Create a new custom formula.
    
    Input: {
        "id": "formula:my_custom",  # optional, auto-generated if not provided
        "name": "My Custom Metric",
        "expression": "(pe_ratio + pb_ratio) / 2",
        "description": "Average of PE and PB",
        "category": "custom",
        "output_format": "number"  # number, percent, currency
    }
    """
    conn = get_connection()
    engine = FormulaEngine()
    
    name = payload.get("name")
    expression = payload.get("expression")
    
    if not name or not expression:
        raise HTTPException(status_code=400, detail="name and expression are required")
    
    # Validate the expression
    validation = engine.validate(expression)
    if not validation.is_valid:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid expression: {'; '.join(validation.errors)}"
        )
    
    formula_id = payload.get("id") or f"formula:custom:{name.lower().replace(' ', '_')}"
    description = payload.get("description", "")
    category = payload.get("category", "custom")
    output_format = payload.get("output_format", "number")
    
    upsert_row(conn, "formula_definitions", {
        "id": formula_id,
        "name": name,
        "expression": expression,
        "description": description,
        "category": category,
        "output_format": output_format,
        "is_system": False,
    }, ["id"])
    
    return {
        "id": formula_id,
        "name": name,
        "expression": expression,
        "fields_used": validation.fields_used,
        "functions_used": validation.functions_used,
    }


@app.post("/mcp/formula.validate")
async def validate_formula(payload: dict) -> dict:
    """Validate a formula expression without saving it.
    
    Input: {"expression": "pe_ratio / eps_growth_yoy"}
    """
    expression = payload.get("expression", "")
    engine = FormulaEngine()
    validation = engine.validate(expression)
    
    return {
        "is_valid": validation.is_valid,
        "errors": validation.errors,
        "fields_used": validation.fields_used,
        "functions_used": validation.functions_used,
    }


@app.post("/mcp/formula.evaluate")
async def evaluate_formula(payload: dict) -> dict:
    """Evaluate a formula for a universe of tickers.
    
    Input: {
        "expression": "SQRT(22.5 * eps * book_value_per_share)",
        "formula_id": "formula:graham_number",  # alternative to expression
        "universe": ["AAPL", "MSFT"],  # optional, defaults to all
        "as_of": "2024-01-01"  # optional
    }
    """
    conn = get_connection()
    
    expression = payload.get("expression")
    formula_id = payload.get("formula_id")
    
    if not expression and formula_id:
        # Look up expression from formula_id
        row = conn.execute(
            "SELECT expression FROM formula_definitions WHERE id = ?",
            [formula_id],
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Formula not found: {formula_id}")
        expression = row[0]
    
    if not expression:
        raise HTTPException(status_code=400, detail="expression or formula_id required")
    
    universe = payload.get("universe")
    if isinstance(universe, str):
        universe = [universe]
    
    as_of = payload.get("as_of")
    
    results = evaluate_formula_for_universe(conn, expression, universe, as_of)
    
    return {"results": results}


@app.post("/mcp/formula.compute_all")
async def compute_all_metrics(payload: Optional[dict] = None) -> dict:
    """Compute all formula-based metrics and store in computed_metrics table.
    
    Input (optional): {"universe": ["AAPL", "MSFT"]}
    """
    payload = payload or {}
    universe = payload.get("universe")
    if isinstance(universe, str):
        universe = [universe]
    
    conn = get_connection()
    count = compute_all_formulas(conn, universe)
    
    return {"computed_count": count}


# ============================================================================
# Screen Builder MCP Endpoints
# ============================================================================


@app.post("/mcp/screen.run")
async def run_screen(payload: dict) -> dict:
    """Run a stock screen with filters and rankings.
    
    Input: {
        "filters": [
            {"field": "gross_margin", "op": ">", "value": 0.4},
            {"field": "debt_to_equity", "op": "<", "value": 0.5},
            {"field": "pe_ratio", "op": "BETWEEN", "value": [5, 20]}
        ],
        "rank_by": "margin_of_safety",  # field or formula name
        "rank_order": "DESC",
        "columns": ["ticker", "price", "pe_ratio", "gross_margin"],
        "formulas": ["formula:margin_of_safety", "formula:quality_score"],
        "limit": 20
    }
    """
    conn = get_connection()
    engine = FormulaEngine()
    
    filters = payload.get("filters", [])
    rank_by = payload.get("rank_by")
    rank_order = payload.get("rank_order", "DESC").upper()
    columns = payload.get("columns", ["ticker", "as_of", "price", "pe_ratio"])
    formula_ids = payload.get("formulas", [])
    limit = payload.get("limit", 20)
    
    # By default, return only the latest fundamentals row per ticker.
    # This matches UI expectations (one point/row per stock) now that we store time-series.
    latest_per_ticker = payload.get("latest_per_ticker", True)
    
    # Build WHERE clause from filters
    where_parts = []
    params: List[Any] = []
    
    op_map = {
        ">": ">",
        "<": "<",
        ">=": ">=",
        "<=": "<=",
        "=": "=",
        "==": "=",
        "!=": "!=",
        "<>": "<>",
        "BETWEEN": "BETWEEN",
        "IN": "IN",
        "NOT IN": "NOT IN",
        "IS NULL": "IS NULL",
        "IS NOT NULL": "IS NOT NULL",
    }
    
    for f in filters:
        field = f.get("field")
        op = f.get("op", "=").upper()
        value = f.get("value")
        
        if field not in FUNDAMENTALS_FIELDS:
            continue  # Skip invalid fields
        
        sql_op = op_map.get(op, "=")
        
        if sql_op == "BETWEEN" and isinstance(value, list) and len(value) == 2:
            where_parts.append(f"{field} BETWEEN ? AND ?")
            params.extend(value)
        elif sql_op in ("IN", "NOT IN") and isinstance(value, list):
            placeholders = ",".join("?" for _ in value)
            where_parts.append(f"{field} {sql_op} ({placeholders})")
            params.extend(value)
        elif sql_op in ("IS NULL", "IS NOT NULL"):
            where_parts.append(f"{field} {sql_op}")
        else:
            where_parts.append(f"{field} {sql_op} ?")
            params.append(value)
    
    where_clause = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
    
    # Ensure columns are valid
    valid_columns = [c for c in columns if c in FUNDAMENTALS_FIELDS]
    if not valid_columns:
        valid_columns = ["ticker", "as_of"]
    
    select_cols = ", ".join(valid_columns)
    
    # Build ORDER BY
    order_clause = ""
    if rank_by and rank_by in FUNDAMENTALS_FIELDS:
        order_clause = f"ORDER BY {rank_by} {rank_order}"
    
    # Execute query
    if latest_per_ticker:
        # Use a window function to select the most recent row per ticker.
        # Note: ORDER BY for ranking is applied AFTER deduping.
        base_query = f"""
            SELECT {select_cols}
            FROM (
                SELECT
                    {select_cols},
                    ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY as_of DESC) AS _rn
                FROM fundamentals
                {where_clause}
            ) t
            WHERE _rn = 1
        """
        query = f"""
            {base_query}
            {order_clause}
            LIMIT ?
        """
    else:
        query = f"""
            SELECT {select_cols}
            FROM fundamentals
            {where_clause}
            {order_clause}
            LIMIT ?
        """

    params.append(limit)
    rows = conn.execute(query, params).fetchall()
    
    # Get formula definitions for evaluation
    formulas_to_eval = []
    if formula_ids:
        placeholders = ",".join("?" for _ in formula_ids)
        formula_rows = conn.execute(
            f"SELECT id, name, expression, output_format FROM formula_definitions WHERE id IN ({placeholders})",
            formula_ids,
        ).fetchall()
        formulas_to_eval = [
            {"id": r[0], "name": r[1], "expression": r[2], "format": r[3]}
            for r in formula_rows
        ]
    
    # Build results with formula evaluations
    results = []
    for row in rows:
        row_data = dict(zip(valid_columns, row))
        
        # Evaluate formulas for this row
        for formula in formulas_to_eval:
            result = engine.evaluate(formula["expression"], row_data)
            row_data[formula["name"]] = result.value
        
        # Convert date to string
        if "as_of" in row_data and row_data["as_of"]:
            row_data["as_of"] = str(row_data["as_of"])
        
        results.append(row_data)
    
    # Re-sort by formula if rank_by is a formula
    if rank_by and rank_by not in FUNDAMENTALS_FIELDS:
        # Find formula with matching name
        for formula in formulas_to_eval:
            if formula["name"].lower().replace(" ", "_") == rank_by.lower().replace(" ", "_"):
                results.sort(
                    key=lambda x: x.get(formula["name"]) or float('-inf' if rank_order == 'DESC' else 'inf'),
                    reverse=(rank_order == "DESC")
                )
                break
    
    return {
        "rows": results,
        "count": len(results),
        "columns": valid_columns + [f["name"] for f in formulas_to_eval],
    }


@app.post("/mcp/screen.save")
async def save_screen(payload: dict) -> dict:
    """Save a screen definition for reuse.
    
    Input: {
        "id": "screen:quality_value",  # optional
        "name": "Quality + Value",
        "description": "High margin, low debt, cheap stocks",
        "filters": [...],
        "rank_by": "margin_of_safety",
        "rank_order": "DESC",
        "columns": [...]
    }
    """
    conn = get_connection()
    
    name = payload.get("name")
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    
    screen_id = payload.get("id") or f"screen:{name.lower().replace(' ', '_')}"
    
    upsert_row(conn, "screen_definitions", {
        "id": screen_id,
        "name": name,
        "description": payload.get("description", ""),
        "filters": json.dumps(payload.get("filters", [])),
        "rank_by": payload.get("rank_by", ""),
        "rank_order": payload.get("rank_order", "DESC"),
        "columns": json.dumps(payload.get("columns", [])),
        "is_system": False,
    }, ["id"])
    
    return {"id": screen_id, "name": name}


@app.get("/mcp/screen.list")
async def list_screens() -> dict:
    """List all saved screen definitions."""
    conn = get_connection()
    
    rows = conn.execute(
        "SELECT id, name, description, filters, rank_by, rank_order, columns, is_system "
        "FROM screen_definitions ORDER BY name"
    ).fetchall()
    
    return {
        "screens": [
            {
                "id": r[0],
                "name": r[1],
                "description": r[2],
                "filters": json.loads(r[3]) if r[3] else [],
                "rank_by": r[4],
                "rank_order": r[5],
                "columns": json.loads(r[6]) if r[6] else [],
                "is_system": bool(r[7]),
            }
            for r in rows
        ]
    }


@app.get("/mcp/fundamentals.fields")
async def list_fundamentals_fields() -> dict:
    """List all available fields from the fundamentals table."""
    return {
        "fields": sorted(list(FUNDAMENTALS_FIELDS)),
        "categories": {
            "core": ["ticker", "as_of", "ebit", "enterprise_value", "net_working_capital"],
            "revenue": ["revenue", "revenue_growth_yoy"],
            "margins": ["gross_margin", "operating_margin", "net_margin"],
            "cash_flow": ["free_cash_flow", "fcf_yield"],
            "leverage": ["total_debt", "total_equity", "debt_to_equity", "interest_coverage"],
            "book_value": ["book_value", "tangible_book_value", "book_value_per_share"],
            "market": ["market_cap", "price", "shares_outstanding"],
            "valuation": ["pe_ratio", "pb_ratio", "ps_ratio", "ev_to_ebitda", "ev_to_fcf"],
            "dividends": ["dividend_yield", "payout_ratio"],
            "earnings": ["eps", "eps_growth_yoy"],
        },
    }


# ============================================================================
# Taxonomy API Endpoints
# ============================================================================


@app.get("/api/taxonomy")
async def get_taxonomy() -> dict:
    """Get the full taxonomy hierarchy.
    
    Returns:
        - macro_sectors: List of Level 1 sectors
        - hierarchy: Full tree (sector -> cluster -> business_model_groups)
        - themes: Cross-sector thematic tags with descriptions
    """
    return get_full_taxonomy_tree()


@app.get("/api/taxonomy/sectors")
async def get_sectors() -> dict:
    """Get list of macro sectors (Level 1)."""
    return {"sectors": get_macro_sectors()}


@app.get("/api/taxonomy/clusters")
async def get_clusters(sector: Optional[str] = None) -> dict:
    """Get industry clusters (Level 2), optionally filtered by sector."""
    return {"clusters": get_industry_clusters(sector)}


@app.get("/api/taxonomy/business_models")
async def get_business_models(
    sector: Optional[str] = None,
    cluster: Optional[str] = None,
) -> dict:
    """Get business model groups (Level 3), optionally filtered."""
    return {"business_models": get_business_model_groups(sector, cluster)}


@app.get("/api/taxonomy/themes")
async def get_all_themes() -> dict:
    """Get all custom themes (Level 4) with descriptions."""
    return {"themes": get_themes()}


@app.get("/api/taxonomy/mapping/{ticker}")
async def get_ticker_taxonomy(ticker: str) -> dict:
    """Get taxonomy mapping for a specific ticker."""
    conn = get_connection()
    
    row = conn.execute(
        "SELECT macro_sector, industry_cluster, business_model_group, themes, override_source "
        "FROM taxonomy_map WHERE ticker = ?",
        [ticker.upper()],
    ).fetchone()
    
    if not row:
        # Check if it's in default mappings but not yet in DB
        default = DEFAULT_TICKER_TAXONOMY.get(ticker.upper())
        if default:
            return {
                "ticker": ticker.upper(),
                "macro_sector": default["macro_sector"],
                "industry_cluster": default["industry_cluster"],
                "business_model_group": default["business_model_group"],
                "themes": default.get("themes", []),
                "source": "default",
            }
        raise HTTPException(status_code=404, detail=f"No taxonomy mapping for {ticker}")
    
    return {
        "ticker": ticker.upper(),
        "macro_sector": row[0],
        "industry_cluster": row[1],
        "business_model_group": row[2],
        "themes": json.loads(row[3]) if row[3] else [],
        "source": row[4],
    }


@app.get("/api/taxonomy/mappings")
async def get_all_taxonomy_mappings() -> dict:
    """Get all ticker taxonomy mappings."""
    conn = get_connection()
    
    rows = conn.execute(
        "SELECT ticker, macro_sector, industry_cluster, business_model_group, themes, override_source "
        "FROM taxonomy_map ORDER BY macro_sector, industry_cluster, ticker"
    ).fetchall()
    
    return {
        "mappings": [
            {
                "ticker": r[0],
                "macro_sector": r[1],
                "industry_cluster": r[2],
                "business_model_group": r[3],
                "themes": json.loads(r[4]) if r[4] else [],
                "source": r[5],
            }
            for r in rows
        ]
    }


@app.post("/api/taxonomy/mapping")
async def upsert_taxonomy_mapping(payload: dict) -> dict:
    """Create or update a ticker's taxonomy mapping.
    
    Input: {
        "ticker": "AAPL",
        "macro_sector": "Technology",
        "industry_cluster": "Hardware",
        "business_model_group": "Consumer Electronics",
        "themes": ["ai_applications"]
    }
    """
    conn = get_connection()
    
    ticker = payload.get("ticker", "").upper()
    macro_sector = payload.get("macro_sector")
    industry_cluster = payload.get("industry_cluster")
    business_model_group = payload.get("business_model_group")
    themes = payload.get("themes", [])
    
    if not ticker:
        raise HTTPException(status_code=400, detail="ticker is required")
    if not macro_sector or not industry_cluster or not business_model_group:
        raise HTTPException(status_code=400, detail="macro_sector, industry_cluster, and business_model_group are required")
    
    # Validate taxonomy path
    if not validate_taxonomy(macro_sector, industry_cluster, business_model_group):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid taxonomy path: {macro_sector} -> {industry_cluster} -> {business_model_group}"
        )
    
    # Validate themes
    invalid_themes = [t for t in themes if t not in CUSTOM_THEMES]
    if invalid_themes:
        raise HTTPException(status_code=400, detail=f"Invalid themes: {invalid_themes}")
    
    themes_json = json.dumps(themes)
    
    upsert_row(conn, "taxonomy_map", {
        "ticker": ticker,
        "macro_sector": macro_sector,
        "industry_cluster": industry_cluster,
        "business_model_group": business_model_group,
        "themes": themes_json,
        "override_source": "manual",
        "updated_at": datetime.now(),
    }, ["ticker"])
    
    return {
        "ticker": ticker,
        "macro_sector": macro_sector,
        "industry_cluster": industry_cluster,
        "business_model_group": business_model_group,
        "themes": themes,
    }


@app.post("/api/taxonomy/filter")
async def filter_by_taxonomy(payload: dict) -> dict:
    """Filter tickers by taxonomy criteria.
    
    Input: {
        "macro_sector": "Financials",  # optional
        "industry_cluster": "Insurance",  # optional
        "business_model_group": "Reinsurance",  # optional
        "themes": ["rate_sensitive"],  # optional, matches any
        "include_fundamentals": true  # optional, join with fundamentals data
    }
    """
    conn = get_connection()
    
    macro_sector = payload.get("macro_sector")
    industry_cluster = payload.get("industry_cluster")
    business_model_group = payload.get("business_model_group")
    themes = payload.get("themes", [])
    include_fundamentals = payload.get("include_fundamentals", False)
    
    # Build WHERE clause
    conditions = []
    params = []
    
    if macro_sector:
        conditions.append("t.macro_sector = ?")
        params.append(macro_sector)
    if industry_cluster:
        conditions.append("t.industry_cluster = ?")
        params.append(industry_cluster)
    if business_model_group:
        conditions.append("t.business_model_group = ?")
        params.append(business_model_group)
    
    where_clause = " AND ".join(conditions) if conditions else "1=1"
    
    if include_fundamentals:
        query = f"""
            SELECT t.ticker, t.macro_sector, t.industry_cluster, t.business_model_group, t.themes,
                   f.market_cap, f.pe_ratio, f.pb_ratio, f.gross_margin, f.debt_to_equity, f.price
            FROM taxonomy_map t
            LEFT JOIN fundamentals f ON t.ticker = f.ticker
            WHERE {where_clause}
            ORDER BY t.macro_sector, t.industry_cluster, t.ticker
        """
    else:
        query = f"""
            SELECT ticker, macro_sector, industry_cluster, business_model_group, themes
            FROM taxonomy_map t
            WHERE {where_clause}
            ORDER BY macro_sector, industry_cluster, ticker
        """
    
    rows = conn.execute(query, params).fetchall()
    
    # Filter by themes if specified (post-query since themes is JSON)
    results = []
    for r in rows:
        themes_data = json.loads(r[4]) if r[4] else []
        
        # Check theme filter
        if themes and not any(t in themes_data for t in themes):
            continue
        
        if include_fundamentals:
            results.append({
                "ticker": r[0],
                "macro_sector": r[1],
                "industry_cluster": r[2],
                "business_model_group": r[3],
                "themes": themes_data,
                "market_cap": r[5],
                "pe_ratio": r[6],
                "pb_ratio": r[7],
                "gross_margin": r[8],
                "debt_to_equity": r[9],
                "price": r[10],
            })
        else:
            results.append({
                "ticker": r[0],
                "macro_sector": r[1],
                "industry_cluster": r[2],
                "business_model_group": r[3],
                "themes": themes_data,
            })
    
    return {
        "count": len(results),
        "tickers": results,
    }


@app.get("/api/taxonomy/by_sector")
async def get_tickers_by_sector() -> dict:
    """Get all tickers grouped by macro sector."""
    conn = get_connection()
    
    rows = conn.execute(
        "SELECT macro_sector, ticker FROM taxonomy_map ORDER BY macro_sector, ticker"
    ).fetchall()
    
    result: dict = {}
    for macro_sector, ticker in rows:
        if macro_sector not in result:
            result[macro_sector] = []
        result[macro_sector].append(ticker)
    
    return {"by_sector": result}


@app.get("/api/taxonomy/by_theme/{theme}")
async def get_tickers_by_theme(theme: str) -> dict:
    """Get all tickers with a specific theme tag."""
    if theme not in CUSTOM_THEMES:
        raise HTTPException(status_code=404, detail=f"Unknown theme: {theme}")
    
    conn = get_connection()
    
    rows = conn.execute(
        "SELECT ticker, macro_sector, industry_cluster, themes FROM taxonomy_map"
    ).fetchall()
    
    matches = []
    for ticker, sector, cluster, themes_json in rows:
        themes_data = json.loads(themes_json) if themes_json else []
        if theme in themes_data:
            matches.append({
                "ticker": ticker,
                "macro_sector": sector,
                "industry_cluster": cluster,
            })
    
    return {
        "theme": theme,
        "description": CUSTOM_THEMES[theme],
        "count": len(matches),
        "tickers": matches,
    }


@app.get("/api/companies")
async def get_companies(
    macro_sector: Optional[str] = None,
    industry_cluster: Optional[str] = None,
    theme: Optional[str] = None,
    include_etf: bool = True,
) -> dict:
    """Unified companies view: securities + taxonomy + optional ETF overlay.

    Use for filtering and grouping in visualizations (heatmap by sector/ETF, etc.).
    Optional query params: macro_sector, industry_cluster, theme; include_etf=true
    attaches primary_sector_etf and thematic_etfs when etf_ticker_mapping is populated
    (ETF ingestion from FMP is deferred to avoid API quota usage).
    """
    conn = get_connection()

    conditions = ["1=1"]
    params: List[Any] = []
    if macro_sector:
        conditions.append("t.macro_sector = ?")
        params.append(macro_sector)
    if industry_cluster:
        conditions.append("t.industry_cluster = ?")
        params.append(industry_cluster)
    if theme:
        # themes is JSON array text; match quoted theme in string
        conditions.append("t.themes LIKE '%' || ? || '%'")
        params.append(f'"{theme}"')

    where_sql = " AND ".join(conditions)

    # Join taxonomy_map with securities; optionally with primary sector ETF
    sql = f"""
        SELECT
            COALESCE(s.ticker, t.ticker) AS ticker,
            s.company_name AS name,
            s.sector AS sector,
            s.industry AS industry,
            s.country AS country,
            t.macro_sector,
            t.industry_cluster,
            t.business_model_group,
            t.themes
        FROM taxonomy_map t
        LEFT JOIN securities s ON s.ticker = t.ticker
        WHERE {where_sql}
        ORDER BY t.macro_sector, t.industry_cluster, t.ticker
    """
    rows = conn.execute(sql, params).fetchall()

    # If include_etf, attach primary sector ETF and thematic ETFs from etf_ticker_mapping
    primary_etf: dict = {}
    thematic_etfs: dict = {}
    if include_etf:
        try:
            etf_rows = conn.execute(
                """
                SELECT ticker, etf_symbol, etf_type, weight_pct
                FROM etf_ticker_mapping
                ORDER BY ticker, etf_type, weight_pct DESC NULLS LAST
                """
            ).fetchall()
            for ticker, etf_symbol, etf_type, weight_pct in etf_rows:
                if etf_type == "sector" and ticker not in primary_etf:
                    primary_etf[ticker] = etf_symbol
                if etf_type == "thematic":
                    if ticker not in thematic_etfs:
                        thematic_etfs[ticker] = []
                    thematic_etfs[ticker].append(etf_symbol)
        except Exception:
            pass

    companies = []
    for r in rows:
        ticker = r[0]
        themes_data = json.loads(r[8]) if r[8] else []
        rec = {
            "ticker": ticker,
            "name": r[1] or ticker,
            "sector": r[2],
            "industry": r[3],
            "country": r[4],
            "macro_sector": r[5],
            "industry_cluster": r[6],
            "business_model_group": r[7],
            "themes": themes_data,
        }
        if include_etf:
            rec["primary_sector_etf"] = primary_etf.get(ticker)
            rec["etf_display_sector"] = SECTOR_ETF_LABELS.get(primary_etf.get(ticker)) if primary_etf.get(ticker) else None
            rec["thematic_etfs"] = thematic_etfs.get(ticker, [])
        companies.append(rec)

    return {"companies": companies, "count": len(companies)}


# ============================================================================
# Time-series API Endpoints (for charts)
# ============================================================================


@app.get("/api/fundamentals_history/{ticker}")
async def get_fundamentals_history(ticker: str) -> dict:
    """Return all fundamentals rows for a ticker ordered by as_of (ascending)."""
    conn = get_connection()
    t = ticker.upper()

    # Keep this intentionally broad: return the raw fundamentals columns that exist.
    # (Front-end can pick what it needs.)
    rows = conn.execute(
        """
        SELECT *
        FROM fundamentals
        WHERE ticker = ?
        ORDER BY as_of ASC
        """,
        [t],
    ).fetchall()

    if not rows:
        return {"ticker": t, "data": [], "count": 0}

    cols = [c[0] for c in conn.execute("DESCRIBE fundamentals").fetchall()]
    data = []
    for r in rows:
        rec = dict(zip(cols, r))
        if rec.get("as_of") is not None:
            rec["as_of"] = str(rec["as_of"])
        data.append(rec)

    return {"ticker": t, "data": data, "count": len(data)}


@app.get("/api/earnings_history/{ticker}")
async def api_earnings_history(ticker: str) -> dict:
    """EPS history for a ticker derived from fundamentals (quarterly).

    This matches what the frontend expects (an object with `data: [{date, eps, ...}]`).
    """
    conn = get_connection()
    t = ticker.upper()

    rows = conn.execute(
        """
        SELECT as_of, eps, revenue, revenue_growth_yoy, eps_growth_yoy
        FROM fundamentals
        WHERE ticker = ?
        ORDER BY as_of ASC
        """,
        [t],
    ).fetchall()

    data = [
        {
            "date": str(r[0]),
            "eps": r[1],
            "revenue": r[2],
            "revenue_growth_yoy": r[3],
            "eps_growth_yoy": r[4],
        }
        for r in rows
        if r[0] is not None
    ]

    return {"ticker": t, "data": data, "count": len(data)}


@app.get("/api/price_history/{ticker}")
async def api_price_history(ticker: str, period: str = "5y") -> dict:
    """Price history for a ticker.

    Prefers `price_history` table (daily) if populated; falls back to quarterly
    snapshots from fundamentals.price.
    """
    conn = get_connection()
    t = ticker.upper()

    # 1) Try daily price_history (if any rows exist)
    try:
        daily = conn.execute(
            """
            SELECT date, close
            FROM price_history
            WHERE ticker = ?
            ORDER BY date ASC
            """,
            [t],
        ).fetchall()
    except Exception:
        daily = []

    if daily:
        return {
            "ticker": t,
            "period": period,
            "data": [{"date": str(d), "close": c} for (d, c) in daily if d is not None],
            "count": len(daily),
            "source": "price_history",
        }

    # 2) Fallback: quarterly snapshots from fundamentals
    snaps = conn.execute(
        """
        SELECT as_of, price
        FROM fundamentals
        WHERE ticker = ? AND price IS NOT NULL
        ORDER BY as_of ASC
        """,
        [t],
    ).fetchall()

    return {
        "ticker": t,
        "period": period,
        "data": [{"date": str(d), "close": c} for (d, c) in snaps if d is not None],
        "count": len(snaps),
        "source": "fundamentals",
    }


# ============================================================================
# FMP Data Ingestion
# ============================================================================

from app.universe import DEFAULT_TICKERS, get_universe as get_universe_tickers


def _tickers_from_payload(payload: dict, *, default_preset: str = "sp500") -> List[str]:
    """Resolve ticker list from request: payload['tickers'] or universe preset."""
    tickers = payload.get("tickers")
    if tickers is not None:
        return [tickers] if isinstance(tickers, str) else list(tickers)
    preset = (payload.get("preset") or default_preset).strip().lower() or "sp500"
    return get_universe_tickers(preset, fallback_to_default=True)


def _safe_float(value, default: float = 0.0) -> float:
    """Safely convert value to float."""
    if value is None:
        return default
    try:
        return float(value)
    except (ValueError, TypeError):
        return default


def _recompute_greenblatt(conn: duckdb.DuckDBPyConnection, universe: Optional[List[str]] = None) -> int:
    """Internal helper to recompute Greenblatt scores.
    
    When universe is specified, only delete+recompute scores for those tickers.
    When no universe, recompute all scores (full rebuild).
    """
    if universe:
        universe_filter = "WHERE f.ticker IN (%s)" % ",".join("?" for _ in universe)
        params: List[Any] = list(universe)
        delete_filter = "WHERE ticker IN (%s)" % ",".join("?" for _ in universe)
        delete_params: List[Any] = list(universe)
    else:
        universe_filter = ""
        params = []
        delete_filter = ""
        delete_params = []
    
    conn.execute(f"DELETE FROM greenblatt_scores {delete_filter}", delete_params)
    conn.execute(
        f"""
        INSERT INTO greenblatt_scores (ticker, as_of, earnings_yield, return_on_capital, rank)
        SELECT
            f.ticker,
            f.as_of,
            CASE WHEN f.enterprise_value > 0 THEN f.ebit / f.enterprise_value ELSE NULL END AS earnings_yield,
            CASE WHEN f.net_working_capital <> 0 THEN f.ebit / f.net_working_capital ELSE NULL END AS return_on_capital,
            ROW_NUMBER() OVER (
                ORDER BY
                    CASE WHEN f.enterprise_value <= 0 OR f.net_working_capital = 0 OR f.ebit IS NULL THEN 1 ELSE 0 END,
                    CASE WHEN f.enterprise_value > 0 THEN f.ebit / f.enterprise_value ELSE -1 END DESC
            ) AS rank
        FROM fundamentals f
        {universe_filter}
        """,
        params,
    )
    return conn.execute("SELECT COUNT(*) FROM greenblatt_scores").fetchone()[0]


async def _fetch_fmp_fundamentals(
    api_key: str,
    tickers: List[str],
    *,
    periods: int = 1,
    statement_period: str = "annual",
) -> List[dict]:
    """Fetch fundamentals from FMP for given tickers.

    `periods` controls how many statement rows to request (newest first).

    `statement_period` controls whether FMP returns annual or quarterly statements.
    Valid values: "annual" (default) or "quarter".

    Note: FMP "profile" is effectively current-only; we treat it as static metadata
    (company_name/sector/industry) rather than time-series data.
    """

    def _as_list(x):
        if isinstance(x, list):
            return x
        if isinstance(x, dict):
            return [x]
        return []

    def _by_date(rows: object) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for r in _as_list(rows):
            if not isinstance(r, dict):
                continue
            d = r.get("date")
            if isinstance(d, str) and d.strip():
                out[d] = r
        return out

    periods = int(periods or 1)
    if periods < 1:
        periods = 1
    # Guardrail: avoid accidental huge pulls.
    if periods > 40:
        periods = 40

    statement_period = (statement_period or "annual").strip().lower()
    if statement_period not in ("annual", "quarter"):
        statement_period = "annual"

    results: List[dict] = []

    async with httpx.AsyncClient(timeout=30.0) as client:
        for ticker in tickers:
            try:
                endpoints = {
                    "key_metrics": f"https://financialmodelingprep.com/api/v3/key-metrics/{ticker}",
                    "income": f"https://financialmodelingprep.com/api/v3/income-statement/{ticker}",
                    "balance": f"https://financialmodelingprep.com/api/v3/balance-sheet-statement/{ticker}",
                    "cash_flow": f"https://financialmodelingprep.com/api/v3/cash-flow-statement/{ticker}",
                    "profile": f"https://financialmodelingprep.com/api/v3/profile/{ticker}",
                    "ratios": f"https://financialmodelingprep.com/api/v3/ratios/{ticker}",
                    "growth": f"https://financialmodelingprep.com/api/v3/financial-growth/{ticker}",
                }

                responses: dict[str, object] = {}
                for name, url in endpoints.items():
                    try:
                        # Most of these endpoints support limit.
                        params = {"apikey": api_key, "limit": periods}
                        # Financial statements endpoints support period=annual|quarter; key-metrics/ratios/growth also.
                        if name != "profile":
                            params["period"] = statement_period
                        resp = await client.get(url, params=params)
                        resp.raise_for_status()
                        responses[name] = resp.json()
                    except Exception:
                        responses[name] = []

                key_metrics_by_date = _by_date(responses.get("key_metrics"))
                income_by_date = _by_date(responses.get("income"))
                balance_by_date = _by_date(responses.get("balance"))
                cash_flow_by_date = _by_date(responses.get("cash_flow"))
                ratios_by_date = _by_date(responses.get("ratios"))
                growth_by_date = _by_date(responses.get("growth"))

                profile_list = _as_list(responses.get("profile"))
                profile = profile_list[0] if profile_list and isinstance(profile_list[0], dict) else {}

                # Collect candidate dates from the time-series endpoints.
                dates: list[str] = []
                seen: set[str] = set()
                for m in (income_by_date, key_metrics_by_date, balance_by_date, cash_flow_by_date, ratios_by_date, growth_by_date):
                    for d in m.keys():
                        if d not in seen:
                            seen.add(d)
                            dates.append(d)

                if not dates:
                    continue

                # Prefer newest first, and respect requested periods.
                dates = sorted(dates, reverse=True)[:periods]

                for as_of in dates:
                    key_metrics = key_metrics_by_date.get(as_of, {})
                    income = income_by_date.get(as_of, {})
                    balance = balance_by_date.get(as_of, {})
                    cash_flow = cash_flow_by_date.get(as_of, {})
                    ratios = ratios_by_date.get(as_of, {})
                    growth = growth_by_date.get(as_of, {})

                    # Extract values
                    ebit = _safe_float(income.get("ebit") or income.get("operatingIncome"))
                    enterprise_value = _safe_float(key_metrics.get("enterpriseValue"))
                    current_assets = _safe_float(balance.get("totalCurrentAssets"))
                    current_liabilities = _safe_float(balance.get("totalCurrentLiabilities"))
                    revenue = _safe_float(income.get("revenue"))
                    gross_profit = _safe_float(income.get("grossProfit"))
                    operating_income = _safe_float(income.get("operatingIncome"))
                    net_income = _safe_float(income.get("netIncome"))
                    free_cash_flow = _safe_float(cash_flow.get("freeCashFlow"))

                    # Point-in-time valuation fields should come from key_metrics when available.
                    market_cap = _safe_float(key_metrics.get("marketCap") or profile.get("mktCap"))
                    price = _safe_float(key_metrics.get("price") or profile.get("price"))

                    total_debt = _safe_float(balance.get("totalDebt"))
                    total_equity = _safe_float(balance.get("totalStockholdersEquity"))
                    interest_expense = _safe_float(income.get("interestExpense"))
                    book_value = _safe_float(balance.get("totalStockholdersEquity"))
                    intangible_assets = _safe_float(
                        balance.get("intangibleAssets") or balance.get("goodwillAndIntangibleAssets")
                    )
                    shares_outstanding = _safe_float(
                        income.get("weightedAverageShsOut") or profile.get("sharesOutstanding")
                    )
                    ebitda = _safe_float(income.get("ebitda"))
                    eps = _safe_float(income.get("eps") or profile.get("eps"))

                    # Skip if no valuation data
                    if enterprise_value <= 0 and market_cap <= 0:
                        continue

                    fundamentals = {
                        "ticker": ticker,
                        "as_of": as_of,
                        # Company Info (static-ish)
                        "company_name": profile.get("companyName", ""),
                        "sector": profile.get("sector", ""),
                        "industry": profile.get("industry", ""),
                        # Core metrics
                        "ebit": ebit,
                        "enterprise_value": enterprise_value,
                        "net_working_capital": current_assets - current_liabilities,
                        "revenue": revenue,
                        "revenue_growth_yoy": _safe_float(growth.get("revenueGrowth")) * 100,
                        "gross_margin": (gross_profit / revenue * 100) if revenue > 0 else 0.0,
                        "operating_margin": (operating_income / revenue * 100) if revenue > 0 else 0.0,
                        "net_margin": (net_income / revenue * 100) if revenue > 0 else 0.0,
                        "free_cash_flow": free_cash_flow,
                        "fcf_yield": (free_cash_flow / market_cap * 100) if market_cap > 0 else 0.0,
                        "total_debt": total_debt,
                        "total_equity": total_equity,
                        "debt_to_equity": (total_debt / total_equity) if total_equity > 0 else 0.0,
                        "interest_coverage": (ebit / interest_expense) if interest_expense > 0 else 999.0,
                        "book_value": book_value,
                        "tangible_book_value": book_value - intangible_assets,
                        "book_value_per_share": (book_value / shares_outstanding) if shares_outstanding > 0 else 0.0,
                        "market_cap": market_cap,
                        "price": price,
                        "shares_outstanding": shares_outstanding,
                        "pe_ratio": _safe_float(ratios.get("priceEarningsRatio") or profile.get("pe")),
                        "pb_ratio": _safe_float(ratios.get("priceToBookRatio") or key_metrics.get("pbRatio")),
                        "ps_ratio": _safe_float(ratios.get("priceToSalesRatio") or key_metrics.get("priceToSalesRatio")),
                        "ev_to_ebitda": (enterprise_value / ebitda) if ebitda > 0 else 0.0,
                        "ev_to_fcf": (enterprise_value / free_cash_flow) if free_cash_flow > 0 else None,
                        "dividend_yield": _safe_float(ratios.get("dividendYield") or key_metrics.get("dividendYield")) * 100,
                        "payout_ratio": _safe_float(ratios.get("payoutRatio") or key_metrics.get("payoutRatio")) * 100,
                        "eps": eps,
                        "eps_growth_yoy": _safe_float(growth.get("epsgrowth") or growth.get("epsGrowth")) * 100,
                    }
                    results.append(fundamentals)
            except Exception:
                continue

    return results


@app.post("/ingest/fmp")
async def ingest_from_fmp(payload: Optional[dict] = None) -> dict:
    """Ingest fundamentals from Financial Modeling Prep API.

    Input: {
        "api_key": "your_fmp_key",  # optional, falls back to FMP_API_KEY env var
        "tickers": ["AAPL", "MSFT"],  # optional, defaults to curated universe
        "periods": 1,  # optional; number of statement rows to fetch (newest first)
        "period": "annual"  # optional; "annual" or "quarter"
    }
    """
    payload = payload or {}

    # Get API key: request body takes precedence, then env var
    api_key = payload.get("api_key") or os.getenv("FMP_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="No API key provided. Pass 'api_key' in request body or set FMP_API_KEY environment variable."
        )

    tickers = _tickers_from_payload(payload)
    periods = int(payload.get("periods") or 1)
    statement_period = payload.get("period") or "annual"

    # Fetch from FMP
    fundamentals = await _fetch_fmp_fundamentals(
        api_key,
        tickers,
        periods=periods,
        statement_period=statement_period,
    )
    
    if not fundamentals:
        return {"ingested": 0, "message": "No data fetched. Check API key and tickers."}
    
    # Upsert into database
    conn = get_connection()
    for row in fundamentals:
        upsert_row(conn, "fundamentals", row, ["ticker", "as_of"])
    
    # Recompute Greenblatt scores
    ingested_tickers = [r["ticker"] for r in fundamentals]
    _recompute_greenblatt(conn, ingested_tickers)
    
    # Compute formula metrics
    compute_all_formulas(conn, ingested_tickers)
    
    # Compute value compression scores
    _compute_value_compression(conn, ingested_tickers)
    
    return {
        "ingested": len(fundamentals),
        "tickers": ingested_tickers,
    }


# ============================================================================
# Yahoo Finance Data Ingestion (Free)
# ============================================================================


@app.post("/ingest/yfinance")
async def ingest_from_yfinance(payload: Optional[dict] = None) -> dict:
    """Ingest historical price and earnings data from Yahoo Finance (free).
    
    Input: {
        "tickers": ["AAPL", "MSFT"],  # optional, defaults to curated universe
        "period": "5y",  # optional: 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, max
        "include_earnings": true  # optional, fetch quarterly earnings
    }
    """
    import yfinance as yf
    
    payload = payload or {}
    tickers = _tickers_from_payload(payload)
    period = payload.get("period", "5y")
    include_earnings = payload.get("include_earnings", True)

    conn = get_connection()
    price_count = 0
    earnings_count = 0
    securities_count = 0
    errors: list[dict] = []
    
    for ticker in tickers:
        try:
            stock = yf.Ticker(ticker)
            
            # Get company info
            info = stock.info or {}
            if info.get("shortName") or info.get("longName"):
                upsert_row(conn, "securities", {
                    "ticker": ticker,
                    "company_name": info.get("shortName") or info.get("longName", ""),
                    "sector": info.get("sector", ""),
                    "industry": info.get("industry", ""),
                    "exchange": info.get("exchange", ""),
                    "country": info.get("country", ""),
                    "updated_at": datetime.now(),
                }, ["ticker"])
                securities_count += 1
            
            # Get price history
            hist = stock.history(period=period)
            if not hist.empty:
                for date_idx, row in hist.iterrows():
                    date_str = date_idx.strftime("%Y-%m-%d")
                    upsert_row(conn, "price_history", {
                        "ticker": ticker,
                        "date": date_str,
                        "open": float(row.get("Open", 0)),
                        "high": float(row.get("High", 0)),
                        "low": float(row.get("Low", 0)),
                        "close": float(row.get("Close", 0)),
                        "adj_close": float(row.get("Close", 0)),  # yfinance returns adjusted by default
                        "volume": int(row.get("Volume", 0)),
                        "fetched_at": datetime.now(),
                    }, ["ticker", "date"])
                    price_count += 1
            else:
                errors.append({"ticker": ticker, "stage": "history",
                               "error": "empty price history (yfinance may be blocked from this network)"})
            
            # Get earnings history
            if include_earnings:
                try:
                    earnings = stock.quarterly_earnings
                    if earnings is not None and not earnings.empty:
                        for date_idx, row in earnings.iterrows():
                            # date_idx is typically the quarter end date
                            if hasattr(date_idx, 'strftime'):
                                date_str = date_idx.strftime("%Y-%m-%d")
                            else:
                                date_str = str(date_idx)
                            upsert_row(conn, "earnings_history", {
                                "ticker": ticker,
                                "date": date_str,
                                "period": "Q",
                                "eps": float(row.get("Earnings", 0)) if row.get("Earnings") else None,
                                "revenue": float(row.get("Revenue", 0)) if row.get("Revenue") else None,
                                "fetched_at": datetime.now(),
                            }, ["ticker", "date", "period"])
                            earnings_count += 1
                except Exception as ee:
                    errors.append({"ticker": ticker, "stage": "earnings",
                                   "error": f"{type(ee).__name__}: {ee}"})
                    
        except Exception as e:
            print(f"Warning: Failed to fetch {ticker}: {e}")
            errors.append({"ticker": ticker, "stage": "ticker",
                           "error": f"{type(e).__name__}: {e}"})
            continue
    
    return {
        "tickers": tickers,
        "price_records": price_count,
        "earnings_records": earnings_count,
        "securities_updated": securities_count,
        "errors": errors,
    }


@app.get("/api/price_history/{ticker}")
async def get_price_history(ticker: str, period: str = "1y") -> dict:
    """Get price history for a ticker."""
    conn = get_connection()
    
    # Calculate date range based on period
    from datetime import datetime, timedelta
    periods = {
        "1mo": 30, "3mo": 90, "6mo": 180, "1y": 365,
        "2y": 730, "5y": 1825, "10y": 3650, "max": 36500
    }
    days = periods.get(period, 365)
    start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    
    rows = conn.execute(
        """
        SELECT date, open, high, low, close, adj_close, volume
        FROM price_history
        WHERE ticker = ? AND date >= ?
        ORDER BY date ASC
        """,
        [ticker, start_date],
    ).fetchall()
    
    return {
        "ticker": ticker,
        "data": [
            {
                "date": str(r[0]),
                "open": r[1],
                "high": r[2],
                "low": r[3],
                "close": r[4],
                "adj_close": r[5],
                "volume": r[6],
            }
            for r in rows
        ],
    }


@app.get("/api/earnings_history/{ticker}")
async def get_earnings_history(ticker: str) -> dict:
    """Get earnings history for a ticker."""
    conn = get_connection()
    
    rows = conn.execute(
        """
        SELECT date, period, eps, revenue, surprise_pct
        FROM earnings_history
        WHERE ticker = ?
        ORDER BY date ASC
        """,
        [ticker],
    ).fetchall()
    
    return {
        "ticker": ticker,
        "data": [
            {
                "date": str(r[0]),
                "period": r[1],
                "eps": r[2],
                "revenue": r[3],
                "surprise_pct": r[4],
            }
            for r in rows
        ],
    }


# ============================================================================
# SEC EDGAR Data Ingestion (edgartools – PyPI: edgartools)
# ============================================================================


def _run_sec_edgar_sync(
    tickers: List[str],
    include_13f: bool,
    include_insiders: bool,
    form4_months: int,
) -> tuple[int, int]:
    """Sync SEC EDGAR ingestion (run in executor). Returns (insider_count, holdings_count)."""
    from app.sec_edgar_ingest import run_sec_edgar_ingestion
    conn = get_connection()
    return run_sec_edgar_ingestion(
        conn,
        tickers,
        include_13f=include_13f,
        include_insiders=include_insiders,
        form4_months=form4_months,
    )


@app.post("/ingest/sec_edgar")
async def ingest_from_sec_edgar(payload: Optional[dict] = None) -> dict:
    """Ingest institutional holdings (13F) and insider transactions from SEC EDGAR.

    Uses the edgartools library (PyPI: edgartools). Set EDGAR_IDENTITY in the environment
    (e.g. "Your Name you@example.com") for SEC compliance; otherwise a default is used.

    Input: {
        "tickers": ["AAPL", "MSFT"],  # optional, or use "preset": "sp500"
        "include_13f": true,   # institutional holdings from known 13F filers
        "include_insiders": true,  # Form 4 insider transactions
        "form4_months": 12    # optional, how far back to fetch Form 4
    }
    """
    import asyncio

    payload = payload or {}
    tickers = _tickers_from_payload(payload)
    include_13f = payload.get("include_13f", True)
    include_insiders = payload.get("include_insiders", True)
    form4_months = int(payload.get("form4_months", 12))

    loop = asyncio.get_event_loop()
    insider_count, holdings_count = await loop.run_in_executor(
        None,
        lambda: _run_sec_edgar_sync(tickers, include_13f, include_insiders, form4_months),
    )
    return {
        "data_source": "sec_edgar",
        "tickers": tickers,
        "holdings_records": holdings_count,
        "insider_records": insider_count,
    }


# ============================================================================
# Finnhub Data Ingestion (Free tier: 60 calls/min)
# ============================================================================


@app.post("/ingest/finnhub")
async def ingest_from_finnhub(payload: Optional[dict] = None) -> dict:
    """Ingest news and analyst recommendations from Finnhub.
    
    Input: {
        "api_key": "your_finnhub_key",  # optional, uses FINNHUB_API_KEY env var
        "tickers": ["AAPL", "MSFT"],
        "include_news": true,
        "include_recommendations": true
    }
    
    Free tier: 60 API calls/minute
    """
    import time
    from datetime import datetime, timedelta
    
    payload = payload or {}
    api_key = payload.get("api_key") or os.getenv("FINNHUB_API_KEY")
    
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="No Finnhub API key. Pass 'api_key' or set FINNHUB_API_KEY env var. Get free key at finnhub.io"
        )
    
    tickers = _tickers_from_payload(payload)
    tickers = tickers[:10] if len(tickers) > 10 else tickers  # Limit for free tier
    include_news = payload.get("include_news", True)
    include_recommendations = payload.get("include_recommendations", True)

    conn = get_connection()
    news_count = 0
    rec_count = 0
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        for ticker in tickers:
            try:
                if include_news:
                    # Company news (last 7 days)
                    from_date = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
                    to_date = datetime.now().strftime("%Y-%m-%d")
                    
                    news_resp = await client.get(
                        f"https://finnhub.io/api/v1/company-news",
                        params={"symbol": ticker, "from": from_date, "to": to_date, "token": api_key}
                    )
                    time.sleep(1.1)  # Rate limit: 60/min
                    
                    if news_resp.status_code == 200:
                        news_items = news_resp.json()
                        for item in news_items[:10]:  # Limit per ticker
                            news_id = f"{ticker}_{item.get('id', item.get('datetime', ''))}"
                            upsert_row(conn, "company_news", {
                                "id": news_id,
                                "ticker": ticker,
                                "datetime": datetime.fromtimestamp(item.get("datetime", 0)).isoformat() if item.get("datetime") else None,
                                "headline": item.get("headline", ""),
                                "summary": item.get("summary", ""),
                                "source": item.get("source", ""),
                                "url": item.get("url", ""),
                                "data_source": "finnhub",
                                "fetched_at": datetime.now(),
                            }, ["id"])
                            news_count += 1
                
                if include_recommendations:
                    # Analyst recommendations
                    rec_resp = await client.get(
                        f"https://finnhub.io/api/v1/stock/recommendation",
                        params={"symbol": ticker, "token": api_key}
                    )
                    time.sleep(1.1)
                    
                    if rec_resp.status_code == 200:
                        recs = rec_resp.json()
                        for rec in recs[:4]:  # Last 4 quarters
                            upsert_row(conn, "analyst_recommendations", {
                                "ticker": ticker,
                                "date": rec.get("period", ""),
                                "strong_buy": rec.get("strongBuy", 0),
                                "buy": rec.get("buy", 0),
                                "hold": rec.get("hold", 0),
                                "sell": rec.get("sell", 0),
                                "strong_sell": rec.get("strongSell", 0),
                                "data_source": "finnhub",
                                "fetched_at": datetime.now(),
                            }, ["ticker", "date"])
                            rec_count += 1
                            
            except Exception as e:
                print(f"Warning: Finnhub error for {ticker}: {e}")
                continue
    
    return {
        "data_source": "finnhub",
        "tickers": tickers,
        "news_records": news_count,
        "recommendation_records": rec_count,
    }


# ============================================================================
# FRED Macro Data Ingestion (Free, Unlimited)
# ============================================================================

# Key FRED series for value investing context
FRED_SERIES = {
    "DGS10": ("10-Year Treasury Rate", "Percent"),
    "DGS2": ("2-Year Treasury Rate", "Percent"),
    "T10Y2Y": ("10Y-2Y Spread (Yield Curve)", "Percent"),
    "FEDFUNDS": ("Federal Funds Rate", "Percent"),
    "CPIAUCSL": ("CPI (Inflation)", "Index"),
    "UNRATE": ("Unemployment Rate", "Percent"),
    "GDP": ("Real GDP", "Billions $"),
    "VIXCLS": ("VIX Volatility Index", "Index"),
    "SP500": ("S&P 500", "Index"),
    "BAMLH0A0HYM2": ("High Yield Spread", "Percent"),
}


@app.post("/ingest/fred")
async def ingest_from_fred(payload: Optional[dict] = None) -> dict:
    """Ingest macro economic indicators from FRED (Federal Reserve).
    
    Input: {
        "api_key": "your_fred_key",  # optional, uses FRED_API_KEY env var
        "series": ["DGS10", "FEDFUNDS"],  # optional, defaults to key series
        "years": 5  # how many years of history
    }
    
    Free: Unlimited requests with API key (get at fred.stlouisfed.org)
    """
    from datetime import datetime, timedelta
    
    payload = payload or {}
    api_key = payload.get("api_key") or os.getenv("FRED_API_KEY")
    
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="No FRED API key. Pass 'api_key' or set FRED_API_KEY env var. Get free key at fred.stlouisfed.org"
        )
    
    series_ids = payload.get("series") or list(FRED_SERIES.keys())
    years = payload.get("years", 5)
    
    if isinstance(series_ids, str):
        series_ids = [series_ids]
    
    conn = get_connection()
    record_count = 0
    
    start_date = (datetime.now() - timedelta(days=years * 365)).strftime("%Y-%m-%d")
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        for series_id in series_ids:
            try:
                resp = await client.get(
                    f"https://api.stlouisfed.org/fred/series/observations",
                    params={
                        "series_id": series_id,
                        "api_key": api_key,
                        "file_type": "json",
                        "observation_start": start_date,
                    }
                )
                
                if resp.status_code == 200:
                    data = resp.json()
                    observations = data.get("observations", [])
                    
                    series_info = FRED_SERIES.get(series_id, (series_id, "Value"))
                    
                    for obs in observations:
                        value_str = obs.get("value", ".")
                        if value_str == ".":  # FRED uses "." for missing
                            continue
                            
                        upsert_row(conn, "macro_indicators", {
                            "series_id": series_id,
                            "date": obs.get("date", ""),
                            "value": float(value_str),
                            "series_name": series_info[0],
                            "units": series_info[1],
                            "data_source": "fred",
                            "fetched_at": datetime.now(),
                        }, ["series_id", "date"])
                        record_count += 1
                        
            except Exception as e:
                print(f"Warning: FRED error for {series_id}: {e}")
                continue
    
    return {
        "data_source": "fred",
        "series": series_ids,
        "records": record_count,
    }


# ============================================================================
# Universe API (presets: default, sp500, small_mid)
# ============================================================================


@app.get("/api/universe/presets")
async def list_universe_presets() -> dict:
    """List available universe presets (default, sp500, small_mid)."""
    from app.universe import PRESETS, get_preset_universe
    presets = {}
    for key, meta in PRESETS.items():
        count = meta.get("count")
        if count is None:
            count = len(get_preset_universe(key)) or None
        presets[key] = {**meta, "count": count or meta.get("count")}
    return {"presets": presets}


@app.get("/api/universe")
async def get_universe_list(preset: Optional[str] = None) -> dict:
    """Get ticker list for a preset. Query: ?preset=default|sp500|small_mid (default=default)."""
    from app.universe import get_universe, PRESETS
    preset = (preset or "default").strip().lower()
    if preset not in PRESETS:
        preset = "default"
    tickers = get_universe(preset, fallback_to_default=True)
    return {"preset": preset, "tickers": tickers, "count": len(tickers)}


@app.post("/api/universe/refresh")
async def refresh_universe(payload: Optional[dict] = None) -> dict:
    """Refresh a universe preset and cache to disk.
    
    Input: { "preset": "sp500" | "small_mid", "api_key": "..." (optional) }
    
    - sp500: Uses Wikipedia as free source (no key required). If FMP_API_KEY is
      provided, tries FMP first and falls back to Wikipedia on failure.
    - small_mid: Requires FMP_API_KEY (uses stock screener with market cap filters).
    """
    payload = payload or {}
    preset = (payload.get("preset") or "sp500").strip().lower()
    api_key = payload.get("api_key") or os.getenv("FMP_API_KEY")
    
    try:
        if preset == "small_mid":
            from app.universe import refresh_small_mid
            symbols = refresh_small_mid(fmp_api_key=api_key)
            return {"preset": "small_mid", "tickers": symbols, "count": len(symbols)}
        else:
            # Default to sp500 refresh
            from app.universe import refresh_sp500
            symbols = refresh_sp500(fmp_api_key=api_key)
            return {"preset": "sp500", "tickers": symbols, "count": len(symbols)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        # Sanitize error to avoid leaking API keys in URLs
        err_msg = str(e)
        if "apikey" in err_msg.lower():
            err_msg = "External API request failed"
        raise HTTPException(status_code=502, detail=f"Refresh failed: {err_msg}")


# ============================================================================
# Run All Ingestion & Schedule Status
# ============================================================================


@app.post("/ingest/run_all")
async def run_all_ingestion(payload: Optional[dict] = None) -> dict:
    """Run all ingestion endpoints in one go (yfinance, FMP, FRED, Finnhub, SEC EDGAR).

    Uses env vars for API keys; sources without keys are skipped.
    Input: { "tickers": ["AAPL", "MSFT"], "preset": "sp500", "period": "2y", "fred_years": 5 } (all optional).
    """
    from app.scheduler import run_scheduled_ingestion
    payload = payload or {}
    tickers = _tickers_from_payload(payload)
    # Run in thread so we don't block the event loop for minutes
    import asyncio
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None,
        lambda: run_scheduled_ingestion(tickers=tickers),
    )
    return {"status": "ok", "message": "Ingestion run_all completed (check logs for per-source results)."}


@app.get("/api/ingestion/schedule")
async def get_ingestion_schedule() -> dict:
    """Return whether scheduled ingestion is enabled and the cron expression."""
    cron = os.getenv("INGESTION_SCHEDULE_CRON", "0 6 * * *")
    enabled = os.getenv("INGESTION_SCHEDULE_ENABLED", "").strip().lower() in ("1", "true", "yes")
    return {"enabled": enabled, "cron": cron, "description": "Daily at 6:00 AM UTC" if cron == "0 6 * * *" else cron}


# ============================================================================
# Data Source Status & Query APIs
# ============================================================================


@app.get("/api/data_freshness")
async def get_data_freshness() -> dict:
    """Get last-refresh timestamps for all data tables."""
    conn = get_connection()
    
    tables = [
        ("fundamentals", "as_of", None),
        ("price_history", "date", "fetched_at"),
        ("greenblatt_scores", "as_of", None),
        ("value_compression_scores", "as_of", None),
        ("vrr_positions", "as_of", None),
        ("compounding_discount_monitor", "as_of", None),
        ("computed_metrics", "as_of", "computed_at"),
    ]
    
    freshness = {}
    overall_latest = None
    
    for table, date_col, ts_col in tables:
        try:
            # Get latest data date
            row = conn.execute(f"SELECT MAX({date_col}) FROM {table}").fetchone()
            latest_date = str(row[0]) if row and row[0] else None
            
            # Get latest ingestion/compute timestamp if column exists
            latest_ts = None
            if ts_col:
                ts_row = conn.execute(f"SELECT MAX({ts_col}) FROM {table}").fetchone()
                latest_ts = str(ts_row[0]) if ts_row and ts_row[0] else None
            
            # Get row count
            cnt = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            
            entry = {"latest_date": latest_date, "row_count": cnt}
            if latest_ts:
                entry["last_ingested"] = latest_ts
            
            freshness[table] = entry
            
            # Track overall latest date
            if latest_date:
                if overall_latest is None or latest_date > overall_latest:
                    overall_latest = latest_date
        except Exception:
            freshness[table] = {"error": "table not found"}
    
    return {
        "freshness": freshness,
        "last_data_date": overall_latest,
    }


@app.get("/api/data_sources")
async def get_data_sources_status() -> dict:
    """Get status of all data sources and record counts."""
    conn = get_connection()
    
    sources = {}
    
    # Count records by source
    tables = [
        ("price_history", "data_source"),
        ("earnings_history", "data_source"),
        ("institutional_holdings", "data_source"),
        ("insider_transactions", "data_source"),
        ("company_news", "data_source"),
        ("analyst_recommendations", "data_source"),
        ("macro_indicators", "data_source"),
    ]
    
    for table, col in tables:
        try:
            rows = conn.execute(f"SELECT {col}, COUNT(*) FROM {table} GROUP BY {col}").fetchall()
            for source, count in rows:
                if source not in sources:
                    sources[source] = {"tables": {}, "total": 0}
                sources[source]["tables"][table] = count
                sources[source]["total"] += count
        except Exception:
            pass
    
    # Add fundamentals count (from FMP)
    try:
        fund_count = conn.execute("SELECT COUNT(*) FROM fundamentals").fetchone()[0]
        if "fmp" not in sources:
            sources["fmp"] = {"tables": {}, "total": 0}
        sources["fmp"]["tables"]["fundamentals"] = fund_count
        sources["fmp"]["total"] += fund_count
    except Exception:
        pass
    
    return {"sources": sources}


@app.get("/api/insider_transactions/{ticker}")
async def get_insider_transactions(ticker: str, limit: int = 20) -> dict:
    """Get insider transactions for a ticker."""
    conn = get_connection()
    
    rows = conn.execute(
        """
        SELECT filing_date, trade_date, insider_name, insider_title, 
               transaction_type, shares, price, value
        FROM insider_transactions
        WHERE ticker = ?
        ORDER BY filing_date DESC
        LIMIT ?
        """,
        [ticker, limit],
    ).fetchall()
    
    return {
        "ticker": ticker,
        "data": [
            {
                "filing_date": str(r[0]) if r[0] else None,
                "trade_date": str(r[1]) if r[1] else None,
                "insider_name": r[2],
                "insider_title": r[3],
                "transaction_type": r[4],
                "shares": r[5],
                "price": r[6],
                "value": r[7],
            }
            for r in rows
        ],
    }


@app.get("/api/company_news/{ticker}")
async def get_company_news(ticker: str, limit: int = 20) -> dict:
    """Get news for a ticker."""
    conn = get_connection()
    
    rows = conn.execute(
        """
        SELECT datetime, headline, summary, source, url
        FROM company_news
        WHERE ticker = ?
        ORDER BY datetime DESC
        LIMIT ?
        """,
        [ticker, limit],
    ).fetchall()
    
    return {
        "ticker": ticker,
        "data": [
            {
                "datetime": str(r[0]) if r[0] else None,
                "headline": r[1],
                "summary": r[2],
                "source": r[3],
                "url": r[4],
            }
            for r in rows
        ],
    }


@app.get("/api/macro/{series_id}")
async def get_macro_indicator(series_id: str, period: str = "5y") -> dict:
    """Get macro indicator time series."""
    from datetime import datetime, timedelta
    
    conn = get_connection()
    
    periods = {"1y": 365, "2y": 730, "5y": 1825, "10y": 3650}
    days = periods.get(period, 1825)
    start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    
    rows = conn.execute(
        """
        SELECT date, value, series_name, units
        FROM macro_indicators
        WHERE series_id = ? AND date >= ?
        ORDER BY date ASC
        """,
        [series_id, start_date],
    ).fetchall()
    
    return {
        "series_id": series_id,
        "series_name": rows[0][2] if rows else series_id,
        "units": rows[0][3] if rows else "Value",
        "data": [
            {"date": str(r[0]), "value": r[1]}
            for r in rows
        ],
    }


@app.get("/api/analyst_recommendations/{ticker}")
async def get_analyst_recommendations(ticker: str, limit: int = 10) -> dict:
    """Get analyst recommendations history for a ticker."""
    conn = get_connection()
    
    rows = conn.execute(
        """
        SELECT date, strong_buy, buy, hold, sell, strong_sell
        FROM analyst_recommendations
        WHERE ticker = ?
        ORDER BY date DESC
        LIMIT ?
        """,
        [ticker, limit],
    ).fetchall()
    
    # Calculate current consensus
    latest = rows[0] if rows else None
    consensus = None
    if latest:
        total = (latest[1] or 0) + (latest[2] or 0) + (latest[3] or 0) + (latest[4] or 0) + (latest[5] or 0)
        if total > 0:
            score = ((latest[1] or 0) * 5 + (latest[2] or 0) * 4 + (latest[3] or 0) * 3 + 
                    (latest[4] or 0) * 2 + (latest[5] or 0) * 1) / total
            if score >= 4.5: consensus = "Strong Buy"
            elif score >= 3.5: consensus = "Buy"
            elif score >= 2.5: consensus = "Hold"
            elif score >= 1.5: consensus = "Sell"
            else: consensus = "Strong Sell"
    
    return {
        "ticker": ticker,
        "consensus": consensus,
        "data": [
            {
                "date": str(r[0]) if r[0] else None,
                "strong_buy": r[1],
                "buy": r[2],
                "hold": r[3],
                "sell": r[4],
                "strong_sell": r[5],
            }
            for r in rows
        ],
    }


@app.get("/api/whale_activity")
async def get_whale_activity(limit: int = 50) -> dict:
    """Get recent institutional holdings activity across all stocks.
    
    Returns new positions, increased positions, and decreased positions
    from 13F filings. Data is quarterly.
    """
    conn = get_connection()
    
    # New positions (where this is first filing or previous was 0)
    new_positions = conn.execute(
        """
        SELECT h.ticker, h.holder_name, h.shares, h.value, h.report_date, f.price
        FROM institutional_holdings h
        LEFT JOIN fundamentals f ON h.ticker = f.ticker
        WHERE h.change_shares > 0 AND (h.change_pct IS NULL OR h.change_pct > 100)
        ORDER BY h.value DESC
        LIMIT ?
        """,
        [limit],
    ).fetchall()
    
    # Increased positions (significant increases)
    increased = conn.execute(
        """
        SELECT h.ticker, h.holder_name, h.shares, h.value, h.change_shares, h.change_pct, h.report_date, f.price
        FROM institutional_holdings h
        LEFT JOIN fundamentals f ON h.ticker = f.ticker
        WHERE h.change_shares > 0 AND h.change_pct > 5 AND h.change_pct <= 100
        ORDER BY h.value DESC
        LIMIT ?
        """,
        [limit],
    ).fetchall()
    
    # Decreased positions (significant decreases)
    decreased = conn.execute(
        """
        SELECT h.ticker, h.holder_name, h.shares, h.value, h.change_shares, h.change_pct, h.report_date, f.price
        FROM institutional_holdings h
        LEFT JOIN fundamentals f ON h.ticker = f.ticker
        WHERE h.change_shares < 0 AND h.change_pct < -5
        ORDER BY ABS(h.change_shares) DESC
        LIMIT ?
        """,
        [limit],
    ).fetchall()
    
    return {
        "filing_frequency": "quarterly",
        "new_positions": [
            {
                "ticker": r[0], "holder": r[1], "shares": r[2], 
                "value": r[3], "report_date": str(r[4]) if r[4] else None,
                "price": r[5]
            }
            for r in new_positions
        ],
        "increased": [
            {
                "ticker": r[0], "holder": r[1], "shares": r[2], "value": r[3],
                "change_shares": r[4], "change_pct": r[5],
                "report_date": str(r[6]) if r[6] else None, "price": r[7]
            }
            for r in increased
        ],
        "decreased": [
            {
                "ticker": r[0], "holder": r[1], "shares": r[2], "value": r[3],
                "change_shares": r[4], "change_pct": r[5],
                "report_date": str(r[6]) if r[6] else None, "price": r[7]
            }
            for r in decreased
        ],
    }


@app.get("/api/whale_holdings/{ticker}")
async def get_whale_holdings_for_ticker(ticker: str, limit: int = 20) -> dict:
    """Get institutional holders for a specific ticker."""
    conn = get_connection()
    
    rows = conn.execute(
        """
        SELECT holder_name, shares, value, pct_of_portfolio, 
               change_shares, change_pct, report_date
        FROM institutional_holdings
        WHERE ticker = ?
        ORDER BY value DESC
        LIMIT ?
        """,
        [ticker, limit],
    ).fetchall()
    
    # Calculate totals
    total_shares = sum(r[1] or 0 for r in rows)
    total_value = sum(r[2] or 0 for r in rows)
    net_change = sum(r[4] or 0 for r in rows)
    
    return {
        "ticker": ticker,
        "total_institutional_shares": total_shares,
        "total_institutional_value": total_value,
        "net_share_change": net_change,
        "holders": [
            {
                "holder": r[0],
                "shares": r[1],
                "value": r[2],
                "pct_of_portfolio": r[3],
                "change_shares": r[4],
                "change_pct": r[5],
                "report_date": str(r[6]) if r[6] else None,
            }
            for r in rows
        ],
    }


@app.get("/api/macro_overview")
async def get_macro_overview() -> dict:
    """Get latest values for key macro indicators."""
    conn = get_connection()
    
    indicators = [
        "DGS10",    # 10-Year Treasury
        "DGS2",     # 2-Year Treasury  
        "T10Y2Y",   # Yield Curve Spread
        "FEDFUNDS", # Fed Funds Rate
        "VIXCLS",   # VIX
        "CPIAUCSL", # CPI
        "UNRATE",   # Unemployment
    ]
    
    result = {}
    for series_id in indicators:
        row = conn.execute(
            """
            SELECT date, value, series_name, units
            FROM macro_indicators
            WHERE series_id = ?
            ORDER BY date DESC
            LIMIT 1
            """,
            [series_id],
        ).fetchone()
        
        if row:
            result[series_id] = {
                "date": str(row[0]),
                "value": row[1],
                "name": row[2],
                "units": row[3],
            }
    
    return {"indicators": result}


# ============================================================================
# Portfolio Signal Tracker + Capital Efficiency Endpoints
# ============================================================================


def _get_signal_snapshot(conn: duckdb.DuckDBPyConnection, ticker: str, as_of_date: str) -> List[dict]:
    """Get each visualization's zone/threshold classification for a ticker at a given date.
    
    Returns list of {signal_type, signal_value, signal_label} matching the
    signal_strength_tracker schema.
    """
    signals = []
    
    # 1. Value Compression: target zone = high stability + high compression
    vc_row = conn.execute(
        """
        SELECT operational_stability, valuation_compression
        FROM value_compression_scores
        WHERE ticker = ? AND as_of <= ?::DATE
        ORDER BY as_of DESC LIMIT 1
        """,
        [ticker, as_of_date],
    ).fetchone()
    if vc_row:
        stability, compression = vc_row[0], vc_row[1]
        # Target zone: both stability > 50 and compression > 50
        in_target = stability > 50 and compression > 50
        signals.append({
            "signal_type": "value_compression",
            "signal_value": (stability + compression) / 2.0,
            "signal_label": "target_zone" if in_target else "not_target",
        })
    
    # 2. VRR Action: add_aggressively / add_capital / patience / rotate
    vrr_row = conn.execute(
        """
        SELECT action, vrr_pct
        FROM vrr_positions
        WHERE ticker = ? AND as_of <= ?::DATE
        ORDER BY as_of DESC LIMIT 1
        """,
        [ticker, as_of_date],
    ).fetchone()
    if vrr_row:
        signals.append({
            "signal_type": "vrr_action",
            "signal_value": vrr_row[1] or 0,
            "signal_label": vrr_row[0] or "unknown",
        })
    
    # 3. Compounding Discount quadrant: opportunity / patience / value_trap / watch / efficient / overvalued
    cd_row = conn.execute(
        """
        SELECT quadrant, bvps_cagr_5yr
        FROM compounding_discount_monitor
        WHERE ticker = ? AND as_of <= ?::DATE
        ORDER BY as_of DESC LIMIT 1
        """,
        [ticker, as_of_date],
    ).fetchone()
    if cd_row:
        signals.append({
            "signal_type": "compounding_discount",
            "signal_value": cd_row[1] or 0,
            "signal_label": cd_row[0] or "unknown",
        })
    
    # 4. Greenblatt rank: top decile (rank <= N/10)
    gb_row = conn.execute(
        """
        SELECT rank, earnings_yield
        FROM greenblatt_scores
        WHERE ticker = ? AND as_of <= ?::DATE
        ORDER BY as_of DESC LIMIT 1
        """,
        [ticker, as_of_date],
    ).fetchone()
    if gb_row:
        rank = gb_row[0]
        total_stocks = conn.execute("SELECT COUNT(DISTINCT ticker) FROM greenblatt_scores").fetchone()[0]
        top_decile_cutoff = max(1, total_stocks // 10)
        signals.append({
            "signal_type": "greenblatt_rank",
            "signal_value": gb_row[1] or 0,
            "signal_label": "top_decile" if (rank and rank <= top_decile_cutoff) else "not_top_decile",
        })
    
    # 5. Torque score: from computed_metrics (eps_growth + rev_growth) / PE
    torque_row = conn.execute(
        """
        SELECT value
        FROM computed_metrics
        WHERE ticker = ? AND metric_name = 'Torque Score' AND as_of <= ?::DATE
        ORDER BY as_of DESC LIMIT 1
        """,
        [ticker, as_of_date],
    ).fetchone()
    if torque_row:
        torque_val = torque_row[0] or 0
        # Median torque as bullish threshold
        median_torque = conn.execute(
            "SELECT MEDIAN(value) FROM computed_metrics WHERE metric_name = 'Torque Score' AND value IS NOT NULL"
        ).fetchone()[0]
        signals.append({
            "signal_type": "torque_score",
            "signal_value": torque_val,
            "signal_label": "above_median" if torque_val >= (median_torque or 0) else "below_median",
        })
    
    return signals


def _compute_signal_strength(conn: duckdb.DuckDBPyConnection) -> int:
    """Backtest: for each holding, look up the visualization zone/threshold at buy_date
    and compute forward returns using price_history.
    
    Signal is 'correct' when the visualization's bullish zone was occupied AND
    forward returns were positive.
    """
    from datetime import datetime, timedelta
    
    holdings = conn.execute(
        "SELECT ticker, buy_date, buy_price FROM portfolio_holdings"
    ).fetchall()
    
    rows_inserted = 0
    
    for ticker, buy_date, buy_price in holdings:
        buy_date_str = str(buy_date)
        
        # Get signal snapshot at buy date
        signals = _get_signal_snapshot(conn, ticker, buy_date_str)
        
        for sig in signals:
            signal_type = sig["signal_type"]
            signal_value = sig["signal_value"]
            signal_label = sig["signal_label"]
            
            # Compute forward returns from price_history
            # 1mo, 3mo, 6mo, 1yr after buy_date
            fwd_returns = {}
            for label, days in [("1mo", 30), ("3mo", 90), ("6mo", 180), ("1yr", 365)]:
                try:
                    target_date = (datetime.strptime(buy_date_str, "%Y-%m-%d") + timedelta(days=days)).strftime("%Y-%m-%d")
                    fwd_row = conn.execute(
                        """
                        SELECT adj_close
                        FROM price_history
                        WHERE ticker = ? AND date >= ?::DATE
                        ORDER BY date ASC LIMIT 1
                        """,
                        [ticker, target_date],
                    ).fetchone()
                    if fwd_row and buy_price and buy_price > 0:
                        fwd_returns[f"return_{label}"] = round(((fwd_row[0] - buy_price) / buy_price) * 100, 2)
                    else:
                        fwd_returns[f"return_{label}"] = None
                except Exception:
                    fwd_returns[f"return_{label}"] = None
            
            # Determine correctness: bullish zone + positive 3mo forward return
            bullish_zones = {
                "value_compression": "target_zone",
                "vrr_action": "add_aggressively",  # add_capital is borderline
                "compounding_discount": "opportunity",
                "greenblatt_rank": "top_decile",
                "torque_score": "above_median",
            }
            is_bullish = signal_label == bullish_zones.get(signal_type, "")
            # Also accept add_capital as bullish for VRR
            if signal_type == "vrr_action" and signal_label == "add_capital":
                is_bullish = True
            # Patience is also mildly bullish for compounding discount
            if signal_type == "compounding_discount" and signal_label == "patience":
                is_bullish = True
            
            fwd_3mo = fwd_returns.get("return_3mo")
            was_correct = None
            if is_bullish and fwd_3mo is not None:
                was_correct = fwd_3mo > 0
            elif not is_bullish and fwd_3mo is not None:
                was_correct = fwd_3mo <= 0  # bearish signal + negative return = correct
            
            upsert_row(conn, "signal_strength_tracker", {
                "ticker": ticker,
                "signal_date": buy_date_str,
                "signal_type": signal_type,
                "signal_value": signal_value,
                "signal_label": signal_label,
                "return_1mo": fwd_returns.get("return_1mo"),
                "return_3mo": fwd_returns.get("return_3mo"),
                "return_6mo": fwd_returns.get("return_6mo"),
                "return_1yr": fwd_returns.get("return_1yr"),
                "was_correct": was_correct,
                "computed_at": datetime.now(),
            }, ["ticker", "signal_date", "signal_type"])
            rows_inserted += 1
    
    return rows_inserted


def _compute_capital_efficiency(conn: duckdb.DuckDBPyConnection) -> dict:
    """Compute capital efficiency for each holding + portfolio-level summary."""
    from datetime import datetime, timedelta
    
    holdings = conn.execute(
        "SELECT ticker, buy_date, buy_price, shares, cost_basis, sector FROM portfolio_holdings"
    ).fetchall()
    
    total_cost = sum(h[4] or 0 for h in holdings)
    positions = []
    
    for ticker, buy_date, buy_price, shares, cost_basis, sector in holdings:
        buy_date_str = str(buy_date)
        holding_days = (datetime.now() - datetime.strptime(buy_date_str, "%Y-%m-%d")).days if buy_date else 0
        
        # Current price from fundamentals
        current_row = conn.execute(
            "SELECT price FROM fundamentals WHERE ticker = ? ORDER BY as_of DESC LIMIT 1",
            [ticker],
        ).fetchone()
        current_price = current_row[0] if current_row else buy_price
        
        market_value = (current_price or 0) * (shares or 0)
        unrealized_pnl = market_value - (cost_basis or 0)
        return_pct = ((current_price - buy_price) / buy_price * 100) if buy_price and buy_price > 0 else 0
        annualized_return = ((1 + return_pct / 100) ** (365 / max(holding_days, 1)) - 1) * 100 if holding_days > 0 else 0
        
        # Portfolio weight
        portfolio_weight = (cost_basis / total_cost * 100) if total_cost > 0 else 0
        
        # Capital efficiency score: annualized return / portfolio weight
        capital_efficiency_score = (annualized_return / portfolio_weight * 100) if portfolio_weight > 0 else 0
        
        # Gain status: compare recent 90-day vs overall annualized
        recent_return = 0.0
        try:
            ninety_days_ago = (datetime.now() - timedelta(days=90)).strftime("Y-%m-%d")
            price_90d_ago = conn.execute(
                """
                SELECT adj_close FROM price_history
                WHERE ticker = ? AND date <= ?::DATE
                ORDER BY date DESC LIMIT 1
                """,
                [ticker, ninety_days_ago],
            ).fetchone()
            if price_90d_ago and price_90d_ago[0] and current_price:
                recent_return = ((current_price - price_90d_ago[0]) / price_90d_ago[0]) * 100
        except Exception:
            pass
        recent_ann = ((1 + recent_return / 100) ** (365 / 90) - 1) * 100 if recent_return else 0
        
        if recent_ann > annualized_return * 1.1 and annualized_return > 0:
            gain_status = "continuing"
        elif recent_ann < annualized_return * 0.7:
            gain_status = "decelerating"
        else:
            gain_status = "stable"
        
        # Opportunity cost: best available signal return at buy_date vs actual
        # Find highest forward return among all tickers with bullish signals at that date
        best_available = conn.execute(
            """
            SELECT MAX(return_3mo) FROM signal_strength_tracker
            WHERE signal_date = ?::DATE AND was_correct = TRUE AND return_3mo IS NOT NULL
            """,
            [buy_date_str],
        ).fetchone()
        best_available_return = best_available[0] if best_available and best_available[0] else 0
        actual_3mo = None
        try:
            target_3mo = (datetime.strptime(buy_date_str, "%Y-%m-%d") + timedelta(days=90)).strftime("Y-%m-%d")
            fwd_3mo_row = conn.execute(
                """
                SELECT adj_close FROM price_history
                WHERE ticker = ? AND date >= ?::DATE
                ORDER BY date ASC LIMIT 1
                """,
                [ticker, target_3mo],
            ).fetchone()
            if fwd_3mo_row and buy_price and buy_price > 0:
                actual_3mo = ((fwd_3mo_row[0] - buy_price) / buy_price) * 100
        except Exception:
            pass
        opportunity_cost_pct = (best_available_return - (actual_3mo or 0)) if best_available_return else 0
        opportunity_cost_dollars = (opportunity_cost_pct / 100) * (cost_basis or 0)
        
        # Deploy recommendation based on current signals
        current_signals = _get_signal_snapshot(conn, ticker, datetime.now().strftime("%Y-%m-%d"))
        bullish_count = 0
        bearish_count = 0
        for sig in current_signals:
            bullish_zones = {
                "value_compression": "target_zone",
                "vrr_action": "add_aggressively",
                "compounding_discount": "opportunity",
                "greenblatt_rank": "top_decile",
                "torque_score": "above_median",
            }
            if sig["signal_label"] == bullish_zones.get(sig["signal_type"], "") or \
               (sig["signal_type"] == "vrr_action" and sig["signal_label"] == "add_capital") or \
               (sig["signal_type"] == "compounding_discount" and sig["signal_label"] == "patience"):
                bullish_count += 1
            elif sig["signal_label"] in ("rotate", "value_trap", "overvalued", "not_target", "not_top_decile", "below_median"):
                bearish_count += 1
        
        if bullish_count >= 2:
            deploy_recommendation = "add"
        elif bearish_count >= 2:
            deploy_recommendation = "trim"
        else:
            deploy_recommendation = "hold"
        
        positions.append({
            "ticker": ticker,
            "buy_date": buy_date_str,
            "buy_price": buy_price,
            "shares": shares,
            "cost_basis": cost_basis,
            "current_price": current_price,
            "market_value": round(market_value, 2),
            "unrealized_pnl": round(unrealized_pnl, 2),
            "return_pct": round(return_pct, 2),
            "annualized_return": round(annualized_return, 2),
            "holding_period_days": holding_days,
            "sector": sector,
            "capital_efficiency_score": round(capital_efficiency_score, 2),
            "gain_status": gain_status,
            "opportunity_cost_pct": round(opportunity_cost_pct, 2),
            "opportunity_cost_dollars": round(opportunity_cost_dollars, 2),
            "deploy_recommendation": deploy_recommendation,
            "current_signals": current_signals,
        })
    
    # Portfolio-level summary
    total_market_value = sum(p["market_value"] for p in positions)
    total_pnl = sum(p["unrealized_pnl"] for p in positions)
    
    # Weighted average annualized return
    if total_cost > 0:
        weighted_avg_return = sum(p["annualized_return"] * p["cost_basis"] for p in positions) / total_cost
    else:
        weighted_avg_return = 0
    
    # Time-weighted return approximation
    twr = ((total_market_value - total_cost) / total_cost * 100) if total_cost > 0 else 0
    
    # Top efficient and capital traps
    sorted_by_eff = sorted(positions, key=lambda p: p["capital_efficiency_score"], reverse=True)
    top_efficient = [{"ticker": p["ticker"], "score": p["capital_efficiency_score"]} for p in sorted_by_eff[:3]]
    capital_traps = [{"ticker": p["ticker"], "score": p["capital_efficiency_score"]} for p in sorted_by_eff[-3:] if p["capital_efficiency_score"] < 0]
    
    continuing_count = sum(1 for p in positions if p["gain_status"] == "continuing")
    decelerating_count = sum(1 for p in positions if p["gain_status"] == "decelerating")
    
    total_opp_cost = sum(p["opportunity_cost_dollars"] for p in positions)
    
    # Redeploy recommendations: trim from decelerating/low-efficiency, add to current top signals
    trim_candidates = [p["ticker"] for p in positions if p["deploy_recommendation"] == "trim"]
    add_candidates = [p["ticker"] for p in positions if p["deploy_recommendation"] == "add"]
    
    summary = {
        "total_value": round(total_market_value, 2),
        "total_cost": round(total_cost, 2),
        "total_pnl": round(total_pnl, 2),
        "weighted_avg_return": round(weighted_avg_return, 2),
        "twr": round(twr, 2),
        "top_efficient": top_efficient,
        "capital_traps": capital_traps,
        "total_opportunity_cost": round(total_opp_cost, 2),
        "continuing_count": continuing_count,
        "decelerating_count": decelerating_count,
        "trim_candidates": trim_candidates,
        "add_candidates": add_candidates,
    }
    
    return {"positions": positions, "summary": summary}


@app.post("/mcp/portfolio.upsert_holding")
async def upsert_holding(payload: dict) -> dict:
    """Add or update a portfolio holding.
    
    Input: {
        "ticker": "AAPL",
        "buy_date": "2024-03-15",
        "buy_price": 185.0,
        "shares": 50,
        "sector": "Technology",  -- optional
        "notes": "Initial position"  -- optional
    }
    """
    ticker = payload.get("ticker", "").upper()
    buy_date = payload.get("buy_date", "")
    buy_price = float(payload.get("buy_price", 0))
    shares = float(payload.get("shares", 0))
    sector = payload.get("sector")
    notes = payload.get("notes")
    
    if not ticker or not buy_date or buy_price <= 0 or shares <= 0:
        raise HTTPException(status_code=400, detail="ticker, buy_date, buy_price > 0, and shares > 0 are required")
    
    cost_basis = buy_price * shares
    
    conn = get_connection()
    upsert_row(conn, "portfolio_holdings", {
        "ticker": ticker,
        "buy_date": buy_date,
        "buy_price": buy_price,
        "shares": shares,
        "cost_basis": cost_basis,
        "sector": sector,
        "notes": notes,
    }, ["ticker", "buy_date"])
    
    return {"ticker": ticker, "buy_date": buy_date, "cost_basis": cost_basis}


@app.post("/mcp/portfolio.delete_holding")
async def delete_holding(payload: dict) -> dict:
    """Delete a portfolio holding.
    
    Input: { "ticker": "AAPL", "buy_date": "2024-03-15" }
    """
    ticker = payload.get("ticker", "").upper()
    buy_date = payload.get("buy_date", "")
    
    if not ticker or not buy_date:
        raise HTTPException(status_code=400, detail="ticker and buy_date are required")
    
    conn = get_connection()
    conn.execute("DELETE FROM portfolio_holdings WHERE ticker = ? AND buy_date = ?::DATE", [ticker, buy_date])
    conn.execute("DELETE FROM signal_strength_tracker WHERE ticker = ? AND signal_date = ?::DATE", [ticker, buy_date])
    
    return {"deleted": True, "ticker": ticker, "buy_date": buy_date}


@app.post("/mcp/portfolio.query_holdings")
async def query_holdings(payload: Optional[dict] = None) -> dict:
    """Query all portfolio holdings with enrichment.
    
    Returns each holding with current price, return calculations, and
    the signal snapshot at the time of purchase.
    """
    from datetime import datetime
    
    conn = get_connection()
    
    holdings = conn.execute(
        "SELECT ticker, buy_date, buy_price, shares, cost_basis, sector, notes FROM portfolio_holdings ORDER BY buy_date"
    ).fetchall()
    
    enriched = []
    for ticker, buy_date, buy_price, shares, cost_basis, sector, notes in holdings:
        buy_date_str = str(buy_date)
        holding_days = (datetime.now() - datetime.strptime(buy_date_str, "%Y-%m-%d")).days if buy_date else 0
        
        # Current price
        current_row = conn.execute(
            "SELECT price FROM fundamentals WHERE ticker = ? ORDER BY as_of DESC LIMIT 1",
            [ticker],
        ).fetchone()
        current_price = current_row[0] if current_row else None
        
        # Returns
        market_value = (current_price or buy_price) * shares
        unrealized_pnl = market_value - cost_basis
        return_pct = ((current_price - buy_price) / buy_price * 100) if current_price and buy_price and buy_price > 0 else None
        annualized_return = ((1 + (return_pct or 0) / 100) ** (365 / max(holding_days, 1)) - 1) * 100 if holding_days > 0 and return_pct is not None else None
        
        # Signal snapshot at buy date
        signals_at_buy = _get_signal_snapshot(conn, ticker, buy_date_str)
        
        enriched.append({
            "ticker": ticker,
            "buy_date": buy_date_str,
            "buy_price": buy_price,
            "shares": shares,
            "cost_basis": cost_basis,
            "current_price": current_price,
            "market_value": round(market_value, 2),
            "unrealized_pnl": round(unrealized_pnl, 2),
            "return_pct": round(return_pct, 2) if return_pct is not None else None,
            "annualized_return": round(annualized_return, 2) if annualized_return is not None else None,
            "holding_period_days": holding_days,
            "sector": sector,
            "notes": notes,
            "signals_at_buy": signals_at_buy,
        })
    
    return {"holdings": enriched, "count": len(enriched)}


@app.post("/mcp/portfolio.compute_signal_strength")
async def compute_signal_strength(payload: Optional[dict] = None) -> dict:
    """Recompute signal strength tracker for all holdings.
    
    For each holding, looks up the visualization zone/threshold at buy_date
    and computes forward returns using price_history to backtest whether
    the zone classification predicted returns.
    """
    conn = get_connection()
    
    # Ensure signal tables are populated first
    _compute_value_compression(conn)
    _compute_vrr_positions(conn)
    _compute_compounding_discount(conn)
    _recompute_greenblatt(conn)
    compute_all_formulas(conn)
    
    count = _compute_signal_strength(conn)
    
    return {"computed_count": count}


@app.post("/mcp/portfolio.query_signal_strength")
async def query_signal_strength(payload: Optional[dict] = None) -> dict:
    """Query aggregated signal strength / accuracy.
    
    Input (optional): { "signal_type": "vrr_action" }
    
    Returns per-signal-type accuracy and cross-signal comparison.
    """
    payload = payload or {}
    signal_type_filter = payload.get("signal_type")
    
    conn = get_connection()
    
    # Per-signal-type aggregation
    conditions = []
    params: List[Any] = []
    if signal_type_filter:
        conditions.append("signal_type = ?")
        params.append(signal_type_filter)
    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    
    agg_rows = conn.execute(
        f"""
        SELECT 
            signal_type,
            COUNT(*) as total,
            COUNT(CASE WHEN was_correct = TRUE THEN 1 END) as correct_count,
            COUNT(CASE WHEN was_correct = FALSE THEN 1 END) as incorrect_count,
            ROUND(AVG(CASE WHEN return_1yr IS NOT NULL THEN return_1yr END), 2) as avg_return_1yr,
            ROUND(AVG(CASE WHEN was_correct = TRUE AND return_1yr IS NOT NULL THEN return_1yr END), 2) as avg_return_when_correct,
            ROUND(AVG(CASE WHEN was_correct = FALSE AND return_1yr IS NOT NULL THEN return_1yr END), 2) as avg_return_when_wrong
        FROM signal_strength_tracker
        {where_clause}
        GROUP BY signal_type
        ORDER BY signal_type
        """,
        params,
    ).fetchall()
    
    signal_results = []
    for r in agg_rows:
        total = r[1]
        correct = r[2]
        hit_rate = round(correct / total * 100, 1) if total > 0 else 0
        signal_results.append({
            "signal_type": r[0],
            "count": total,
            "hit_rate": hit_rate,
            "avg_return_1yr": r[5],
            "avg_signal_when_correct": r[6],
            "avg_signal_when_wrong": r[7],
        })
    
    # Best/worst examples per signal type
    examples = {}
    for sr in signal_results:
        st = sr["signal_type"]
        best = conn.execute(
            """
            SELECT ticker, signal_label, return_1yr FROM signal_strength_tracker
            WHERE signal_type = ? AND was_correct = TRUE AND return_1yr IS NOT NULL
            ORDER BY return_1yr DESC LIMIT 1
            """,
            [st],
        ).fetchone()
        worst = conn.execute(
            """
            SELECT ticker, signal_label, return_1yr FROM signal_strength_tracker
            WHERE signal_type = ? AND was_correct = FALSE AND return_1yr IS NOT NULL
            ORDER BY return_1yr ASC LIMIT 1
            """,
            [st],
        ).fetchone()
        examples[st] = {
            "best": {"ticker": best[0], "signal_label": best[1], "return_1yr": best[2]} if best else None,
            "worst": {"ticker": worst[0], "signal_label": worst[1], "return_1yr": worst[2]} if worst else None,
        }
    
    # Per-holding breakdown
    holding_rows = conn.execute(
        f"""
        SELECT ticker, signal_date, signal_type, signal_label, signal_value,
               return_1mo, return_3mo, return_6mo, return_1yr, was_correct
        FROM signal_strength_tracker
        {where_clause}
        ORDER BY ticker, signal_date, signal_type
        """,
        params,
    ).fetchall()
    
    holding_breakdown = [
        {
            "ticker": r[0],
            "signal_date": str(r[1]),
            "signal_type": r[2],
            "signal_label": r[3],
            "signal_value": r[4],
            "return_1mo": r[5],
            "return_3mo": r[6],
            "return_6mo": r[7],
            "return_1yr": r[8],
            "was_correct": r[9],
        }
        for r in holding_rows
    ]
    
    return {
        "signal_results": signal_results,
        "examples": examples,
        "holding_breakdown": holding_breakdown,
    }


@app.post("/mcp/portfolio.query_capital_efficiency")
async def query_capital_efficiency(payload: Optional[dict] = None) -> dict:
    """Compute and return capital efficiency for the portfolio.
    
    Returns per-position efficiency, opportunity cost, gain momentum, and
    portfolio-level summary with deployment recommendations.
    """
    conn = get_connection()
    result = _compute_capital_efficiency(conn)
    return result
