# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Overview

This repository is a minimal FastAPI backend template wired for the Blocks runtime. It exposes:
- A health check endpoint.
- Debug endpoints for seeding and inspecting sample Greenblatt fundamentals data.
- A set of MCP-style endpoints for ingesting fundamentals into DuckDB and computing/querying Greenblatt scores.
- A standalone ingestion script that pulls data from Financial Modeling Prep (FMP) and pushes it into this backend.

DuckDB is used as the embedded analytical store, with the database file located under `data/finance.duckdb`. The schema is created lazily on first connection in `app/main.py`.

The Blocks manifest (`blocks-manifest.json`) declares this as a `backend-fastapi` template and wires it into the broader Blocks ecosystem.

## Project structure

- `app/main.py`: FastAPI application entrypoint.
  - Configures CORS for local development.
  - Manages a singleton DuckDB connection and bootstraps core tables: `securities`, `fundamentals`, and `greenblatt_scores`.
  - Defines HTTP endpoints:
    - `GET /health`: simple healthcheck.
    - `GET /debug/fundamentals`: returns raw rows from `fundamentals`.
    - `POST /debug/seed_sample_greenblatt`: seeds sample data and computes scores.
    - `POST /mcp/finance.upsert_fundamentals`: upserts fundamentals into DuckDB from a JSON payload `{ "rows": FundamentalRow[] }`.
    - `POST /mcp/finance.compute_greenblatt_scores`: recomputes Greenblatt scores, optionally filtered by `universe`.
    - `POST /mcp/finance.query_greenblatt_scores`: queries ranked Greenblatt scores, with optional `universe` and `limit`.
- `app/scripts_ingest_fmp.py`: async ingestion script.
  - Reads `FMP_API_KEY` from the environment (never hardcode the key).
  - Uses FMP APIs (key metrics, income statement, balance sheet) to derive EBIT, enterprise value, and net working capital for a universe of tickers.
  - POSTs fundamentals into `/mcp/finance.upsert_fundamentals` and then calls `/mcp/finance.compute_greenblatt_scores` on this backend.
  - The backend base URL is configurable via `BLOCKS_FINANCE_BACKEND_URL` (defaults to `http://localhost:8000`).
- `data/finance.duckdb`: DuckDB database file created on demand.
- `test_fmp_key.py`: standalone script to validate that the `FMP_API_KEY` environment variable is set and working by calling an FMP profile endpoint.
- `requirements.txt`: core Python dependencies (FastAPI, Uvicorn, DuckDB, httpx).
- `blocks-manifest.json`: Blocks manifest describing this backend template and its collections.

## Environment and configuration

- Python virtual environment is typically managed via `.venv` in this repo.
- External configuration is driven through environment variables:
  - `FMP_API_KEY`: required for any script that calls FMP (e.g. `scripts_ingest_fmp.py`, `test_fmp_key.py`). Must not be committed.
  - `BLOCKS_FINANCE_BACKEND_URL`: optional; overrides the backend URL for ingestion scripts (default `http://localhost:8000`).

## Common commands

All commands below assume your working directory is the repository root.

### Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Run the FastAPI backend (development)

Use Uvicorn against the FastAPI app defined in `app/main.py`:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Key endpoints during development:
- Healthcheck: `GET /health`
- Debug fundamentals data: `GET /debug/fundamentals`
- Seed sample data and scores: `POST /debug/seed_sample_greenblatt`

### Run the FMP API key check script

```bash
export FMP_API_KEY=your_key_here
python test_fmp_key.py
```

This script verifies that the FMP key is valid by querying the profile endpoint for `AAPL` and printing a small subset of the response.

### Run the ingestion script to populate DuckDB and compute scores

1. Ensure the backend is running (see "Run the FastAPI backend").
2. Set your FMP API key and, optionally, a custom backend URL:

```bash
export FMP_API_KEY=your_key_here
# Optional override if not using the default localhost:8000
export BLOCKS_FINANCE_BACKEND_URL=http://localhost:8000
```

3. Run the ingestion script:

```bash
python -m app.scripts_ingest_fmp
# or, if you prefer invoking the file directly
python app/scripts_ingest_fmp.py
```

This will fetch fundamentals for the hard-coded `tickers` list in `main()` and push them into DuckDB via the MCP-style endpoints.

### Inspecting data in DuckDB

The backend provides HTTP access to `fundamentals` and Greenblatt scores via the `/debug` and `/mcp` endpoints. For ad-hoc local inspection from the shell, you can also connect directly to the DuckDB file:

```bash
python -q << 'PY'
import duckdb
from pathlib import Path

db_path = Path('data') / 'finance.duckdb'
con = duckdb.connect(str(db_path))
print(con.execute('SELECT * FROM fundamentals LIMIT 10').fetchdf())
print(con.execute('SELECT * FROM greenblatt_scores ORDER BY rank LIMIT 10').fetchdf())
PY
```

## Notes for future agents

- Treat `app/main.py` as the source of truth for the database schema and the MCP surface area. Any new finance-related tools or scoring logic should be wired similarly: pure compute/ingest logic inside the app, thin HTTP layer at the top.
- When extending the ingestion logic, prefer adding functionality to `app/scripts_ingest_fmp.py` (or sibling scripts) rather than embedding provider-specific logic directly into FastAPI route handlers.
- Preserve the pattern of reading sensitive configuration (like `FMP_API_KEY`) only from environment variables and never logging them.
