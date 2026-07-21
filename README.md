# 📊 blocks-finance

A customizable value investing dashboard built with a modern frontend and FastAPI + DuckDB backend. Focused on Greenblatt-style quantitative analysis with support for multiple data sources and investment archetypes.

## Value Proposition

**For value investors who want to:**
- Screen stocks using custom formulas and filters (Graham Number, Margin of Safety, ROIC, etc.)
- Visualize portfolio positioning across multiple investment archetypes (Compounders, QARP, Turnarounds, etc.)
- Track institutional "whale" holdings and insider activity
- Monitor macro economic indicators relevant to equity valuations
- Build and save custom dashboards with drag-and-drop panels

## Top-Level Features

### 🎯 Investment Archetypes
Seven pre-built visualization panels for different value investing strategies:
- **Compounders** - High ROIC businesses with consistent growth
- **QARP (Quality at Reasonable Price)** - Quality metrics vs. valuation
- **Turnarounds** - Improving margin trends and re-ratings
- **Re-Rating Candidates** - Undervalued relative to sector
- **Capital Allocators** - Buyback and capital efficiency focused
- **Structural Winners** - Market share gainers with pricing power
- **Antifragile** - Low leverage, high cash positions

### 📈 Torque Visualizations
- **Scatter Plot** - Plot any two metrics with size by market cap
- **Ranking Table** - Sortable universe by custom formulas
- **Heatmap** - Visual comparison across metrics

### 📊 Alternative Data Panels
- **Whale Tracker** - Institutional 13F holdings changes (quarterly)
- **Macro Overview** - Fed rates, yield curve, VIX, unemployment from FRED
- **Insider Activity** - SEC Form 4 insider buys/sells
- **Company News** - Recent headlines from Finnhub

### 🧮 Custom Formula Engine
Create and evaluate custom metrics using fundamental data:
```
# Example formulas
Graham Number: SQRT(22.5 * eps * book_value_per_share)
Margin of Safety: (graham_number - price) / graham_number * 100
Quality Score: gross_margin * 0.3 + operating_margin * 0.3 + ...
```

### 💾 Persistent Dashboards
- Save and load dashboard configurations
- Auto-save panel sizes and positions on resize
- Global universe filtering

## Data Sources

| Source | Data Type | Cost | API Key Required |
|--------|-----------|------|------------------|
| **Yahoo Finance** (yfinance) | Price history, securities info | Free | No |
| **SEC EDGAR** (edgartools) | Insider transactions (Form 4), 13F holdings | Free | No (set `EDGAR_IDENTITY` recommended) |
| **Finnhub** | Company news, analyst recommendations | Free tier (60 calls/min) | Yes |
| **FRED** | Macro indicators (rates, VIX, CPI, etc.) | Free | Yes |
| **Financial Modeling Prep** | Detailed fundamentals | Paid | Yes |

## Project Structure

```
blocks-finance/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app, endpoints, ingestion
│   │   └── formula_engine.py    # Custom formula evaluation
│   ├── data/
│   │   └── finance.duckdb       # DuckDB database (created on first run)
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── main.ts              # Dashboard controller
│   │   ├── api/client.ts        # API client
│   │   └── components/
│   │       ├── archetypes/      # Investment archetype views
│   │       ├── torque/          # Torque visualization panels
│   │       ├── StockDetailView.ts
│   │       ├── WhaleTrackerPanel.ts
│   │       ├── MacroOverviewPanel.ts
│   │       ├── InsiderActivityPanel.ts
│   │       └── CompanyNewsPanel.ts
│   ├── index.html
│   └── package.json
└── README.md
```

## Runbook

### Local Development

**Prerequisites:**
- Python 3.11+
- Node.js 18+

**Backend Setup:**
```bash
cd backend

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Set environment variables (optional, for API keys)
export FMP_API_KEY=your_fmp_key
export FINNHUB_API_KEY=your_finnhub_key
export FRED_API_KEY=your_fred_key

# Start the server
uvicorn app.main:app --reload --port 8000
```

**Frontend Setup:**
```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

The frontend will be available at `http://localhost:5173` and the API at `http://localhost:8000`.

