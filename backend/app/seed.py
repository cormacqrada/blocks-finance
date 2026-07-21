"""
Idempotent seeding of built-in reference data.

``bootstrap(conn)`` is called by ``app.db`` on every fresh connection (both
the local-file and DuckLake paths). It creates the schema (via
``app.schema.create_all_tables``) then seeds system formulas and default
taxonomy mappings using ``app.db.upsert_row`` so it is safe to run on both
plain DuckDB (with PK constraints) and DuckLake (without constraints).

Re-running on an already-seeded DB upserts the same rows — no duplicates, no
data loss. System formulas keep their curated expressions; user-created
formulas (created_by != 'system') are never touched.
"""

from __future__ import annotations

import json
from typing import Any

import duckdb


# ─── System formulas (curated built-in value-investiting metrics) ─────────────
# (id, name, expression, description, category, output_format)
_SYSTEM_FORMULAS: list[tuple[str, str, str, str, str, str]] = [
    # Margin of Safety
    ("formula:graham_number", "Graham Number",
     "SQRT(22.5 * eps * book_value_per_share)",
     "Benjamin Graham's intrinsic value estimate",
     "margin_of_safety", "currency"),
    ("formula:margin_of_safety", "Margin of Safety",
     "(graham_number - price) / graham_number * 100",
     "Percentage discount to Graham Number",
     "margin_of_safety", "percent"),
    ("formula:pe_margin", "PE Margin of Safety",
     "(15 - pe_ratio) / 15 * 100",
     "Discount to fair PE of 15",
     "margin_of_safety", "percent"),
    # Pricing Power / Quality
    # gross_margin (0–100%) scaled by (1 + rev_growth% / 100):
    #   50% margin + 10% rev growth → 55; 50% margin + -5% growth → 47.5
    ("formula:pricing_power_score", "Pricing Power Score",
     "(gross_margin * (1 + revenue_growth_yoy / 100))",
     "Gross margin (pct) scaled by revenue growth direction",
     "quality", "number"),
    # Quality Score: 30% gross margin + 30% op margin + 20% leverage safety
    # + 20% coverage bonus. (100 - D/E*10) rescales D/E so 0→100, 5→50, 10→0.
    ("formula:quality_score", "Quality Score",
     "(gross_margin * 0.3 + operating_margin * 0.3 + (100 - debt_to_equity * 10) * 0.2 + (interest_coverage > 5) * 20)",
     "Weighted composite: 30% gross margin + 30% op margin + 20% leverage safety + 20% coverage bonus",
     "quality", "number"),
    ("formula:roic", "Return on Invested Capital",
     "ebit / (total_equity + total_debt) * 100",
     "EBIT / Invested Capital",
     "quality", "percent"),
    # Torque / Upside
    ("formula:torque_score", "Torque Score",
     "(eps_growth_yoy + revenue_growth_yoy) / pe_ratio",
     "Growth momentum relative to valuation",
     "torque", "number"),
    ("formula:peg_ratio", "PEG Ratio",
     "pe_ratio / eps_growth_yoy",
     "PE relative to earnings growth",
     "torque", "number"),
    ("formula:fcf_yield", "FCF Yield",
     "free_cash_flow / market_cap * 100",
     "Free cash flow relative to market cap",
     "torque", "percent"),
    # Combined
    ("formula:ev_to_fcf", "EV/FCF Ratio",
     "IF(free_cash_flow > 0, enterprise_value / free_cash_flow, NULL)",
     "Enterprise Value divided by Free Cash Flow — lower = cheaper",
     "valuation", "number"),
    ("formula:greenblatt_combined", "Greenblatt Combined Score",
     "(ebit / enterprise_value * 100) + (ebit / net_working_capital)",
     "Earnings yield + Return on capital",
     "combined", "number"),
    ("formula:value_quality_score", "Value + Quality Score",
     "((15 - pe_ratio) / 15 * 50) + (gross_margin * 0.5)",
     "Combined value and quality metric",
     "combined", "number"),
]


def seed_system_formulas(conn: duckdb.DuckDBPyConnection) -> int:
    """Upsert all system formulas into formula_definitions. Returns count.

    Uses upsert_row (constraint-free) so it works on DuckLake. The is_system
    flag is set to TRUE and created_by defaults to 'system' via the schema.
    """
    from app.db import upsert_row  # lazy import to avoid circular dependency

    count = 0
    for (fid, name, expression, description, category, output_format) in _SYSTEM_FORMULAS:
        upsert_row(conn, "formula_definitions", {
            "id": fid,
            "name": name,
            "expression": expression,
            "description": description,
            "category": category,
            "output_format": output_format,
            "created_by": "system",
            "is_system": True,
        }, ["id"])
        count += 1
    return count


def seed_taxonomy_mappings(conn: duckdb.DuckDBPyConnection) -> int:
    """Upsert default taxonomy mappings for standard tickers. Returns count.

    Only seeds rows tagged override_source='system'; manual/vendor/auto
    overrides are preserved because upsert_row matches on ticker and we set
    override_source='system' on every upsert — meaning a manually-overridden
    ticker would get reset to 'system'. To respect existing overrides we
    skip tickers that already have a non-system override_source.
    """
    from app.db import upsert_row  # lazy import

    from app.taxonomy import DEFAULT_TICKER_TAXONOMY

    count = 0
    for ticker, data in DEFAULT_TICKER_TAXONOMY.items():
        # Don't clobber a manual/vendor/auto override if one exists.
        existing = conn.execute(
            "SELECT override_source FROM taxonomy_map WHERE ticker = ?", [ticker]
        ).fetchone()
        if existing and existing[0] and existing[0] != "system":
            continue
        themes_json = json.dumps(data.get("themes", []))
        upsert_row(conn, "taxonomy_map", {
            "ticker": ticker,
            "macro_sector": data["macro_sector"],
            "industry_cluster": data["industry_cluster"],
            "business_model_group": data["business_model_group"],
            "themes": themes_json,
            "override_source": "system",
        }, ["ticker"])
        count += 1
    return count


def bootstrap(conn: duckdb.DuckDBPyConnection) -> None:
    """Create all tables and seed reference data. Idempotent.

    Called by app.db on every fresh connection (local-file singleton and the
    DuckLake shared instance). Safe to run repeatedly.
    """
    from app.schema import create_all_tables  # lazy import
    create_all_tables(conn)
    try:
        seed_system_formulas(conn)
    except Exception as e:
        # Seeding is non-fatal — the app still works without the seed rows,
        # and a transient failure (e.g. DuckLake cold start mid-bootstrap)
        # shouldn't kill the connection.
        print(f"[seed] system formulas skipped: {type(e).__name__}: {e}")
    try:
        seed_taxonomy_mappings(conn)
    except Exception as e:
        print(f"[seed] taxonomy mappings skipped: {type(e).__name__}: {e}")
