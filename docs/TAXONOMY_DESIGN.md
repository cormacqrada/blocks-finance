# Advanced Taxonomy Design: Mapping, Filtering & Grouping

## Goals

1. **GICS-style baseline** — Standard L1/L2/L3 for broad heatmaps and comparables.
2. **ETF-based overrides** — Where capital actually flows (sector/thematic ETFs) can override or supplement the baseline for grouping.
3. **Custom thematic overlays** — Cross-sector themes (AI, defense, rate-sensitive, etc.) for rotation and idea generation.

You already have (1) and (3) in `taxonomy.py` + `taxonomy_map`. This doc refines the **data model**, adds **ETF-aware grouping**, and ties it to **visualizations**.

---

## 1. Taxonomy Levels (Recap)

| Level | Name                  | Purpose |
|-------|-----------------------|--------|
| L1    | Macro Sector          | Broad heatmap; 11 GICS-style sectors |
| L2    | Industry Cluster      | Capital-flow aware (Banks, Semiconductors, etc.) |
| L3    | Business Model Group  | Apples-to-apples peers (P&C Insurers, GPU/AI Accelerators) |
| L4    | Custom Themes         | Cross-sector tags (ai_infrastructure, rate_sensitive, …) |

**Override rule:**  
- **Baseline** = our taxonomy (from vendor inference or manual).  
- **ETF overlay** = optional “display sector/cluster” derived from primary sector ETF or thematic ETF membership, used when user chooses “Group by: ETF flow”.

---

## 2. Data Model: Single Source of Truth

### Option A: Keep Normalized (Current + ETF Table)

- **securities** — Vendor/original: `ticker`, `company_name`, `sector`, `industry`, `exchange`, `country`, `updated_at`.
- **taxonomy_map** — Our classification: `ticker`, `macro_sector`, `industry_cluster`, `business_model_group`, `themes` (JSON), `override_source`.
- **etf_ticker_mapping** (new) — ETF overlay: which sector/thematic ETF(s) each ticker belongs to, and optionally weight.

Good for: multiple ETF memberships per ticker, thematic overlap, and “capital flow” views.

### Option B: Denormalized “Companies” View

One **companies** table (or view) for reads:

```
companies (logical view)
------------------------
ticker
name
market_cap          -- from fundamentals or securities
country
gics_sector         -- vendor sector (or our macro_sector)
gics_industry       -- vendor industry
gics_sub_industry   -- optional, from vendor
gics_code           -- optional, if you have it from FMP
macro_sector        -- our L1
industry_cluster    -- our L2
business_model_group-- our L3
themes              -- JSON array L4
etf_display_sector  -- optional override from primary sector ETF
etf_thematic_tags   -- optional list of thematic ETFs (e.g. ["XLK","QQQ","BOTZ"])
```

**Recommendation:** Implement **Option A** in the DB (keep `securities` + `taxonomy_map`, add `etf_ticker_mapping`), and expose a **companies** view or API that joins them. That gives one place for “all metadata for a ticker” without duplicating storage.

---

## 3. ETF-Based Override: How It Works

### Idea

- **Sector ETFs** (XLF, XLK, XLE, XLV, …) define “where the market groups this stock” for flow/rotation.
- **Thematic ETFs** (BOTZ, ICLN, GLD, …) define cross-sector themes that move capital.

**Override semantics:**

- **Display mode “GICS” (default):** Use `macro_sector` / `industry_cluster` / `business_model_group` from `taxonomy_map`.
- **Display mode “ETF flow”:** Use sector from “primary sector ETF” for L1/L2 grouping; optionally show thematic ETF memberships as badges or filters.

### Data You Need

| Source | What to store | Use |
|--------|----------------|-----|
| FMP / IEX / etc. | ETF holdings (ETF symbol → list of tickers + weight) | For each ticker, derive “in which ETFs” and optionally “primary sector ETF” (e.g. largest weight in a sector ETF). |
| Or static map | Ticker → primary sector ETF (e.g. AAPL → XLK) | Simple override for L1 grouping. |

### Schema Addition: `etf_ticker_mapping`

```sql
CREATE TABLE etf_ticker_mapping (
    ticker TEXT,
    etf_symbol TEXT,           -- e.g. 'XLK', 'QQQ', 'BOTZ'
    etf_type TEXT,             -- 'sector' | 'thematic' | 'broad'
    weight_pct DOUBLE,         -- optional, from holdings
    as_of DATE,
    PRIMARY KEY (ticker, etf_symbol)
);
```

- **sector** ETFs: XLK, XLF, XLE, XLV, XLI, XLY, XLP, XLU, XLB, XLRE, XLC.  
  For “group by ETF”, map each ticker to one primary sector ETF (e.g. by max weight among sector ETFs).
- **thematic** ETFs: store as many as you have (BOTZ, ICLN, SOXX, …); use for L4-style tags or “in which thematic baskets” view.

### Deriving “Primary sector ETF”

- When you ingest ETF holdings (e.g. from FMP), for each ticker:
  - Among rows where `etf_type = 'sector'`, pick the ETF with highest `weight_pct` (or first if equal) as that ticker’s **primary_sector_etf**.
- Store either:
  - In a **materialized view** or small table: `ticker → primary_sector_etf`, or
  - Compute on read: `SELECT etf_symbol FROM etf_ticker_mapping WHERE ticker = ? AND etf_type = 'sector' ORDER BY weight_pct DESC LIMIT 1`.

