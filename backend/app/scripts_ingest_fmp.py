"""Ingestion script for pulling fundamentals from Financial Modeling Prep (FMP).

This script is intentionally a skeleton: you should customize the exact FMP
endpoints and field mappings based on your account and data needs.

IMPORTANT:
- Do NOT commit your FMP API key to git.
- Set it via an environment variable, e.g. `export FMP_API_KEY=...`.
- This script reads the key from the environment and never logs it.
"""

from __future__ import annotations

import os
from typing import List

import httpx

BACKEND_BASE_URL = os.getenv("BLOCKS_FINANCE_BACKEND_URL", "http://localhost:8000")
FMP_API_KEY_ENV = "FMP_API_KEY"


def get_fmp_api_key() -> str:
    key = os.getenv(FMP_API_KEY_ENV)
    if not key:
        raise RuntimeError(
            f"{FMP_API_KEY_ENV} is not set. Export it in your shell, e.g. `export {FMP_API_KEY_ENV}=...`"
        )
    return key


def safe_float(value, default: float = 0.0) -> float:
    """Safely convert value to float, returning default if None or invalid."""
    if value is None:
        return default
    try:
        return float(value)
    except (ValueError, TypeError):
        return default


async def fetch_fundamentals_for_tickers(tickers: List[str]) -> list[dict]:
    """Fetch comprehensive fundamentals from FMP for a list of tickers.

    Uses multiple FMP endpoints to get:
    - Key metrics (enterprise value, ratios, yields)
    - Income statement (revenue, margins, EBIT, EPS)
    - Balance sheet (debt, equity, book value, working capital)
    - Cash flow statement (free cash flow)
    - Company profile (market cap, price)
    - Financial ratios (growth rates)
    """

    api_key = get_fmp_api_key()
    results: list[dict] = []

    async with httpx.AsyncClient(timeout=30.0) as client:
        for ticker in tickers:
            try:
                # Fetch all data in parallel for efficiency
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
                    except Exception as e:
                        print(f"  Warning: Failed to fetch {name} for {ticker}: {e}")
                        responses[name] = {}
                
                key_metrics = responses.get("key_metrics", {})
                income = responses.get("income", {})
                balance = responses.get("balance", {})
                cash_flow = responses.get("cash_flow", {})
                profile = responses.get("profile", {})
                ratios = responses.get("ratios", {})
                growth = responses.get("growth", {})
                
                if not income and not key_metrics:
                    print(f"Warning: No data found for {ticker}, skipping...")
                    continue

                # Extract date
                as_of = (
                    income.get("date") or 
                    key_metrics.get("date") or 
                    balance.get("date") or 
                    "2024-12-31"
                )
                
                # === Core Greenblatt fields ===
                ebit = safe_float(
                    income.get("ebit") or 
                    income.get("operatingIncome") or 
                    income.get("ebitda")
                )
                enterprise_value = safe_float(key_metrics.get("enterpriseValue"))
                current_assets = safe_float(balance.get("totalCurrentAssets"))
                current_liabilities = safe_float(balance.get("totalCurrentLiabilities"))
                net_working_capital = current_assets - current_liabilities
                
                # === Revenue & Growth ===
                revenue = safe_float(income.get("revenue"))
                revenue_growth_yoy = safe_float(growth.get("revenueGrowth")) * 100  # Convert to %
                
                # === Margins ===
                gross_profit = safe_float(income.get("grossProfit"))
                gross_margin = (gross_profit / revenue * 100) if revenue > 0 else 0.0
                operating_income = safe_float(income.get("operatingIncome"))
                operating_margin = (operating_income / revenue * 100) if revenue > 0 else 0.0
                net_income = safe_float(income.get("netIncome"))
                net_margin = (net_income / revenue * 100) if revenue > 0 else 0.0
                
                # === Cash Flow ===
                free_cash_flow = safe_float(cash_flow.get("freeCashFlow"))
                market_cap = safe_float(profile.get("mktCap") or key_metrics.get("marketCap"))
                fcf_yield = (free_cash_flow / market_cap * 100) if market_cap > 0 else 0.0
                
                # === Leverage ===
                total_debt = safe_float(balance.get("totalDebt"))
                total_equity = safe_float(balance.get("totalStockholdersEquity"))
                debt_to_equity = (total_debt / total_equity) if total_equity > 0 else 0.0
                interest_expense = safe_float(income.get("interestExpense"))
                interest_coverage = (ebit / interest_expense) if interest_expense > 0 else 999.0
                
                # === Book Value ===
                book_value = safe_float(balance.get("totalStockholdersEquity"))
                intangible_assets = safe_float(balance.get("intangibleAssets") or balance.get("goodwillAndIntangibleAssets"))
                tangible_book_value = book_value - intangible_assets
                shares_outstanding = safe_float(
                    income.get("weightedAverageShsOut") or 
                    profile.get("sharesOutstanding") or 
                    balance.get("commonStock")
                )
                book_value_per_share = (book_value / shares_outstanding) if shares_outstanding > 0 else 0.0
                
                # === Market Data ===
                price = safe_float(profile.get("price"))
                
                # === Valuation Ratios ===
                pe_ratio = safe_float(ratios.get("priceEarningsRatio") or profile.get("pe"))
                pb_ratio = safe_float(ratios.get("priceToBookRatio") or key_metrics.get("pbRatio"))
                ps_ratio = safe_float(ratios.get("priceToSalesRatio") or key_metrics.get("priceToSalesRatio"))
                ebitda = safe_float(income.get("ebitda"))
                ev_to_ebitda = (enterprise_value / ebitda) if ebitda > 0 else 0.0
                
                # === Dividends ===
                dividend_yield = safe_float(ratios.get("dividendYield") or key_metrics.get("dividendYield")) * 100
                payout_ratio = safe_float(ratios.get("payoutRatio") or key_metrics.get("payoutRatio")) * 100
                
                # === Earnings ===
                eps = safe_float(income.get("eps") or profile.get("eps"))
                eps_growth_yoy = safe_float(growth.get("epsgrowth") or growth.get("epsGrowth")) * 100
                
                # Skip if we don't have meaningful data
                if enterprise_value <= 0 and market_cap <= 0:
                    print(f"Warning: {ticker} has no valuation data, skipping...")
                    continue

                fundamentals = {
                    "ticker": ticker,
                    "as_of": as_of,
                    # Core Greenblatt
                    "ebit": ebit,
                    "enterprise_value": enterprise_value,
                    "net_working_capital": net_working_capital,
                    # Revenue & Growth
                    "revenue": revenue,
                    "revenue_growth_yoy": revenue_growth_yoy,
                    # Margins
                    "gross_margin": gross_margin,
                    "operating_margin": operating_margin,
                    "net_margin": net_margin,
                    # Cash Flow
                    "free_cash_flow": free_cash_flow,
                    "fcf_yield": fcf_yield,
                    # Leverage
                    "total_debt": total_debt,
                    "total_equity": total_equity,
                    "debt_to_equity": debt_to_equity,
                    "interest_coverage": interest_coverage,
                    # Book Value
                    "book_value": book_value,
                    "tangible_book_value": tangible_book_value,
                    "book_value_per_share": book_value_per_share,
                    # Market Data
                    "market_cap": market_cap,
                    "price": price,
                    "shares_outstanding": shares_outstanding,
                    # Valuation Ratios
                    "pe_ratio": pe_ratio,
                    "pb_ratio": pb_ratio,
                    "ps_ratio": ps_ratio,
                    "ev_to_ebitda": ev_to_ebitda,
                    # Dividends
                    "dividend_yield": dividend_yield,
                    "payout_ratio": payout_ratio,
                    # Earnings
                    "eps": eps,
                    "eps_growth_yoy": eps_growth_yoy,
                }
                results.append(fundamentals)
                print(f"✓ {ticker}: Price=${price:.2f}, PE={pe_ratio:.1f}, Margin={gross_margin:.1f}%, D/E={debt_to_equity:.2f}")
                
            except httpx.HTTPStatusError as e:
                print(f"Error fetching {ticker}: HTTP {e.response.status_code} - {e.response.text[:100]}")
                continue
            except Exception as e:
                print(f"Error processing {ticker}: {type(e).__name__}: {e}")
                continue

    return results


