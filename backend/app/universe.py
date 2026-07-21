"""
Stock universe presets for screening and ingestion.

Provides a single source of truth for "default" (curated ~25), "sp500"
(broader market), and "small_mid" (small & mid cap from FMP stock screener).
All API-fetched lists are cached to disk.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import List, Optional

UNIVERSE_DATA_DIR = Path(__file__).parent.parent / "data"
UNIVERSE_DATA_DIR.mkdir(parents=True, exist_ok=True)
SP500_CACHE_PATH = UNIVERSE_DATA_DIR / "universe_sp500.json"
SMALL_MID_CACHE_PATH = UNIVERSE_DATA_DIR / "universe_small_mid.json"

# Curated default: small set for fast demos and low API usage
DEFAULT_TICKERS = [
    "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA",
    "BRK-B", "JPM", "V", "MA",
    "JNJ", "UNH", "PFE", "ABBV",
    "KO", "PEP", "PG", "COST", "WMT",
    "CAT", "HON", "UPS",
    "XOM", "CVX",
]

PRESETS = {
    "default": {
        "name": "Default (curated)",
        "description": "~25 large-cap stocks across sectors",
        "count": len(DEFAULT_TICKERS),
    },
    "sp500": {
        "name": "S&P 500",
        "description": "Broad US large-cap market (~500 stocks)",
        "count": None,  # varies after refresh
    },
    "small_mid": {
        "name": "Small & Mid Cap",
        "description": "Small & mid-cap US stocks (market cap $300M–$10B) from FMP screener",
        "count": None,  # varies after refresh
    },
}


def _read_cached_symbols(cache_path: Path) -> List[str]:
    """Read ticker symbols from a JSON cache file."""
    if not cache_path.exists():
        return []
    try:
        with open(cache_path) as f:
            data = json.load(f)
        symbols = data if isinstance(data, list) else data.get("symbols", data.get("tickers", []))
        return [s if isinstance(s, str) else s.get("symbol") or s.get("ticker") for s in symbols if s]
    except Exception:
        return []


def get_preset_universe(preset: str) -> List[str]:
    """
    Return ticker list for a named preset.
    - default: built-in curated list
    - sp500: from cache file (run refresh first if empty)
    - small_mid: from cache file (run refresh first if empty)
    """
    preset = (preset or "").strip().lower()
    if preset not in PRESETS:
        return DEFAULT_TICKERS

    if preset == "default":
        return list(DEFAULT_TICKERS)

    if preset == "sp500":
        return _read_cached_symbols(SP500_CACHE_PATH)

    if preset == "small_mid":
        return _read_cached_symbols(SMALL_MID_CACHE_PATH)

    return list(DEFAULT_TICKERS)


def get_universe(preset: str | None = None, fallback_to_default: bool = True) -> List[str]:
    """
    Return tickers for the given preset. If preset is None or empty, returns default.
    If the preset cache is empty and fallback_to_default is True, returns default.
    """
    tickers = get_preset_universe(preset or "default")
    if not tickers and preset in ("sp500", "small_mid") and fallback_to_default:
        return list(DEFAULT_TICKERS)
    return tickers


def refresh_sp500_from_wiki() -> List[str]:
    """Fetch S&P 500 tickers from Wikipedia (free, no API key required).
    Uses wikitable2json API to parse the Wikipedia table.
    """
    import httpx

    wiki_page = "List_of_S%26P_500_companies"
    url = f"https://wikitable2json.vercel.app/api/{wiki_page}?table=0"
    headers = {"User-Agent": "BlocksFinance (finance@blocks.dev)"}

    with httpx.Client(timeout=30.0) as client:
        resp = client.get(url, headers=headers)
        resp.raise_for_status()
        data = resp.json()

    # API returns list of dicts; tickers are in the 'Symbol' key
    symbols = [item["Symbol"].replace(".", "-") for item in data if "Symbol" in item]
    symbols = [s for s in symbols if s.strip()]

    with open(SP500_CACHE_PATH, "w") as f:
        json.dump({"symbols": symbols, "source": "wikipedia", "count": len(symbols)}, f, indent=2)

    return symbols


def refresh_sp500_from_fmp(api_key: str) -> List[str]:
    """
    Fetch current S&P 500 constituents from FMP, write to universe_sp500.json, return symbols.
    Raises on network/API errors (including 402 Payment Required for free-tier users).
    """
    import httpx

    # FMP stable endpoint for S&P 500 constituents
    url = "https://financialmodelingprep.com/stable/sp500-constituent"
    with httpx.Client(timeout=30.0) as client:
        resp = client.get(url, params={"apikey": api_key})
        resp.raise_for_status()
        data = resp.json()

    # Response can be list of {symbol, name, ...}, or dict with constituents/data
    if isinstance(data, list):
        symbols = [item.get("symbol") or item.get("ticker") for item in data if isinstance(item, dict)]
    elif isinstance(data, dict):
        symbols = (
            data.get("constituents")
            or data.get("data")
            or data.get("symbols")
            or []
        )
        if symbols and isinstance(symbols[0], dict):
            symbols = [x.get("symbol") or x.get("ticker") for x in symbols if x]
    else:
        symbols = []

    symbols = [s for s in symbols if isinstance(s, str) and s.strip()]

    with open(SP500_CACHE_PATH, "w") as f:
        json.dump({"symbols": symbols, "source": "fmp", "count": len(symbols)}, f, indent=2)

    return symbols


def refresh_sp500(fmp_api_key: str | None = None) -> List[str]:
    """
    Refresh S&P 500 constituents, trying FMP first (if key provided) then Wikipedia fallback.
    Writes to universe_sp500.json and returns symbols.
    """
    # Try FMP first if key provided
    if fmp_api_key:
        try:
            return refresh_sp500_from_fmp(fmp_api_key)
        except Exception as e:
            # Log but don't fail - fall back to Wikipedia
            import sys
            print(f"Warning: FMP S&P 500 refresh failed, using Wikipedia fallback: {e}", file=sys.stderr)

    # Fallback to free Wikipedia source
    return refresh_sp500_from_wiki()


# ============================================================================
# Small & Mid Cap Universe (FMP Stock Screener)
# ============================================================================

# Market cap thresholds for cap categories (in USD)
SMALL_CAP_FLOOR = 300_000_000       # $300M
MID_CAP_CEILING = 10_000_000_000    # $10B


def refresh_small_mid_from_fmp(
    api_key: str,
    *,
    market_cap_floor: int = SMALL_CAP_FLOOR,
    market_cap_ceil: int = MID_CAP_CEILING,
    exchanges: str = "NYSE,NASDAQ",
    limit: int = 200,
) -> List[str]:
    """Fetch small & mid cap tickers from FMP Stock Screener API.

    Uses the FMP stock screener endpoint with market-cap range filters.
    Results are sorted by market cap descending so the largest mid-caps
    appear first (more likely to have good fundamentals data).

    Writes to universe_small_mid.json and returns symbols.
    Raises on network/API errors.
    """
    import httpx

    url = "https://financialmodelingprep.com/api/v3/stock-screener"
    params = {
        "apikey": api_key,
        "marketCapMoreThan": market_cap_floor,
        "marketCapLowerThan": market_cap_ceil,
        "exchange": exchanges,
        "limit": limit,
    }

    with httpx.Client(timeout=30.0) as client:
        resp = client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()

    # FMP screener returns a list of dicts with "symbol", "companyName", "marketCap", etc.
    if isinstance(data, list):
        results = [
            {
                "symbol": item.get("symbol", ""),
                "name": item.get("companyName", ""),
                "market_cap": item.get("marketCap", 0),
                "sector": item.get("sector", ""),
                "industry": item.get("industry", ""),
                "exchange": item.get("exchange", ""),
            }
            for item in data
            if isinstance(item, dict) and item.get("symbol")
        ]
        # Sort by market cap descending
        results.sort(key=lambda x: x.get("market_cap") or 0, reverse=True)
        symbols = [r["symbol"] for r in results]
    else:
        results = []
        symbols = []

    with open(SMALL_MID_CACHE_PATH, "w") as f:
        json.dump(
            {
                "symbols": symbols,
                "details": results,
                "source": "fmp_screener",
                "filters": {
                    "market_cap_floor": market_cap_floor,
                    "market_cap_ceil": market_cap_ceil,
                    "exchanges": exchanges,
                },
                "count": len(symbols),
            },
            f,
            indent=2,
        )

    return symbols


def refresh_small_mid(
    fmp_api_key: str | None = None,
    *,
    limit: int = 200,
) -> List[str]:
    """Refresh small & mid cap tickers from FMP Stock Screener.

    Requires FMP_API_KEY — no free fallback available for this universe.
    Writes to universe_small_mid.json and returns symbols.
    """
    if not fmp_api_key:
        fmp_api_key = os.getenv("FMP_API_KEY")
    if not fmp_api_key:
        raise ValueError("FMP_API_KEY is required to refresh the small_mid universe")

    return refresh_small_mid_from_fmp(fmp_api_key, limit=limit)
