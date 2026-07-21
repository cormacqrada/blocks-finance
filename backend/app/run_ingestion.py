"""
Unified ingestion runner: pull from all configured data sources and store in DuckDB.

Run this script to populate/refresh the database for dashboard views. Uses the
backend's ingest endpoints so the server must be running (or run as part of the app).

Data sources (best for dashboard):
- yfinance: price history, earnings, securities (free, no key)
- FMP: fundamentals for Greenblatt/screens (API key)
- FRED: macro indicators (API key)
- Finnhub: company news, analyst recommendations (API key)
- SEC EDGAR: insider transactions, 13F whale holdings (free)

Usage:
  # With backend running at default URL:
  python -m app.run_ingestion

  # Custom backend and tickers:
  BLOCKS_FINANCE_BACKEND_URL=http://localhost:8000 python -m app.run_ingestion AAPL MSFT GOOGL

  # Only sources you have keys for (skip others with --only):
  python -m app.run_ingestion --only yfinance,fred
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from typing import List

import httpx


BACKEND_BASE_URL = os.getenv("BLOCKS_FINANCE_BACKEND_URL", "http://localhost:8000")


def _get_tickers(args_tickers: List[str] | None, preset: str | None) -> List[str]:
    """Resolve tickers from CLI args or preset via backend API, or default."""
    if args_tickers:
        return args_tickers
    if preset:
        # Prefer backend so one source of truth (and sp500 cache lives there)
        try:
            import httpx
            r = httpx.get(
                f"{BACKEND_BASE_URL}/api/universe",
                params={"preset": preset},
                timeout=10.0,
            )
            if r.is_success:
                data = r.json()
                return data.get("tickers") or []
        except Exception:
            pass
        # Fallback: local universe module if same process
        try:
            from app.universe import get_universe
            return get_universe(preset, fallback_to_default=True)
        except Exception:
            pass
    from app.universe import DEFAULT_TICKERS
    return list(DEFAULT_TICKERS)


async def run_ingest(
    client: httpx.AsyncClient,
    name: str,
    url: str,
    payload: dict,
    required_env: str | None = None,
) -> dict | None:
    """Call one ingest endpoint; return response JSON or None on skip/failure."""
    if required_env and not os.getenv(required_env):
        print(f"  ⏭ {name}: skipped (set {required_env} for this source)")
        return None
    try:
        resp = await client.post(url, json=payload, timeout=120.0)
        resp.raise_for_status()
        data = resp.json()
        print(f"  ✅ {name}: {data}")
        return data
    except httpx.HTTPStatusError as e:
        print(f"  ❌ {name}: HTTP {e.response.status_code} - {e.response.text[:200]}")
        return None
    except Exception as e:
        print(f"  ❌ {name}: {type(e).__name__}: {e}")
        return None


async def run_all(
    base_url: str,
    tickers: List[str],
    only: List[str] | None,
    period: str = "2y",
    fred_years: int = 5,
) -> None:
    """Run all ingestion endpoints in a sensible order."""
    payload_tickers = {"tickers": tickers}

    async with httpx.AsyncClient(base_url=base_url) as client:
        # 1. Yahoo Finance – price history, earnings, securities (free)
        if only is None or "yfinance" in only:
            print("Ingesting yfinance (price history, earnings, securities)...")
            await run_ingest(
                client,
                "yfinance",
                "/ingest/yfinance",
                {**payload_tickers, "period": period, "include_earnings": True},
            )

        # 2. FMP – fundamentals for Greenblatt and screens
        if only is None or "fmp" in only:
            print("Ingesting FMP (fundamentals)...")
            await run_ingest(
                client,
                "fmp",
                "/ingest/fmp",
                payload_tickers,
                required_env="FMP_API_KEY",
            )

        # 3. FRED – macro indicators
        if only is None or "fred" in only:
            print("Ingesting FRED (macro indicators)...")
            await run_ingest(
                client,
                "fred",
                "/ingest/fred",
                {"years": fred_years},
                required_env="FRED_API_KEY",
            )

        # 4. Finnhub – news and analyst recommendations
        if only is None or "finnhub" in only:
            print("Ingesting Finnhub (news, recommendations)...")
            await run_ingest(
                client,
                "finnhub",
                "/ingest/finnhub",
                {**payload_tickers, "include_news": True, "include_recommendations": True},
                required_env="FINNHUB_API_KEY",
            )

        # 5. SEC EDGAR – insiders and 13F (free)
        if only is None or "sec_edgar" in only:
            print("Ingesting SEC EDGAR (insiders, 13F)...")
            await run_ingest(
                client,
                "sec_edgar",
                "/ingest/sec_edgar",
                {**payload_tickers, "include_13f": True, "include_insiders": True},
            )

    print("Ingestion run finished.")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run all data ingestion and store in DB (backend must be running)."
    )
    parser.add_argument(
        "tickers",
        nargs="*",
        default=None,
        help="Ticker symbols; default from --preset or default universe",
    )
    parser.add_argument(
        "--preset",
        choices=["default", "sp500"],
        default="sp500",
        help="Use preset universe (sp500 or default). Ignored if tickers given.",
    )
    parser.add_argument(
        "--base-url",
        default=os.getenv("BLOCKS_FINANCE_BACKEND_URL", "http://localhost:8000"),
        help="Backend base URL",
    )
    parser.add_argument(
        "--only",
        type=lambda s: [x.strip() for x in s.split(",") if x.strip()],
        default=None,
        help="Comma-separated sources: yfinance,fmp,fred,finnhub,sec_edgar",
    )
    parser.add_argument(
        "--period",
        default="2y",
        help="yfinance history period (e.g. 1y, 2y, 5y)",
    )
    parser.add_argument(
        "--fred-years",
        type=int,
        default=5,
        help="Years of FRED history",
    )
    args = parser.parse_args()

    tickers = _get_tickers(args.tickers if args.tickers else None, args.preset)
    only = args.only
    if only:
        valid = {"yfinance", "fmp", "fred", "finnhub", "sec_edgar"}
        invalid = set(only) - valid
        if invalid:
            print(f"Unknown --only source(s): {invalid}", file=sys.stderr)
            return 1

    print(f"Backend: {args.base_url}")
    print(f"Tickers: {tickers[:5]}{'...' if len(tickers) > 5 else ''} ({len(tickers)} total)")
    if only:
        print(f"Only: {only}")

    asyncio.run(
        run_all(
            args.base_url,
            tickers,
            only,
            period=args.period,
            fred_years=args.fred_years,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
