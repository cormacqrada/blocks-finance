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
| **SEC EDGAR** | Insider transactions (Form 4), 13F filings | Free | No |
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
python -m venv .venv
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

# SEC EDGAR - Insider transactions (free, rate limited to 10 req/sec)
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

**Ingestion:**
- `POST /ingest/yfinance` - Yahoo Finance
- `POST /ingest/sec_edgar` - SEC EDGAR
- `POST /ingest/finnhub` - Finnhub
- `POST /ingest/fred` - FRED
- `POST /ingest/fmp` - Financial Modeling Prep

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
