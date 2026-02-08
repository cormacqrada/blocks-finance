import json
import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, List, TypedDict, Optional

import duckdb
import httpx

from app.formula_engine import (
    FormulaEngine,
    evaluate_formula_for_universe,
    compute_all_formulas,
    FUNDAMENTALS_FIELDS,
)

DB_PATH = Path(__file__).parent.parent / "data" / "finance.duckdb"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)


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


@lru_cache(maxsize=1)
def get_connection() -> duckdb.DuckDBPyConnection:
    """Return a singleton DuckDB connection for the app.

    This is intentionally generic so it can be copied back into templates.
    """

    conn = duckdb.connect(str(DB_PATH))
    # Generic bootstrap: create domain tables if they do not exist.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS securities (
            ticker TEXT PRIMARY KEY,
            company_name TEXT,
            sector TEXT,
            industry TEXT,
            exchange TEXT,
            country TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    # Price history for time-series analysis
    conn.execute(
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
            data_source TEXT DEFAULT 'yfinance',
            fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (ticker, date)
        );
        """
    )
    # Earnings history for EPS/revenue trends
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS earnings_history (
            ticker TEXT,
            date DATE,
            period TEXT,  -- 'Q1', 'Q2', 'Q3', 'Q4', 'FY'
            eps DOUBLE,
            eps_estimate DOUBLE,
            revenue DOUBLE,
            revenue_estimate DOUBLE,
            surprise_pct DOUBLE,
            data_source TEXT DEFAULT 'yfinance',
            fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (ticker, date, period)
        );
        """
    )
    # Fundamentals history for margin/ratio trends
    conn.execute(
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
            data_source TEXT DEFAULT 'fmp',
            fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (ticker, date)
        );
        """
    )
    # SEC EDGAR: 13F Institutional Holdings (whale tracking)
    conn.execute(
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
            data_source TEXT DEFAULT 'sec_edgar',
            fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (ticker, holder_cik, report_date)
        );
        """
    )
    # SEC EDGAR: Insider Transactions (Form 4)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS insider_transactions (
            ticker TEXT,
            filing_date DATE,
            trade_date DATE,
            insider_name TEXT,
            insider_title TEXT,
            transaction_type TEXT,  -- 'P' = purchase, 'S' = sale, 'A' = grant
            shares BIGINT,
            price DOUBLE,
            value DOUBLE,
            shares_owned_after BIGINT,
            data_source TEXT DEFAULT 'sec_edgar',
            fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (ticker, filing_date, insider_name, transaction_type)
        );
        """
    )
    # Finnhub: Company News
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS company_news (
            id TEXT PRIMARY KEY,
            ticker TEXT,
            datetime TIMESTAMP,
            headline TEXT,
            summary TEXT,
            source TEXT,
            url TEXT,
            sentiment DOUBLE,
            data_source TEXT DEFAULT 'finnhub',
            fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    # Finnhub: Analyst Recommendations
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS analyst_recommendations (
            ticker TEXT,
            date DATE,
            strong_buy INTEGER,
            buy INTEGER,
            hold INTEGER,
            sell INTEGER,
            strong_sell INTEGER,
            data_source TEXT DEFAULT 'finnhub',
            fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (ticker, date)
        );
        """
    )
    # FRED: Macro Economic Indicators
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS macro_indicators (
            series_id TEXT,
            date DATE,
            value DOUBLE,
            series_name TEXT,
            units TEXT,
            data_source TEXT DEFAULT 'fred',
            fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (series_id, date)
        );
        """    
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS fundamentals (
            ticker TEXT,
            as_of DATE,
            -- Company Info
            company_name TEXT,
            sector TEXT,
            industry TEXT,
            -- Core Greenblatt
            ebit DOUBLE,
            enterprise_value DOUBLE,
            net_working_capital DOUBLE,
            -- Revenue & Growth
            revenue DOUBLE,
            revenue_growth_yoy DOUBLE,
            -- Margins
            gross_margin DOUBLE,
            operating_margin DOUBLE,
            net_margin DOUBLE,
            -- Cash Flow
            free_cash_flow DOUBLE,
            fcf_yield DOUBLE,
            -- Leverage
            total_debt DOUBLE,
            total_equity DOUBLE,
            debt_to_equity DOUBLE,
            interest_coverage DOUBLE,
            -- Book Value
            book_value DOUBLE,
            tangible_book_value DOUBLE,
            book_value_per_share DOUBLE,
            -- Market Data
            market_cap DOUBLE,
            price DOUBLE,
            shares_outstanding DOUBLE,
            -- Valuation Ratios
            pe_ratio DOUBLE,
            pb_ratio DOUBLE,
            ps_ratio DOUBLE,
            ev_to_ebitda DOUBLE,
            -- Dividends
            dividend_yield DOUBLE,
            payout_ratio DOUBLE,
            -- Earnings
            eps DOUBLE,
            eps_growth_yoy DOUBLE,
            PRIMARY KEY (ticker, as_of)
        );
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS greenblatt_scores (
            ticker TEXT,
            as_of DATE,
            earnings_yield DOUBLE,
            return_on_capital DOUBLE,
            rank INTEGER
        );
        """
    )
    # Formula definitions for custom metrics
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS formula_definitions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            expression TEXT NOT NULL,
            description TEXT,
            category TEXT,
            output_format TEXT DEFAULT 'number',
            created_by TEXT DEFAULT 'system',
            is_system BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    # Computed metrics from formula evaluation
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS computed_metrics (
            ticker TEXT,
            as_of DATE,
            metric_name TEXT,
            formula_id TEXT,
            value DOUBLE,
            computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (ticker, as_of, metric_name)
        );
        """
    )
    # Screen definitions for saved filters/rankings
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS screen_definitions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            filters TEXT,
            rank_by TEXT,
            rank_order TEXT DEFAULT 'DESC',
            columns TEXT,
            created_by TEXT DEFAULT 'system',
            is_system BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    # Seed system formulas if not present
    _seed_system_formulas(conn)
    return conn


def _seed_system_formulas(conn: duckdb.DuckDBPyConnection) -> None:
    """Seed built-in value investing formulas."""
    system_formulas = [
        # Margin of Safety formulas
        (
            "formula:graham_number",
            "Graham Number",
            "SQRT(22.5 * eps * book_value_per_share)",
            "Benjamin Graham's intrinsic value estimate",
            "margin_of_safety",
            "currency",
        ),
        (
            "formula:margin_of_safety",
            "Margin of Safety",
            "(graham_number - price) / graham_number * 100",
            "Percentage discount to Graham Number",
            "margin_of_safety",
            "percent",
        ),
        (
            "formula:pe_margin",
            "PE Margin of Safety",
            "(15 - pe_ratio) / 15 * 100",
            "Discount to fair PE of 15",
            "margin_of_safety",
            "percent",
        ),
        # Pricing Power / Quality formulas
        (
            "formula:pricing_power_score",
            "Pricing Power Score",
            "(gross_margin * (1 + revenue_growth_yoy / 100))",
            "Gross margin weighted by revenue growth",
            "quality",
            "number",
        ),
        (
            "formula:quality_score",
            "Quality Score",
            "(gross_margin * 0.3 + operating_margin * 0.3 + (100 - debt_to_equity * 10) * 0.2 + (interest_coverage > 5) * 20)",
            "Composite quality metric",
            "quality",
            "number",
        ),
        (
            "formula:roic",
            "Return on Invested Capital",
            "ebit / (total_equity + total_debt) * 100",
            "EBIT / Invested Capital",
            "quality",
            "percent",
        ),
        # Torque / Upside formulas
        (
            "formula:torque_score",
            "Torque Score",
            "(eps_growth_yoy + revenue_growth_yoy) / pe_ratio",
            "Growth momentum relative to valuation",
            "torque",
            "number",
        ),
        (
            "formula:peg_ratio",
            "PEG Ratio",
            "pe_ratio / eps_growth_yoy",
            "PE relative to earnings growth",
            "torque",
            "number",
        ),
        (
            "formula:fcf_yield",
            "FCF Yield",
            "free_cash_flow / market_cap * 100",
            "Free cash flow relative to market cap",
            "torque",
            "percent",
        ),
        # Combined scores
        (
            "formula:greenblatt_combined",
            "Greenblatt Combined Score",
            "(ebit / enterprise_value * 100) + (ebit / net_working_capital)",
            "Earnings yield + Return on capital",
            "combined",
            "number",
        ),
        (
            "formula:value_quality_score",
            "Value + Quality Score",
            "((15 - pe_ratio) / 15 * 50) + (gross_margin * 0.5)",
            "Combined value and quality metric",
            "combined",
            "number",
        ),
    ]
    
    for formula in system_formulas:
        conn.execute(
            """
            INSERT OR IGNORE INTO formula_definitions 
            (id, name, expression, description, category, output_format, is_system)
            VALUES (?, ?, ?, ?, ?, ?, TRUE)
            """,
            formula,
        )


app = FastAPI(title="Blocks Finance Backend")

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
    
    return {
        "status": "seeded",
        "fundamentals_inserted": int(fundamentals_count),
        "scores_computed": int(scores_count),
        "formula_metrics_computed": metrics_count,
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
    conn.execute("DELETE FROM greenblatt_scores")
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

    rows = conn.execute(
        f"""
        SELECT ticker, as_of, earnings_yield, return_on_capital, rank
        FROM greenblatt_scores
        {where_clause}
        ORDER BY rank ASC
        LIMIT ?;
        """,
        params,
    ).fetchall()

    return {
        "rows": [
            {
                "ticker": r[0],
                "as_of": str(r[1]),
                "earnings_yield": r[2],
                "return_on_capital": r[3],
                "rank": r[4],
            }
            for r in rows
        ]
    }


# ============================================================================
# Formula MCP Endpoints
# ============================================================================


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
    
    conn.execute(
        """
        INSERT INTO formula_definitions (id, name, expression, description, category, output_format, is_system)
        VALUES (?, ?, ?, ?, ?, ?, FALSE)
        ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name, expression = EXCLUDED.expression,
            description = EXCLUDED.description, category = EXCLUDED.category, output_format = EXCLUDED.output_format
        """,
        (formula_id, name, expression, description, category, output_format),
    )
    
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
    
    conn.execute(
        """
        INSERT INTO screen_definitions (id, name, description, filters, rank_by, rank_order, columns, is_system)
        VALUES (?, ?, ?, ?, ?, ?, ?, FALSE)
        ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name, description = EXCLUDED.description, filters = EXCLUDED.filters,
            rank_by = EXCLUDED.rank_by, rank_order = EXCLUDED.rank_order, columns = EXCLUDED.columns
        """,
        (
            screen_id,
            name,
            payload.get("description", ""),
            json.dumps(payload.get("filters", [])),
            payload.get("rank_by", ""),
            payload.get("rank_order", "DESC"),
            json.dumps(payload.get("columns", [])),
        ),
    )
    
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
            "valuation": ["pe_ratio", "pb_ratio", "ps_ratio", "ev_to_ebitda"],
            "dividends": ["dividend_yield", "payout_ratio"],
            "earnings": ["eps", "eps_growth_yoy"],
        },
    }


# ============================================================================
# FMP Data Ingestion
# ============================================================================

DEFAULT_TICKERS = [
    "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA",
    "BRK-B", "JPM", "V", "MA",
    "JNJ", "UNH", "PFE", "ABBV",
    "KO", "PEP", "PG", "COST", "WMT",
    "CAT", "HON", "UPS",
    "XOM", "CVX",
]


def _safe_float(value, default: float = 0.0) -> float:
    """Safely convert value to float."""
    if value is None:
        return default
    try:
        return float(value)
    except (ValueError, TypeError):
        return default


def _recompute_greenblatt(conn: duckdb.DuckDBPyConnection, universe: Optional[List[str]] = None) -> int:
    """Internal helper to recompute Greenblatt scores."""
    if universe:
        universe_filter = "WHERE f.ticker IN (%s)" % ",".join("?" for _ in universe)
        params: List[Any] = list(universe)
    else:
        universe_filter = ""
        params = []
    
    conn.execute("DELETE FROM greenblatt_scores")
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


async def _fetch_fmp_fundamentals(api_key: str, tickers: List[str]) -> List[dict]:
    """Fetch fundamentals from FMP for given tickers."""
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
                
                responses = {}
                for name, url in endpoints.items():
                    try:
                        resp = await client.get(url, params={"apikey": api_key, "limit": 1})
                        resp.raise_for_status()
                        data = resp.json()
                        responses[name] = data[0] if data else {}
                    except Exception:
                        responses[name] = {}
                
                key_metrics = responses.get("key_metrics", {})
                income = responses.get("income", {})
                balance = responses.get("balance", {})
                cash_flow = responses.get("cash_flow", {})
                profile = responses.get("profile", {})
                ratios = responses.get("ratios", {})
                growth = responses.get("growth", {})
                
                if not income and not key_metrics:
                    continue
                
                as_of = income.get("date") or key_metrics.get("date") or balance.get("date") or "2024-12-31"
                
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
                market_cap = _safe_float(profile.get("mktCap") or key_metrics.get("marketCap"))
                total_debt = _safe_float(balance.get("totalDebt"))
                total_equity = _safe_float(balance.get("totalStockholdersEquity"))
                interest_expense = _safe_float(income.get("interestExpense"))
                book_value = _safe_float(balance.get("totalStockholdersEquity"))
                intangible_assets = _safe_float(balance.get("intangibleAssets") or balance.get("goodwillAndIntangibleAssets"))
                shares_outstanding = _safe_float(income.get("weightedAverageShsOut") or profile.get("sharesOutstanding"))
                price = _safe_float(profile.get("price"))
                ebitda = _safe_float(income.get("ebitda"))
                eps = _safe_float(income.get("eps") or profile.get("eps"))
                
                # Skip if no valuation data
                if enterprise_value <= 0 and market_cap <= 0:
                    continue
                
                fundamentals = {
                    "ticker": ticker,
                    "as_of": as_of,
                    # Company Info
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
        "tickers": ["AAPL", "MSFT"]  # optional, defaults to curated universe
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
    
    tickers = payload.get("tickers") or DEFAULT_TICKERS
    if isinstance(tickers, str):
        tickers = [tickers]
    
    # Fetch from FMP
    fundamentals = await _fetch_fmp_fundamentals(api_key, tickers)
    
    if not fundamentals:
        return {"ingested": 0, "message": "No data fetched. Check API key and tickers."}
    
    # Upsert into database
    conn = get_connection()
    for row in fundamentals:
        cols = list(row.keys())
        placeholders = ", ".join("?" for _ in cols)
        col_names = ", ".join(cols)
        update_cols = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols if c not in ('ticker', 'as_of'))
        conn.execute(
            f"INSERT INTO fundamentals ({col_names}) VALUES ({placeholders}) ON CONFLICT (ticker, as_of) DO UPDATE SET {update_cols}",
            list(row.values()),
        )
    
    # Recompute Greenblatt scores
    ingested_tickers = [r["ticker"] for r in fundamentals]
    _recompute_greenblatt(conn, ingested_tickers)
    
    # Compute formula metrics
    compute_all_formulas(conn, ingested_tickers)
    
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
    tickers = payload.get("tickers") or DEFAULT_TICKERS
    period = payload.get("period", "5y")
    include_earnings = payload.get("include_earnings", True)
    
    if isinstance(tickers, str):
        tickers = [tickers]
    
    conn = get_connection()
    price_count = 0
    earnings_count = 0
    securities_count = 0
    
    for ticker in tickers:
        try:
            stock = yf.Ticker(ticker)
            
            # Get company info
            info = stock.info or {}
            if info.get("shortName") or info.get("longName"):
                conn.execute(
                    """
                    INSERT INTO securities (ticker, company_name, sector, industry, exchange, country)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT (ticker) DO UPDATE SET
                        company_name = EXCLUDED.company_name,
                        sector = EXCLUDED.sector,
                        industry = EXCLUDED.industry,
                        exchange = EXCLUDED.exchange,
                        country = EXCLUDED.country,
                        updated_at = now()
                    """,
                    (
                        ticker,
                        info.get("shortName") or info.get("longName", ""),
                        info.get("sector", ""),
                        info.get("industry", ""),
                        info.get("exchange", ""),
                        info.get("country", ""),
                    ),
                )
                securities_count += 1
            
            # Get price history
            hist = stock.history(period=period)
            if not hist.empty:
                for date_idx, row in hist.iterrows():
                    date_str = date_idx.strftime("%Y-%m-%d")
                    conn.execute(
                        """
                        INSERT INTO price_history (ticker, date, open, high, low, close, adj_close, volume)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT (ticker, date) DO UPDATE SET
                            open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
                            close = EXCLUDED.close, adj_close = EXCLUDED.adj_close, volume = EXCLUDED.volume,
                            fetched_at = now()
                        """,
                        (
                            ticker,
                            date_str,
                            float(row.get("Open", 0)),
                            float(row.get("High", 0)),
                            float(row.get("Low", 0)),
                            float(row.get("Close", 0)),
                            float(row.get("Close", 0)),  # yfinance returns adjusted by default
                            int(row.get("Volume", 0)),
                        ),
                    )
                    price_count += 1
            
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
                            conn.execute(
                                """
                                INSERT INTO earnings_history (ticker, date, period, eps, revenue)
                                VALUES (?, ?, ?, ?, ?)
                                ON CONFLICT (ticker, date, period) DO UPDATE SET
                                    eps = EXCLUDED.eps, revenue = EXCLUDED.revenue, fetched_at = now()
                                """,
                                (
                                    ticker,
                                    date_str,
                                    "Q",
                                    float(row.get("Earnings", 0)) if row.get("Earnings") else None,
                                    float(row.get("Revenue", 0)) if row.get("Revenue") else None,
                                ),
                            )
                            earnings_count += 1
                except Exception:
                    pass  # Earnings not available for all stocks
                    
        except Exception as e:
            print(f"Warning: Failed to fetch {ticker}: {e}")
            continue
    
    return {
        "tickers": tickers,
        "price_records": price_count,
        "earnings_records": earnings_count,
        "securities_updated": securities_count,
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
# SEC EDGAR Data Ingestion (Free, Unlimited)
# ============================================================================


@app.post("/ingest/sec_edgar")
async def ingest_from_sec_edgar(payload: Optional[dict] = None) -> dict:
    """Ingest institutional holdings (13F) and insider transactions from SEC EDGAR.
    
    Input: {
        "tickers": ["AAPL", "MSFT"],  # optional
        "include_13f": true,  # institutional holdings
        "include_insiders": true  # Form 4 insider transactions
    }
    
    Uses SEC EDGAR API directly - free, no API key needed.
    Rate limit: 10 requests/second (we'll be conservative)
    """
    import time
    
    payload = payload or {}
    tickers = payload.get("tickers") or DEFAULT_TICKERS
    include_13f = payload.get("include_13f", True)
    include_insiders = payload.get("include_insiders", True)
    
    if isinstance(tickers, str):
        tickers = [tickers]
    
    conn = get_connection()
    holdings_count = 0
    insider_count = 0
    
    headers = {
        "User-Agent": "BlocksFinance research@blocks.finance",
        "Accept": "application/json",
    }
    
    async with httpx.AsyncClient(timeout=30.0, headers=headers) as client:
        for ticker in tickers:
            try:
                # Get CIK for ticker from SEC
                cik_resp = await client.get(
                    f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={ticker}&type=&dateb=&owner=include&count=1&output=atom"
                )
                # SEC rate limit
                time.sleep(0.15)
                
                if include_insiders:
                    # Fetch insider transactions using SEC full-text search
                    try:
                        insider_resp = await client.get(
                            f"https://efts.sec.gov/LATEST/search-index?q=%22{ticker}%22&dateRange=custom&forms=4&startdt=2024-01-01&enddt=2025-12-31",
                        )
                        time.sleep(0.15)
                        
                        if insider_resp.status_code == 200:
                            data = insider_resp.json()
                            hits = data.get("hits", {}).get("hits", [])
                            
                            for hit in hits[:20]:  # Limit to recent 20
                                source = hit.get("_source", {})
                                filing_date = source.get("file_date", "")
                                
                                # Basic parsing - SEC data varies in structure
                                insider_name = source.get("display_names", [""])[0] if source.get("display_names") else "Unknown"
                                conn.execute(
                                    """
                                    INSERT INTO insider_transactions (ticker, filing_date, insider_name, transaction_type, data_source)
                                    VALUES (?, ?, ?, ?, 'sec_edgar')
                                    ON CONFLICT (ticker, filing_date, insider_name, transaction_type) DO NOTHING
                                    """,
                                    (
                                        ticker,
                                        filing_date,
                                        insider_name,
                                        "4",  # Form 4
                                    ),
                                )
                                insider_count += 1
                    except Exception as e:
                        print(f"Warning: Failed to fetch insiders for {ticker}: {e}")
                        
            except Exception as e:
                print(f"Warning: SEC EDGAR error for {ticker}: {e}")
                continue
    
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
    
    tickers = payload.get("tickers") or DEFAULT_TICKERS[:10]  # Limit for free tier
    include_news = payload.get("include_news", True)
    include_recommendations = payload.get("include_recommendations", True)
    
    if isinstance(tickers, str):
        tickers = [tickers]
    
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
                            conn.execute(
                                """
                                INSERT INTO company_news (id, ticker, datetime, headline, summary, source, url, data_source)
                                VALUES (?, ?, ?, ?, ?, ?, ?, 'finnhub')
                                ON CONFLICT (id) DO UPDATE SET
                                    headline = EXCLUDED.headline, summary = EXCLUDED.summary,
                                    fetched_at = now()
                                """,
                                (
                                    news_id,
                                    ticker,
                                    datetime.fromtimestamp(item.get("datetime", 0)).isoformat() if item.get("datetime") else None,
                                    item.get("headline", ""),
                                    item.get("summary", ""),
                                    item.get("source", ""),
                                    item.get("url", ""),
                                ),
                            )
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
                            conn.execute(
                                """
                                INSERT INTO analyst_recommendations (ticker, date, strong_buy, buy, hold, sell, strong_sell, data_source)
                                VALUES (?, ?, ?, ?, ?, ?, ?, 'finnhub')
                                ON CONFLICT (ticker, date) DO UPDATE SET
                                    strong_buy = EXCLUDED.strong_buy, buy = EXCLUDED.buy, hold = EXCLUDED.hold,
                                    sell = EXCLUDED.sell, strong_sell = EXCLUDED.strong_sell, fetched_at = now()
                                """,
                                (
                                    ticker,
                                    rec.get("period", ""),
                                    rec.get("strongBuy", 0),
                                    rec.get("buy", 0),
                                    rec.get("hold", 0),
                                    rec.get("sell", 0),
                                    rec.get("strongSell", 0),
                                ),
                            )
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
                            
                        conn.execute(
                            """
                            INSERT INTO macro_indicators (series_id, date, value, series_name, units, data_source)
                            VALUES (?, ?, ?, ?, ?, 'fred')
                            ON CONFLICT (series_id, date) DO UPDATE SET
                                value = EXCLUDED.value, fetched_at = now()
                            """,
                            (
                                series_id,
                                obs.get("date", ""),
                                float(value_str),
                                series_info[0],
                                series_info[1],
                            ),
                        )
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
# Data Source Status & Query APIs
# ============================================================================


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