async def upsert_and_compute(tickers: List[str]) -> None:
    """Push fetched fundamentals into the backend and recompute all metrics."""

    fundamentals = await fetch_fundamentals_for_tickers(tickers)
    if not fundamentals:
        print("No fundamentals fetched; nothing to upsert.")
        return

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Upsert fundamentals via MCP-style endpoint
        upsert_resp = await client.post(
            f"{BACKEND_BASE_URL}/mcp/finance.upsert_fundamentals",
            json={"rows": fundamentals},
        )
        upsert_resp.raise_for_status()
        print("Upserted fundamentals:", upsert_resp.json())

        # Recompute Greenblatt scores
        compute_resp = await client.post(
            f"{BACKEND_BASE_URL}/mcp/finance.compute_greenblatt_scores",
            json={},
        )
        compute_resp.raise_for_status()
        print("Recomputed Greenblatt scores:", compute_resp.json())
        
        # Compute all formula-based metrics
        formula_resp = await client.post(
            f"{BACKEND_BASE_URL}/mcp/formula.compute_all",
            json={},
        )
        formula_resp.raise_for_status()
        print("Computed formula metrics:", formula_resp.json())


# Value investing universe - diversified mix of quality companies
DEFAULT_UNIVERSE = [
    # Tech giants
    "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA",
    # Financials
    "BRK-B", "JPM", "V", "MA",
    # Healthcare
    "JNJ", "UNH", "PFE", "ABBV",
    # Consumer
    "KO", "PEP", "PG", "COST", "WMT",
    # Industrials
    "CAT", "HON", "UPS",
    # Energy
    "XOM", "CVX",
]


def main() -> None:
    import asyncio
    import sys
    
    # Use command line args or default universe
    if len(sys.argv) > 1:
        tickers = sys.argv[1:]
    else:
        tickers = DEFAULT_UNIVERSE
    
    print(f"Fetching fundamentals for {len(tickers)} tickers...")
    asyncio.run(upsert_and_compute(tickers))


if __name__ == "__main__":
    main()