### Fetching Data

Data must be ingested before the dashboard can display meaningful information.

**1. Free Data Sources (No API Key Required):**

```bash
# Yahoo Finance - Price history and company info (free, no limit)
curl -X POST http://localhost:8000/ingest/yfinance \
  -H "Content-Type: application/json" \
  -d '{"period": "2y"}'

# SEC EDGAR - Insider transactions (Form 4) and 13F institutional holdings (free, via edgartools)
# Set EDGAR_IDENTITY for SEC compliance, e.g. export EDGAR_IDENTITY="Your Name you@example.com"
curl -X POST http://localhost:8000/ingest/sec_edgar \
  -H "Content-Type: application/json"
```

**2. API Key Required:**

```bash
# Finnhub - News and analyst recommendations
# Get free key at: https://finnhub.io
curl -X POST http://localhost:8000/ingest/finnhub \
  -H "Content-Type: application/json" \
  -d '{"api_key": "YOUR_FINNHUB_KEY"}'

# FRED - Macro economic indicators
# Get free key at: https://fred.stlouisfed.org/docs/api/api_key.html
curl -X POST http://localhost:8000/ingest/fred \
  -H "Content-Type: application/json" \
  -d '{"api_key": "YOUR_FRED_KEY", "years": 5}'

# FMP - Detailed fundamentals (required for Greenblatt scores)
# Get key at: https://financialmodelingprep.com/developer/docs/
curl -X POST http://localhost:8000/ingest/fmp \
  -H "Content-Type: application/json" \
  -d '{"api_key": "YOUR_FMP_KEY"}'
```

**3. Custom Ticker Universe:**

```bash
# Ingest specific tickers
curl -X POST http://localhost:8000/ingest/yfinance \
  -H "Content-Type: application/json" \
  -d '{"tickers": ["AAPL", "MSFT", "GOOGL"], "period": "5y"}'
```

**Expanding to a broader market (S&P 500):**

- **Presets:** The app supports universe presets: `default` (~25 curated tickers) and `sp500` (~500 stocks). Use `sp500` for screening and dashboards across the broad US large-cap market.
- **Refresh S&P 500 list:** With an FMP API key, refresh the cached S&P 500 constituent list:
  - **UI:** Settings → "Refresh S&P 500 list", then in the universe dropdown choose "S&P 500".
  - **API:** `POST /api/universe/refresh` with `{"api_key": "..."}` or set `FMP_API_KEY`; then `GET /api/universe?preset=sp500` returns the tickers.
- **Ingestion with preset:** Ingest using the S&P 500 universe:
  - `POST /ingest/run_all` with `{"preset": "sp500"}` (or `POST /ingest/fmp` with `{"preset": "sp500"}`).
  - CLI: `python -m app.run_ingestion --preset sp500` (backend must be running; run refresh first so the backend has the list).
- **Scheduled runs:** Set `INGESTION_UNIVERSE_PRESET=sp500` so scheduled ingestion uses the broader universe.

**4. Run all sources at once (recommended for dashboard):**

The backend and a CLI script can run every ingest in one go. Best data sources per use case:

| Dashboard need | Best source | Key |
|----------------|-------------|-----|
| Fundamentals, Greenblatt, screens | **FMP** | `FMP_API_KEY` |
| Price history, earnings | **yfinance** | None (free) |
| Macro panel | **FRED** | `FRED_API_KEY` |
| Company news, analyst recs | **Finnhub** | `FINNHUB_API_KEY` |
| Insider activity, whale tracker | **SEC EDGAR** | None (free) |

**From the API (run all ingestion):**
```bash
curl -X POST http://localhost:8000/ingest/run_all \
  -H "Content-Type: application/json" \
  -d '{}'
# Optional: {"tickers": ["AAPL", "MSFT"], "period": "2y", "fred_years": 5}
```

**From the CLI (backend must be running):**
```bash
cd backend
export FMP_API_KEY=your_key    # optional
export FRED_API_KEY=your_key   # optional
export FINNHUB_API_KEY=your_key # optional
python -m app.run_ingestion
# Custom tickers: python -m app.run_ingestion AAPL MSFT GOOGL
# Only some sources: python -m app.run_ingestion --only yfinance,fmp,fred
```

