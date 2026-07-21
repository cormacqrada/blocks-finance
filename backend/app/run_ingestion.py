"""
Unified ingestion runner: pull from all configured data sources and store in DuckDB.

Run this script to populate/refresh the database for dashboard views. Uses the
backend's ingest endpoints so the server must be running (or run as part of the app).

Data sources (best for dashboard):
- fmp_prices: daily OHLCV price history from FMP (API key — works from any IP)
- FMP: fundamentals for Greenblatt/screens (API key)
- FRED: macro indicators (API key)
- Finnhub: company news, analyst recommendations (API key)
- SEC EDGAR: insider transactions, 13F whale holdings (free)
- yfinance: optional local-only price/earnings (free, but Yahoo rate-limits
  datacenter IPs — use --only yfinance from your laptop, not the server)

Usage:
  # With backend running at default URL:
  python -m app.run_ingestion

  # Custom backend and tickers:
  BLOCKS_FINANCE_BACKEND_URL=http://localhost:8000 python -m app.run_ingestion AAPL MSFT GOOGL

  # Only sources you have keys for (skip others with --only):
  python -m app.run_ingestion --only fmp_prices,fred
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time
from typing import List, Optional

import httpx


BACKEND_BASE_URL = os.getenv("BLOCKS_FINANCE_BACKEND_URL", "http://localhost:8000")

# Per-source request timeouts (seconds).  fmp_prices/yfinance loop over
# every ticker server-side so need the longest budget; FRED/Finnhub are fast.
TIMEOUTS: dict[str, float] = {
    "fmp_prices": 600.0,
    "fmp":        300.0,
    "yfinance":   600.0,
    "fred":       120.0,
    "finnhub":    120.0,
    "sec_edgar":  300.0,
}

# Default batch size when splitting a large ticker list across multiple calls.
# DuckLake upserts (Neon catalog + R2) are network-bound per row, so batches
# must stay small enough that one batch finishes well within the source
# timeout. 25 tickers ≈ 30-90 s per batch on Render free tier.
DEFAULT_BATCH_SIZE = 25


def _get_tickers(args_tickers: List[str] | None, preset: str | None) -> List[str]:
    """Resolve tickers from CLI args or preset via backend API, or default."""
    if args_tickers:
        return args_tickers
    if preset:
        # Prefer backend so one source of truth (and sp500 cache lives there)
        try:
            r = httpx.get(
                f"{BACKEND_BASE_URL}/api/universe",
                params={"preset": preset},
                timeout=15.0,
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


def warmup_backend(
    base_url: str,
    max_retries: int = 12,
    retry_delay: float = 10.0,
) -> bool:
    """Poll /health until the backend responds or retries are exhausted.

    Render free-tier services spin down after 15 min of inactivity and take
    ~50 s to cold-start.  Without this step every first ingest request will
    time out while the server is still booting.

    Returns True if the backend is up, False otherwise.
    """
    url = base_url.rstrip("/") + "/health"
    print(f"Warming up backend ({url}) — may take up to {int(max_retries * retry_delay)}s on cold start…")
    for attempt in range(1, max_retries + 1):
        try:
            r = httpx.get(url, timeout=15.0)
            if r.is_success:
                print(f"  ✅ Backend ready (attempt {attempt})")
                return True
            print(f"  ⏳ Attempt {attempt}/{max_retries}: HTTP {r.status_code}, retrying…")
        except Exception as exc:
            print(f"  ⏳ Attempt {attempt}/{max_retries}: {type(exc).__name__}: {exc}, retrying…")
        time.sleep(retry_delay)
    print("  ❌ Backend did not become ready — proceeding anyway (may fail).")
    return False


async def run_ingest(
    client: httpx.AsyncClient,
    name: str,
    url: str,
    payload: dict,
    required_env: str | None = None,
    timeout: Optional[float] = None,
) -> dict | None:
    """Call one ingest endpoint; return response JSON or None on skip/failure."""
    if required_env and not os.getenv(required_env):
        print(f"  ⏭ {name}: skipped (set {required_env} for this source)")
        return None
    _timeout = timeout if timeout is not None else TIMEOUTS.get(name, 300.0)
    try:
        resp = await client.post(url, json=payload, timeout=_timeout)
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


async def run_ingest_batched(
    client: httpx.AsyncClient,
    name: str,
    url: str,
    tickers: List[str],
    extra_payload: dict,
    batch_size: int,
    required_env: str | None = None,
) -> None:
    """Run an ingest endpoint in ticker batches, accumulating results.

    Batching is critical on Render free tier: one giant request for the whole
    universe blocks the single worker, so every later source times out while
    the server is still grinding through the first.  Batching keeps each HTTP
    request short and lets the server finish one batch before the next arrives.
    """
    if required_env and not os.getenv(required_env):
        print(f"  ⏭ {name}: skipped (set {required_env} for this source)")
        return
    if not tickers:
        print(f"  ⏭ {name}: no tickers to ingest")
        return
    batches = [tickers[i : i + batch_size] for i in range(0, len(tickers), batch_size)]
    total_ingested = 0
    failed_batches = 0
    for i, batch in enumerate(batches, 1):
        print(f"  [{name}] batch {i}/{len(batches)} — {batch[0]}…{batch[-1]} ({len(batch)} tickers)")
        payload = {"tickers": batch, **extra_payload}
        result = await run_ingest(client, name, url, payload)
        if result and isinstance(result, dict):
            total_ingested += result.get(
                "ingested",
                result.get("price_records", result.get("price_rows", result.get("count", 0))),
            )
        else:
            failed_batches += 1
    status = "✅" if failed_batches == 0 else "⚠️"
    print(f"  {status} {name}: done ({total_ingested} rows across {len(batches)} batches, "
          f"{failed_batches} failed)")


async def run_all(
    base_url: str,
    tickers: List[str],
    only: List[str] | None,
    period: str = "2y",
    fred_years: int = 5,
    batch_size: int = DEFAULT_BATCH_SIZE,
    preset: Optional[str] = None,
) -> None:
    """Run all ingestion endpoints in a sensible order.

    Every per-ticker source is sent in batches of `batch_size` — even when a
    preset resolved the universe.  This is critical on Render free tier: one
    giant request for 500 tickers blocks the single worker, so every later
    source times out while the server is still grinding through the first.
    Batching keeps each HTTP request short and lets the server finish one batch
    before the next arrives.  FRED has no per-ticker calls so it stays a single
    request.
    """
    async with httpx.AsyncClient(base_url=base_url) as client:
        # 1. FMP prices – daily OHLCV price history (replaces yfinance; works from any IP)
        if only is None or "fmp_prices" in only:
            print("Ingesting FMP price history (OHLCV)...")
            await run_ingest_batched(
                client, "fmp_prices", "/ingest/fmp_prices",
                tickers, {"period": period},
                batch_size=batch_size,
                required_env="FMP_API_KEY",
            )

        # 2. FMP – fundamentals for Greenblatt and screens
        if only is None or "fmp" in only:
            print("Ingesting FMP (fundamentals)...")
            await run_ingest_batched(
                client, "fmp", "/ingest/fmp",
                tickers, {},
                batch_size=batch_size,
                required_env="FMP_API_KEY",
            )

        # 3. FRED – macro indicators (no per-ticker calls)
        if only is None or "fred" in only:
            print("Ingesting FRED (macro indicators)...")
            await run_ingest(
                client, "fred", "/ingest/fred",
                {"years": fred_years},
                required_env="FRED_API_KEY",
            )

        # 4. Finnhub – news and analyst recommendations
        if only is None or "finnhub" in only:
            print("Ingesting Finnhub (news, recommendations)...")
            await run_ingest_batched(
                client, "finnhub", "/ingest/finnhub",
                tickers, {"include_news": True, "include_recommendations": True},
                batch_size=batch_size,
                required_env="FINNHUB_API_KEY",
            )

        # 5. SEC EDGAR – insiders and 13F (free)
        if only is None or "sec_edgar" in only:
            print("Ingesting SEC EDGAR (insiders, 13F)...")
            await run_ingest_batched(
                client, "sec_edgar", "/ingest/sec_edgar",
                tickers, {"include_13f": True, "include_insiders": True},
                batch_size=batch_size,
            )

        # 6. Recompute derived tables once after all raw data is loaded.
        # /ingest/fmp now only bulk-upserts fundamentals; the Greenblatt/formula/
        # value-compression recomputes were moved here so a full run pays for
        # them exactly once instead of once per 25-ticker batch. Runs inside the
        # async-with so it reuses the same client.
        recompute_universe = tickers if len(tickers) < 1500 else None
        print("Recomputing derived tables (greenblatt, formulas, value compression)...")
        try:
            resp = await client.post(
                "/ingest/recompute",
                json={"universe": recompute_universe} if recompute_universe else {},
                timeout=600.0,
            )
            if resp.is_success:
                print(f"  ✅ recompute: {resp.json()}")
            else:
                print(f"  ❌ recompute: HTTP {resp.status_code} - {resp.text[:200]}")
        except Exception as exc:
            print(f"  ❌ recompute: {type(exc).__name__}: {exc}")

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
        help="Comma-separated sources: fmp_prices,fmp,fred,finnhub,sec_edgar,yfinance",
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
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help=f"Tickers per ingest request when explicit tickers are given (default: {DEFAULT_BATCH_SIZE})",
    )
    parser.add_argument(
        "--no-warmup",
        action="store_true",
        default=False,
        help="Skip the backend health-check warmup (useful when backend is already running locally)",
    )
    args = parser.parse_args()

    # If explicit tickers given, resolve them; preset is passed through to the
    # server so it can handle full-universe runs without a giant JSON payload.
    explicit_tickers = args.tickers if args.tickers else None
    preset_for_server: Optional[str] = None

    if explicit_tickers:
        tickers = explicit_tickers
    else:
        preset_for_server = args.preset
        # Still resolve locally so we can print counts and validate the universe.
        tickers = _get_tickers(None, args.preset)

    only = args.only
    if only:
        valid = {"fmp_prices", "fmp", "fred", "finnhub", "sec_edgar", "yfinance"}
        invalid = set(only) - valid
        if invalid:
            print(f"Unknown --only source(s): {invalid}", file=sys.stderr)
            return 1

    print(f"Backend: {args.base_url}")
    if preset_for_server:
        print(f"Universe: {args.preset} preset ({len(tickers)} tickers) — resolved server-side")
    else:
        print(f"Tickers: {tickers[:5]}{'...' if len(tickers) > 5 else ''} ({len(tickers)} total)")
    if only:
        print(f"Only: {only}")

    # Warm up the backend before sending heavy ingest requests.
    # This is critical for Render free-tier which has a ~50s cold start.
    if not args.no_warmup:
        warmup_backend(args.base_url)

    asyncio.run(
        run_all(
            args.base_url,
            tickers,
            only,
            period=args.period,
            fred_years=args.fred_years,
            batch_size=args.batch_size,
            preset=preset_for_server,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