Then in API responses, when `group_by=etf`, return `etf_display_sector` (e.g. “Technology” from XLK) and group by that.

---

## 4. Companies “Master” API

Expose a single endpoint that returns one row per ticker with all classification and optional ETF overlay, so the frontend can:

- Filter by sector / cluster / business_model / theme.
- Group by sector, cluster, or ETF.

Example response shape:

```json
{
  "companies": [
    {
      "ticker": "AAPL",
      "name": "Apple Inc.",
      "market_cap": 3000000000000,
      "country": "US",
      "sector": "Technology",
      "industry": "Consumer Electronics",
      "macro_sector": "Technology",
      "industry_cluster": "Hardware",
      "business_model_group": "Consumer Electronics",
      "themes": ["ai_applications"],
      "primary_sector_etf": "XLK",
      "thematic_etfs": ["QQQ", "XLK"]
    }
  ]
}
```

Implementation: join `securities` + `taxonomy_map` + (optional) aggregated `etf_ticker_mapping`. You can add query params: `?sector=Financials`, `?theme=rate_sensitive`, `?group_by=macro_sector|industry_cluster|etf`.

---

## 5. Frontend: Grouping & Filtering in Visualizations

### Heatmap

- **Group by:** None | Macro sector | Industry cluster | ETF sector.
- When “Macro sector” or “Industry cluster”: sort/partition rows so that all tickers in the same sector/cluster are adjacent; optionally add a small section header (e.g. “Technology”, “Banks”).
- When “ETF sector”: use `etf_display_sector` (or primary_sector_etf) to partition rows.
- Data: same screener/metric payload; enrich each row with `macro_sector` / `industry_cluster` (and optionally `primary_sector_etf`) from `/api/taxonomy/mappings` or the new companies endpoint, then group in the UI.

### Scatter / Tables

- **Filter by:** Sector, cluster, business model, theme (multi-select).
- Call `POST /api/taxonomy/filter` with `macro_sector`, `industry_cluster`, `business_model_group`, `themes[]` to get ticker list, then pass that as universe to the screener/scatter.

### Theme Overlays

- Already supported: `GET /api/taxonomy/by_theme/{theme}`.
- In visualizations: show a theme as a badge on the ticker, or filter to “tickers that have this theme”.

---

## 6. Implementation Order

1. **Data model** ✓
   - Add `etf_ticker_mapping` (and optionally a small `sector_etf_labels` table: etf_symbol → display name, e.g. XLK → “Technology”).
   - Add a view or function that returns “companies” (join securities + taxonomy_map + primary sector ETF).
2. **Ingestion**
   - On fundamentals/security ingest: keep inferring taxonomy from vendor (sector/industry) and upserting `taxonomy_map` with `override_source = 'vendor'` when no manual override exists.
   - **Deferred:** FMP ETF holdings ingestion (uses API quota). When ready, add a job that fetches sector/thematic ETF holdings and fills `etf_ticker_mapping`.
3. **API** ✓
   - `GET /api/companies` with optional filters; include macro_sector, industry_cluster, business_model_group, themes; when ETF data exists, primary_sector_etf/thematic_etfs (no FMP calls from this endpoint).
   - Keep existing taxonomy endpoints; they remain the source of truth for hierarchy and filters.
4. **Frontend**
   - Heatmap: fetch taxonomy mappings (or companies) and add “Group by: None | Sector | Cluster” (and “ETF” once ingestion is added).
   - Screener/Universe: add taxonomy filters (sector, cluster, theme) that call `/api/taxonomy/filter` and set the universe.

---

## 7. Where to Get GICS / ETF Data

| Data        | Source options | Notes |
|------------|-----------------|--------|
| Sector/industry | FMP profile, yfinance, IEX | You already map these via `infer_taxonomy_from_vendor`. |
| GICS code  | FMP, Bloomberg (if available) | Optional; improves consistency with index providers. |
| ETF holdings | FMP (ETF holdings), IEX, manual | Sector ETFs (XLF, XLK, …) + a few thematic (BOTZ, ICLN, SOXX) are enough to start. |

---

## 7b. Deferred: ETF ingestion (FMP API quota)

**Fetching ETF holdings from FMP uses your API allotment** (one or more calls per ETF). To avoid burning quota, ETF ingestion is **deferred**:

- The **schema** (`etf_ticker_mapping`) and **API** (`GET /api/companies` with `include_etf`) are in place; they only read from the DB and do not call FMP.
- When you want “Group by: ETF”, add a separate ingestion job (e.g. script that calls FMP’s ETF holdings endpoint and writes to `etf_ticker_mapping`) and run it when you’re comfortable using the quota. Until then, `primary_sector_etf` / `thematic_etfs` will be empty and grouping uses GICS/taxonomy only.

---

## 8. Summary

- **Baseline:** Keep your existing GICS-style L1/L2/L3 and themes in `taxonomy_map`; keep vendor inference for new tickers.
- **ETF override (deferred):** Table and API support are in place; populating `etf_ticker_mapping` via FMP ETF holdings is deferred to avoid FMP API usage. When you add that ingestion, “Group by: ETF flow” and thematic overlays will work.
- **Single place for UI:** Expose a companies view/API that joins securities + taxonomy_map + ETF data for filtering and grouping.
- **Visualizations:** Heatmap group-by (sector / cluster / ETF); scatter/table filter-by sector/cluster/theme using existing and new APIs.

This gives you a clear, scalable path from “static GICS” to “capital-flow aware” grouping while keeping custom themes as the cross-cutting layer.