**Scheduled pulls:**

Enable daily (or custom) ingestion without cron:

```bash
# In production, enable scheduler (e.g. in env or Docker)
export INGESTION_SCHEDULE_ENABLED=1
export INGESTION_SCHEDULE_CRON="0 6 * * *"   # 6:00 AM daily (default)
export INGESTION_BASE_URL=http://localhost:8000  # URL for self-calls
# Set FMP_API_KEY, FRED_API_KEY, FINNHUB_API_KEY as needed
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Check schedule status: `GET /api/ingestion/schedule`

Alternatively, use system cron to run the CLI script:

```bash
# Example: daily at 6am
0 6 * * * cd /path/to/blocks-finance/backend && .venv/bin/python -m app.run_ingestion
```

### Updating the Database

The database uses DuckDB and is stored at `backend/data/finance.duckdb`.

**Reset Database:**
```bash
rm backend/data/finance.duckdb
# Restart the server - tables will be recreated
```

**Check Data Status:**
```bash
curl http://localhost:8000/api/data_sources
```

### API Endpoints Reference

**MCP Endpoints (for screens and formulas):**
- `POST /mcp/screen.run` - Run a stock screen with filters
- `POST /mcp/formula.evaluate` - Evaluate custom formulas
- `GET /mcp/formula.list` - List available formulas
- `GET /mcp/fundamentals.fields` - List available data fields

**Data Retrieval:**
- `GET /api/price_history/{ticker}?period=1y` - Price history
- `GET /api/insider_transactions/{ticker}` - Insider activity
- `GET /api/analyst_recommendations/{ticker}` - Analyst consensus
- `GET /api/whale_holdings/{ticker}` - Institutional holders
- `GET /api/company_news/{ticker}` - Recent news
- `GET /api/macro_overview` - Macro indicators
- `GET /api/universe?preset=default|sp500` - Ticker list for preset
- `GET /api/universe/presets` - Available universe presets
- `POST /api/universe/refresh` - Refresh S&P 500 list from FMP (body: optional `api_key`)

**Ingestion:**
- `POST /ingest/yfinance` - Yahoo Finance
- `POST /ingest/sec_edgar` - SEC EDGAR
- `POST /ingest/finnhub` - Finnhub
- `POST /ingest/fred` - FRED
- `POST /ingest/fmp` - Financial Modeling Prep
- `POST /ingest/run_all` - Run all ingestion sources (uses env API keys)
- `GET /api/ingestion/schedule` - Scheduled ingestion status (enabled, cron)

### Deployment

**Docker (Recommended):**
```bash
# Build
docker build -t blocks-finance-backend ./backend
docker build -t blocks-finance-frontend ./frontend

# Run
docker run -d -p 8000:8000 -v blocks-data:/app/data blocks-finance-backend
docker run -d -p 3000:80 blocks-finance-frontend
```

**Environment Variables for Production:**
```
FMP_API_KEY=xxx
FINNHUB_API_KEY=xxx
FRED_API_KEY=xxx
VITE_API_URL=https://your-api-domain.com
```

### Pushing Updates

```bash
# Backend changes
cd backend
git add .
git commit -m "Your message

git push

# Frontend changes  
cd frontend
npm run build  # Verify build succeeds
git add .
git commit -m "Your message

git push
```

## Configuration

### Settings Panel (Frontend)

Click the ⚙️ Settings button to configure:
- **FMP API Key** - Required for fundamentals data
- **Finnhub API Key** - Required for news/recommendations
- **FRED API Key** - Required for macro indicators

Keys are stored in browser localStorage.

### Default Universe

Edit `DEFAULT_TICKERS` in `backend/app/main.py` to change the default stock universe:

```python
DEFAULT_TICKERS = [
    "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA",
    "BRK-B", "JPM", "V", "MA",
    # Add your tickers...
]
```

## License

Apache

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

---

Built with ❤️ for value investors
