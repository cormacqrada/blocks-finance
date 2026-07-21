"""
SEC EDGAR ingestion using edgartools (PyPI: edgartools).

Requires EDGAR_IDENTITY env var (e.g. "Your Name you@example.com") for SEC compliance.
Rate limit: 10 requests/second — edgartools and our sleeps respect this.
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timedelta
from typing import List, Tuple

import duckdb

from app.db import upsert_row


def _ensure_identity() -> None:
    """Set SEC identity from env; required before any edgartools use."""
    from edgar import set_identity
    identity = os.getenv("EDGAR_IDENTITY", "BlocksFinance research@blocks.finance")
    set_identity(identity)


def _ingest_form4_for_tickers(
    conn: duckdb.DuckDBPyConnection,
    tickers: List[str],
    months_back: int = 12,
) -> int:
    """Fetch Form 4 insider transactions for each ticker via edgartools; insert into DB. Returns count inserted."""
    from edgar import Company

    _ensure_identity()
    date_from = (datetime.now() - timedelta(days=months_back * 31)).strftime("%Y-%m-%d:")
    count = 0

    for ticker in tickers:
        try:
            company = Company(ticker)
            filings = company.get_filings(form="4", filing_date=date_from)
            for i, filing in enumerate(filings):
                if i >= 80:
                    break
                try:
                    form4 = filing.obj()
                    if form4 is None:
                        continue
                    summary = form4.get_ownership_summary()
                    insider_name = getattr(summary, "insider_name", None) or getattr(form4, "insider_name", "") or "Unknown"
                    insider_title = getattr(summary, "position", None) or getattr(form4, "position", "") or ""
                    filing_date = getattr(filing, "filing_date", None) or getattr(form4, "reporting_period", "")
                    if not filing_date:
                        continue
                    filing_date_str = filing_date.strftime("%Y-%m-%d") if hasattr(filing_date, "strftime") else str(filing_date)[:10]

                    # market_trades: Date, Security, Shares, Price, Remaining, AcquiredDisposed, Code (P/S)
                    mt = getattr(form4, "market_trades", None)
                    if mt is None or (hasattr(mt, "empty") and mt.empty):
                        continue
                    # Aggregate by (insider, code) per filing to match PK (ticker, filing_date, insider_name, transaction_type)
                    seen: dict[tuple[str, str], list] = {}
                    for _, row in mt.iterrows():
                        code = str(row.get("Code", row.get("AcquiredDisposed", "P"))).strip().upper() or "P"
                        if code in ("A", "ACQUIRED"):
                            code = "P"
                        if code in ("D", "DISPOSED"):
                            code = "S"
                        if code not in ("P", "S"):
                            continue
                        key = (insider_name, code)
                        trade_date = row.get("Date")
                        trade_date_str = trade_date.strftime("%Y-%m-%d") if hasattr(trade_date, "strftime") else str(trade_date)[:10] if trade_date else filing_date_str
                        shares = int(row.get("Shares", 0) or 0)
                        price = float(row.get("Price", 0) or 0)
                        remaining = int(row.get("Remaining", 0) or 0)
                        value = shares * price if price else None
                        if key not in seen:
                            seen[key] = [trade_date_str, shares, price, value, remaining]
                        else:
                            prev = seen[key]
                            prev[1] += shares
                            prev[3] = (prev[3] or 0) + (value or 0)
                            prev[2] = prev[3] / prev[1] if prev[1] else prev[2]
                            prev[4] = remaining

                    for (iname, tx_type), (trade_date_str, shares, price, value, remaining) in seen.items():
                        try:
                            upsert_row(conn, "insider_transactions", {
                                "ticker": ticker,
                                "filing_date": filing_date_str,
                                "trade_date": trade_date_str,
                                "insider_name": iname,
                                "insider_title": insider_title,
                                "transaction_type": tx_type,
                                "shares": shares,
                                "price": price,
                                "value": value,
                                "shares_owned_after": remaining,
                                "data_source": "sec_edgar",
                            }, ["ticker", "filing_date", "insider_name", "transaction_type"])
                            count += 1
                        except Exception:
                            pass
                except Exception as e:
                    print(f"Warning: Form 4 parse {ticker}: {e}")
                    continue
            time.sleep(0.12)
        except Exception as e:
            print(f"Warning: SEC EDGAR Form 4 {ticker}: {e}")
            continue
    return count


# Well-known institutional 13F filers (ticker symbols) to pull holdings from; their holdings populate our institutional_holdings table.
DEFAULT_13F_FILERS = ["BRK.A", "BRK.B"]


def _ingest_13f_for_tickers(
    conn: duckdb.DuckDBPyConnection,
    tickers: List[str],
    filer_tickers: List[str] | None = None,
) -> int:
    """Fetch latest 13F-HR for each filer; for each holding whose Ticker is in tickers, insert into institutional_holdings. Returns count inserted."""
    from edgar import Company

    _ensure_identity()
    filers = filer_tickers or DEFAULT_13F_FILERS
    ticker_set = {t.upper() for t in tickers}
    count = 0

    for filer in filers:
        try:
            company = Company(filer)
            filings = company.get_filings(form="13F-HR")
            latest = filings.latest(1)
            if latest is None or (hasattr(latest, "__len__") and len(latest) == 0):
                time.sleep(0.12)
                continue
            filing = latest[0] if hasattr(latest, "__getitem__") and len(latest) else latest
            report = filing.obj()
            if report is None or not getattr(report, "has_infotable", lambda: True)():
                time.sleep(0.12)
                continue
            holdings = getattr(report, "holdings", None)
            if holdings is None or (hasattr(holdings, "empty") and holdings.empty):
                time.sleep(0.12)
                continue
            report_date = getattr(report, "report_period", None)
            report_date_str = report_date.strftime("%Y-%m-%d") if report_date and hasattr(report_date, "strftime") else (str(report_date)[:10] if report_date else "")
            filing_date = getattr(filing, "filing_date", None)
            filing_date_str = filing_date.strftime("%Y-%m-%d") if filing_date and hasattr(filing_date, "strftime") else (str(filing_date)[:10] if filing_date else "")
            holder_name = getattr(report, "management_company_name", "") or str(filer)
            holder_cik = ""
            try:
                c = getattr(filing, "company", None)
                if c is not None:
                    holder_cik = str(getattr(c, "cik", "") or "")
            except Exception:
                pass

            for _, row in holdings.iterrows():
                ticker = (row.get("Ticker") or "").strip().upper()
                if not ticker or ticker not in ticker_set:
                    continue
                value_thousands = row.get("Value")
                value_usd = float(value_thousands) * 1000 if value_thousands is not None else None
                shares = row.get("SharesPrnAmount")
                shares_int = int(shares) if shares is not None else None
                try:
                    upsert_row(conn, "institutional_holdings", {
                        "ticker": ticker,
                        "holder_cik": holder_cik or filer,
                        "holder_name": holder_name,
                        "filing_date": filing_date_str,
                        "report_date": report_date_str,
                        "shares": shares_int,
                        "value": value_usd,
                        "data_source": "sec_edgar",
                    }, ["ticker", "holder_cik", "report_date"])
                    count += 1
                except Exception:
                    pass
            time.sleep(0.12)
        except Exception as e:
            print(f"Warning: SEC EDGAR 13F {filer}: {e}")
            continue
    return count


def run_sec_edgar_ingestion(
    conn: duckdb.DuckDBPyConnection,
    tickers: List[str],
    include_13f: bool = True,
    include_insiders: bool = True,
    form4_months: int = 12,
    thirteenf_filers: List[str] | None = None,
) -> Tuple[int, int]:
    """Run Form 4 and optionally 13F ingestion; returns (insider_count, holdings_count)."""
    insider_count = 0
    holdings_count = 0
    if include_insiders:
        insider_count = _ingest_form4_for_tickers(conn, tickers, months_back=form4_months)
    if include_13f:
        holdings_count = _ingest_13f_for_tickers(conn, tickers, filer_tickers=thirteenf_filers)
    return insider_count, holdings_count
