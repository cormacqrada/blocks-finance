"""
Scheduled data ingestion: run ingest endpoints on a cron-like schedule.

Configure via environment variables:
  INGESTION_SCHEDULE_ENABLED=1           Enable scheduler (default: off)
  INGESTION_SCHEDULE_CRON="30 6 * * 1-5" Cron expr (default: Mon-Fri 06:30 UTC)
  INGESTION_QUARTERLY=1                  Override to quarterly (Feb/May/Aug/Nov 15 at 06:00)
  INGESTION_BASE_URL=http://localhost:8000  Self-call URL
  INGESTION_UNIVERSE_PRESET=default      Universe preset (default|sp500|small_mid)

NOTE: The recommended approach for Fly.io deployments is to use the GitHub
Actions workflow at .github/workflows/daily-ingestion.yml instead of this
in-process scheduler. GitHub Actions hits the backend URL on a cron schedule,
which wakes the Fly machine automatically (auto_start_machines = true) and
lets it sleep again between runs — no need to keep min_machines_running >= 1.
"""

from __future__ import annotations

import os
from typing import List

import httpx


def run_scheduled_ingestion(
    base_url: str | None = None,
    tickers: List[str] | None = None,
    preset: str | None = None,
) -> None:
    """
    Call all ingest endpoints in order (sync, for use inside scheduler job).
    Uses env vars for API keys; sources without keys are skipped.
    """
    base_url = base_url or os.getenv("INGESTION_BASE_URL", "http://localhost:8000")
    if tickers is None:
        from app.universe import get_universe
        preset = preset or os.getenv("INGESTION_UNIVERSE_PRESET", "default")
        tickers = get_universe(preset, fallback_to_default=True)
    payload = {"tickers": tickers}

    with httpx.Client(base_url=base_url, timeout=120.0) as client:
        # yfinance – always try (no key)
        try:
            r = client.post("/ingest/yfinance", json={**payload, "period": "2y", "include_earnings": True})
            if r.is_success:
                print(f"[scheduler] yfinance: {r.json()}")
        except Exception as e:
            print(f"[scheduler] yfinance error: {e}")

        # FMP – fetch last 4 quarters for each ticker
        if os.getenv("FMP_API_KEY"):
            try:
                r = client.post(
                    "/ingest/fmp",
                    json={
                        **payload,
                        "periods": 4,  # Last 4 quarters
                        "period": "quarter",
                    },
                )
                if r.is_success:
                    print(f"[scheduler] fmp: {r.json()}")
            except Exception as e:
                print(f"[scheduler] fmp error: {e}")

        # FRED
        if os.getenv("FRED_API_KEY"):
            try:
                r = client.post("/ingest/fred", json={"years": 5})
                if r.is_success:
                    print(f"[scheduler] fred: {r.json()}")
            except Exception as e:
                print(f"[scheduler] fred error: {e}")

        # Finnhub
        if os.getenv("FINNHUB_API_KEY"):
            try:
                r = client.post(
                    "/ingest/finnhub",
                    json={**payload, "include_news": True, "include_recommendations": True},
                )
                if r.is_success:
                    print(f"[scheduler] finnhub: {r.json()}")
            except Exception as e:
                print(f"[scheduler] finnhub error: {e}")

        # SEC EDGAR – no key
        try:
            r = client.post(
                "/ingest/sec_edgar",
                json={**payload, "include_13f": True, "include_insiders": True},
            )
            if r.is_success:
                print(f"[scheduler] sec_edgar: {r.json()}")
        except Exception as e:
            print(f"[scheduler] sec_edgar error: {e}")


def get_scheduler():
    """Create and return an APScheduler instance if scheduling is enabled.

    Environment variables:
    - INGESTION_SCHEDULE_ENABLED: "1", "true", "yes" to enable
    - INGESTION_SCHEDULE_CRON: cron expression (default: "0 6 15 2,5,8,11 *" = quarterly on 15th)
    - INGESTION_QUARTERLY: "1" to use preset quarterly schedule (15th of Feb, May, Aug, Nov at 6am)
    """
    enabled = os.getenv("INGESTION_SCHEDULE_ENABLED", "").strip().lower() in ("1", "true", "yes")
    if not enabled:
        return None

    from apscheduler.schedulers.background import BackgroundScheduler

    # Daily weekday schedule (default). Price data needs to be fresh every trading day.
    # Override with INGESTION_SCHEDULE_CRON env var, or set INGESTION_QUARTERLY=1
    # for the old quarterly-only schedule (15th of Feb, May, Aug, Nov).
    if os.getenv("INGESTION_QUARTERLY", "").strip().lower() in ("1", "true", "yes"):
        cron = "0 6 15 2,5,8,11 *"
    else:
        cron = os.getenv("INGESTION_SCHEDULE_CRON", "30 6 * * 1-5")  # Mon–Fri 06:30 UTC

    parts = cron.split()
    if len(parts) != 5:
        # fallback: quarterly on 15th of Feb, May, Aug, Nov
        parts = ["0", "6", "15", "2,5,8,11", "*"]

    scheduler = BackgroundScheduler()
    scheduler.add_job(
        run_scheduled_ingestion,
        "cron",
        minute=parts[0],
        hour=parts[1],
        day=parts[2],
        month=parts[3],
        day_of_week=parts[4],
        id="ingestion",
    )
    return scheduler
