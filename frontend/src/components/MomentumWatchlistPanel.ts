/**
 * MomentumWatchlistPanel — Robinhood-style Momentum Watchlist
 *
 * Real data from backend /api/price_history/{ticker} (populated by /ingest/yfinance).
 * Falls back to seeded simulation when backend has no price history for a ticker.
 * Ticker search uses the same fetchScreenData infrastructure as the main SearchCombobox.
 */

import { Chart, registerables } from "chart.js";
import { fetchScreenData, fetchPriceHistory, type PricePoint } from "../api/client";
Chart.register(...registerables);

const STORAGE_KEY = "blocks-finance-watchlist-v2";

// Suggestion row from the DB (mirrors SearchCombobox)
interface TickerSuggestion {
  ticker: string;
  price?: number;
  pe_ratio?: number;
  market_cap?: number;
}

const DEFAULT_WATCHLIST: WatchlistEntry[] = [
  { ticker: "AAPL",  reason: "Wide moat, services flywheel",      addedAt: Date.now() - 5e6 },
  { ticker: "SOFI",  reason: "Fintech turnaround, bank charter",   addedAt: Date.now() - 4e6 },
  { ticker: "COIN",  reason: "Crypto infra leverage play",         addedAt: Date.now() - 3e6 },
  { ticker: "PLTR",  reason: "AI/defense, AIP momentum",           addedAt: Date.now() - 2e6 },
  { ticker: "AMD",   reason: "AI chip challenger, MI300 ramp",     addedAt: Date.now() - 1e6 },
];

type Timeframe = "1D" | "1W" | "1M" | "3M" | "1Y" | "YTD";
type SortMode  = "momentum" | "change" | "volatility" | "alpha";

interface WatchlistEntry {
  ticker: string;
  reason: string;
  addedAt: number;
}

interface BarInfo {
  label: string;
  ret: number;     // session return
  cumRet: number;  // cumulative return from period start
  close: number;   // simulated close price
}

interface StockMetrics {
  prices: number[];      // normalized (start = 100)
  ribbonBars: BarInfo[];
  changePercent: number;
  changeDollar: number;
  basePrice: number;
  volatility: number;    // annualized %
  streak: number;
  streakDir: "up" | "down";
  returns: number[];     // per-bar, for correlation
}

// Max ribbon bars per timeframe
const TF_RIBBON: Record<Timeframe, number> = {
  "1D": 13, "1W": 5, "1M": 22, "3M": 22, "1Y": 26, "YTD": 20,
};

// ─── Price data helpers ──────────────────────────────────────────────────────────

const MS = 86400000; // ms per day

function filterByTimeframe(data: PricePoint[], tf: Timeframe): PricePoint[] {
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  if (tf === "1D") return sorted.slice(-2); // last 2 sessions = 1-day change
  const now    = new Date();
  const cutoff = {
    "1W":  new Date(now.getTime() - 7   * MS),
    "1M":  new Date(now.getTime() - 31  * MS),
    "3M":  new Date(now.getTime() - 92  * MS),
    "1Y":  new Date(now.getTime() - 366 * MS),
    "YTD": new Date(now.getFullYear(), 0, 1),
  }[tf as Exclude<Timeframe, "1D">] ?? new Date(now.getTime() - 31 * MS);
  const filtered = sorted.filter(p => new Date(p.date) >= cutoff);
  return filtered.length >= 2 ? filtered : sorted.slice(-Math.max(2, Math.min(10, sorted.length)));
}

function computeMetricsFromPrices(rawData: PricePoint[], tf: Timeframe): StockMetrics | null {
  const nRibbonMax = TF_RIBBON[tf];
  const filtered   = filterByTimeframe(rawData, tf);
  if (filtered.length < 2) return null;

  const base      = filtered[0].close;
  const lastClose = filtered[filtered.length - 1].close;
  const prices    = filtered.map(p => (p.close / base) * 100);

  const returns: number[] = [];
  for (let i = 1; i < filtered.length; i++) {
    returns.push((filtered[i].close - filtered[i - 1].close) / filtered[i - 1].close);
  }

  const changePercent = (lastClose - base) / base * 100;
  const changeDollar  = lastClose - base;

  // Annualised vol (always 252 daily trading days basis)
  const mean     = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length || 1);
  const volatility = Math.sqrt(variance) * Math.sqrt(252) * 100;

  // Trailing streak
  let streak = 0;
  let streakDir: "up" | "down" = "up";
  if (returns.length > 0) {
    const last = returns[returns.length - 1];
    streakDir  = last >= 0 ? "up" : "down";
    for (let i = returns.length - 1; i >= 0; i--) {
      if ((returns[i] >= 0) === (last >= 0)) streak++;
      else break;
    }
  }

  // Ribbon bars — sample evenly from real data points
  const nRibbon = Math.min(nRibbonMax, filtered.length - 1);
  const stride  = Math.max(1, Math.floor(filtered.length / (nRibbon || 1)));
  const ribbonBars: BarInfo[] = Array.from({ length: nRibbon }, (_, i) => {
    const pIdx    = Math.min(Math.round((i + 1) * stride) - 1, filtered.length - 1);
    const prevIdx = Math.max(0, pIdx - stride);
    const ret     = filtered[prevIdx].close > 0
      ? (filtered[pIdx].close - filtered[prevIdx].close) / filtered[prevIdx].close
      : 0;
    return {
      label:  filtered[pIdx].date,
      ret,
      cumRet: (prices[Math.min(pIdx, prices.length - 1)] - 100) / 100,
      close:  filtered[pIdx].close,
    };
  });

  return { prices, ribbonBars, changePercent, changeDollar, basePrice: lastClose, volatility, streak, streakDir, returns };
}

function fmtCap(cap: number): string {
  if (cap >= 1e12) return `$${(cap / 1e12).toFixed(1)}T`;
  if (cap >= 1e9)  return `$${(cap / 1e9).toFixed(1)}B`;
  if (cap >= 1e6)  return `$${(cap / 1e6).toFixed(0)}M`;
  return `$${cap.toFixed(0)}`;
}


// ─── Correlation ──────────────────────────────────────────────────────────────

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const mb = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const ea = a[i] - ma, eb = b[i] - mb;
    num += ea * eb; da += ea * ea; db += eb * eb;
  }
  const denom = Math.sqrt(da * db);
  return denom > 0 ? num / denom : 0;
}

// ─── Chart color palette (multi-stock overlay) ──────────────────────────────

const CHART_PALETTE = [
  { line: "rgba(96, 165, 250, 1)",  fill: "rgba(96, 165, 250, 0.06)"  }, // blue
  { line: "rgba(74, 222, 128, 1)",  fill: "rgba(74, 222, 128, 0.06)"  }, // green
  { line: "rgba(251, 191, 36, 1)",  fill: "rgba(251, 191, 36, 0.05)"  }, // amber
  { line: "rgba(167, 139, 250, 1)", fill: "rgba(167, 139, 250, 0.06)" }, // purple
  { line: "rgba(249, 115, 22, 1)",  fill: "rgba(249, 115, 22, 0.05)"  }, // orange
  { line: "rgba(236, 72, 153, 1)",  fill: "rgba(236, 72, 153, 0.05)"  }, // pink
  { line: "rgba(20, 184, 166, 1)",  fill: "rgba(20, 184, 166, 0.05)"  }, // teal
  { line: "rgba(239, 68, 68, 1)",   fill: "rgba(239, 68, 68, 0.05)"   }, // red
];

// ─── Metric tooltips ─────────────────────────────────────────────────────────

const METRIC_TIPS: Record<string, string> = {
  volatility: "Annualized Volatility — std dev of session returns × √(annual sessions). Higher = wider, more frequent swings.",
  streak:     "Momentum Streak — consecutive sessions in the same direction. ▲5 = 5 straight up days. Stocks are sorted by this by default.",
  change:     "Period Change — total gain/loss since the start of the selected timeframe. Toggle % / $ using the header button.",
  corr:       "Pearson Correlation (−1 to 1). Values near 1 mean stocks move together; near −1 they diverge; near 0 they're independent.",
};

// ─── Component ───────────────────────────────────────────────────────────────

export class MomentumWatchlistPanel extends HTMLElement {
  private shadow: ShadowRoot;
  private watchlist: WatchlistEntry[]     = [];
  private timeframe: Timeframe            = "1M";
  private showPercent                     = true;
  private chartTickers: Set<string>       = new Set();
  private chart: Chart | null             = null;
  private sortMode: SortMode              = "momentum";
  private showCorrelation                 = false;
  private detailInfo: { ticker: string; barIdx: number; data: BarInfo } | null = null;
  private searchQuery                     = "";
  private addingTicker: string | null     = null;
  private metricsCache: Map<string, StockMetrics> = new Map();
  // Real-data state
  private rawPriceCache: Map<string, PricePoint[]>   = new Map(); // full history per ticker
  private allTickers: TickerSuggestion[]              = [];        // from fetchScreenData (same as SearchCombobox)
  private tickersLoaded                               = false;
  private isLoadingPrices                             = false;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.loadWatchlist();
    this.refreshCache();              // initial render uses seeded fallback
    this.render();
    requestAnimationFrame(() => this.setupChart());
    // Kick off real-data loading in background (same pattern as SearchCombobox)
    this.loadTickers();
    this.fetchAllPrices();
  }

  disconnectedCallback() {
    this.chart?.destroy();
    this.chart = null;
  }

  // ─── State management ──────────────────────────────────────────────────────

  private loadWatchlist() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      this.watchlist = saved ? JSON.parse(saved) : [...DEFAULT_WATCHLIST];
    } catch {
      this.watchlist = [...DEFAULT_WATCHLIST];
    }
    if (this.watchlist.length > 0 && this.chartTickers.size === 0) {
      this.chartTickers.add(this.watchlist[0].ticker);
    }
  }

  private saveWatchlist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.watchlist));
  }

  // ─── Real-data loading (mirrors SearchCombobox) ───────────────────────────────────

  private async loadTickers() {
    if (this.tickersLoaded) return;
    try {
      const result = await fetchScreenData({
        columns: ["ticker", "price", "pe_ratio", "market_cap"],
        limit: 500,
      });
      this.allTickers    = result.rows as TickerSuggestion[];
      this.tickersLoaded = true;
      this.render(); // refresh suggestions
    } catch { /* non-fatal */ }
  }

  private async fetchAllPrices() {
    if (this.isLoadingPrices) return;
    this.isLoadingPrices = true;
    const needed = [...new Set([...this.watchlist.map(w => w.ticker), "SPY"])];
    await Promise.all(needed.map(t => this.fetchPriceForTicker(t)));
    this.isLoadingPrices = false;
    this.refreshCache();
    this.render();
    requestAnimationFrame(() => this.setupChart());
  }

  private async fetchPriceForTicker(ticker: string) {
    if (this.rawPriceCache.has(ticker)) return;
    try {
      const data = await fetchPriceHistory(ticker);
      if (data.length >= 2) this.rawPriceCache.set(ticker, data);
    } catch { /* keep simulation fallback */ }
  }

  // ─── Metrics from real data only ───────────────────────────────────────────

  private computeMetrics(ticker: string): StockMetrics | null {
    const raw = this.rawPriceCache.get(ticker);
    if (raw && raw.length >= 2) return computeMetricsFromPrices(raw, this.timeframe);
    return null;
  }

  private refreshCache() {
    this.metricsCache.clear();
    for (const e of this.watchlist) {
      const m = this.computeMetrics(e.ticker);
      if (m) this.metricsCache.set(e.ticker, m);
    }
    const spy = this.computeMetrics("SPY");
    if (spy) this.metricsCache.set("SPY", spy);
  }

  private addTicker(ticker: string, reason: string) {
    ticker = ticker.toUpperCase().trim().replace(/[^A-Z.]/g, "");
    if (!ticker || this.watchlist.some(w => w.ticker === ticker)) return;
    this.watchlist.push({ ticker, reason: reason.trim() || "No reason added", addedAt: Date.now() });
    if (this.chartTickers.size === 0) this.chartTickers.add(ticker);
    this.saveWatchlist();
    this.addingTicker = null;
    this.searchQuery  = "";
    this.refreshCache();
    this.render();
    requestAnimationFrame(() => this.setupChart());
    // Fetch real price data for the new ticker in background
    this.fetchPriceForTicker(ticker).then(() => {
      this.refreshCache();
      this.render();
      requestAnimationFrame(() => this.setupChart());
    });
  }

  private removeTicker(ticker: string) {
    this.watchlist = this.watchlist.filter(w => w.ticker !== ticker);
    this.chartTickers.delete(ticker);
    this.rawPriceCache.delete(ticker); // release memory
    if (this.chartTickers.size === 0 && this.watchlist.length > 0) {
      this.chartTickers.add(this.watchlist[0].ticker);
    }
    this.saveWatchlist();
    this.refreshCache();
    this.render();
    requestAnimationFrame(() => this.setupChart());
  }

  private sortedWatchlist(): WatchlistEntry[] {
    return [...this.watchlist].sort((a, b) => {
      const ma = this.metricsCache.get(a.ticker);
      const mb = this.metricsCache.get(b.ticker);
      // Tickers with no data sink to the bottom
      if (!ma && !mb) return a.ticker.localeCompare(b.ticker);
      if (!ma) return 1;
      if (!mb) return -1;
      switch (this.sortMode) {
        case "momentum": {
          const sa = ma.streakDir === "up" ?  ma.streak : -ma.streak;
          const sb = mb.streakDir === "up" ?  mb.streak : -mb.streak;
          return sb - sa;
        }
        case "change":     return mb.changePercent - ma.changePercent;
        case "volatility": return mb.volatility    - ma.volatility;
        case "alpha":      return a.ticker.localeCompare(b.ticker);
      }
    });
  }

  // ─── Chart.js ──────────────────────────────────────────────────────────────

  /** Format a YYYY-MM-DD date string for the chart x-axis based on timeframe. */
  private fmtDateLabel(dateStr: string): string {
    // Use noon to avoid timezone day-shift issues
    const d = new Date(`${dateStr}T12:00:00`);
    if (this.timeframe === "1Y" || this.timeframe === "YTD") {
      return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    }
    if (this.timeframe === "1W") {
      return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    }
    // 1D, 1M, 3M
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  private setupChart() {
    const canvas = this.shadow.getElementById("main-chart") as HTMLCanvasElement | null;
    if (!canvas) return;

    this.chart?.destroy();
    this.chart = null;

    // Derive x-axis labels from real price data — use SPY as reference calendar,
    // fall back to the first available selected ticker.
    const refRaw =
      this.rawPriceCache.get("SPY") ??
      [...this.chartTickers, ...this.watchlist.map(w => w.ticker)]
        .map(t => this.rawPriceCache.get(t))
        .find(Boolean);

    if (!refRaw || refRaw.length < 2) {
      // No real data at all — show placeholder
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#475569";
        ctx.font      = "13px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(
          "No price data — run POST /ingest/yfinance on the backend",
          canvas.width / 2, canvas.height / 2
        );
      }
      return;
    }

    const refFiltered = filterByTimeframe(refRaw, this.timeframe);
    const labels      = refFiltered.map(p => this.fmtDateLabel(p.date));

    const datasets: any[] = [];

    // S&P 500 baseline
    const spy = this.metricsCache.get("SPY");
    if (spy) {
      datasets.push({
        label: "S&P 500",
        data: spy.prices.map(p => +(p - 100).toFixed(3)),
        borderColor: "rgba(148, 163, 184, 0.45)",
        backgroundColor: "transparent",
        borderWidth: 1.5,
        borderDash: [5, 4],
        pointRadius: 0,
        tension: 0.3,
        order: 1,
      });
    }

    // Selected tickers with palette colors
    Array.from(this.chartTickers).forEach((ticker, idx) => {
      const m = this.metricsCache.get(ticker);
      if (!m) return;
      const { line, fill } = CHART_PALETTE[idx % CHART_PALETTE.length];
      datasets.push({
        label: ticker,
        data: m.prices.map(p => +(p - 100).toFixed(3)),
        borderColor: line,
        backgroundColor: fill,
        borderWidth: 2,
        pointRadius: 0,
        fill: idx === 0,
        tension: 0.3,
        order: 0,
      });
    });

    if (datasets.length === 0) return; // nothing to draw

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    this.chart = new Chart(ctx, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        animation: { duration: 300 },
        plugins: {
          legend: {
            display: true,
            labels: { color: "#94a3b8", font: { size: 11 }, boxWidth: 18, padding: 14 },
          },
          tooltip: {
            backgroundColor: "rgba(15, 23, 42, 0.96)",
            titleColor: "#e2e8f0",
            bodyColor: "#94a3b8",
            borderColor: "rgba(148, 163, 184, 0.3)",
            borderWidth: 1,
            callbacks: {
              label: (ctx) => {
                const v = ctx.parsed.y ?? 0;
                return `${ctx.dataset.label}: ${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
              },
            },
          },
        },
        scales: {
          x: {
            grid:  { color: "rgba(148, 163, 184, 0.05)" },
            ticks: { color: "#64748b", font: { size: 9 }, maxTicksLimit: 8, maxRotation: 0 },
          },
          y: {
            grid:  { color: "rgba(148, 163, 184, 0.08)" },
            ticks: {
              color: "#64748b",
              font: { size: 9 },
              callback: (v) => { const n = Number(v ?? 0); return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`; },
            },
          },
        },
      },
    });
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  private render() {
    const sorted  = this.sortedWatchlist();
    const tickers = this.watchlist.map(w => w.ticker);

    // Correlation matrix
    const corrMatrix: number[][] = tickers.map((ta, i) =>
      tickers.map((tb, j) => {
        if (i === j) return 1;
        const ma = this.metricsCache.get(ta);
        const mb = this.metricsCache.get(tb);
        return ma && mb ? pearson(ma.returns, mb.returns) : 0;
      })
    );

    // Autocomplete suggestions — from DB via fetchScreenData (same source as SearchCombobox)
    const q    = this.searchQuery.toUpperCase();
    const sugs: TickerSuggestion[] = q.length >= 1
      ? this.allTickers
          .filter(r =>
            (r.ticker.startsWith(q) || r.ticker.includes(q)) &&
            !this.watchlist.some(w => w.ticker === r.ticker)
          )
          .slice(0, 8)
      : [];

    this.shadow.innerHTML = [
      this.buildStyles(),
      `<div class="wl-panel">`,
      this.renderHeader(),
      this.renderChart(),
      this.renderSearch(sugs),
      this.addingTicker ? this.renderAddForm() : "",
      this.renderTable(sorted),
      this.showCorrelation ? this.renderCorrelation(tickers, corrMatrix) : "",
      this.renderFooter(),
      `<div class="wl-metric-tip" id="wl-metric-tip"></div>`,
      `</div>`,
    ].join("\n");

    this.bindEvents();
    requestAnimationFrame(() => this.setupChart());
  }

  // ─── HTML sections ────────────────────────────────────────────────────────

  private renderHeader(): string {
    const TFS: Timeframe[] = ["1D", "1W", "1M", "3M", "1Y", "YTD"];
    return `
      <div class="wl-header">
        <div class="wl-title-row">
          <span class="wl-icon">📈</span>
          <span class="wl-title">Momentum Watchlist</span>
        <span class="wl-data-badge ${this.isLoadingPrices ? "loading" : this.rawPriceCache.size > 0 ? "live" : "nodata"}">
          ${this.isLoadingPrices ? "↻ LOADING" : this.rawPriceCache.size > 0 ? "● LIVE" : "◦ NO DATA"}
        </span>
        </div>
        <div class="wl-controls-row">
          <div class="wl-tf-group">
            ${TFS.map(tf => `
              <button class="wl-tf-btn${this.timeframe === tf ? " active" : ""}" data-tf="${tf}">${tf}</button>
            `).join("")}
          </div>
          <div class="wl-right-group">
            <button class="wl-mode-btn${this.showPercent ? " pct" : " dol"}" id="btn-mode">${this.showPercent ? "%" : "$"}</button>
            <button class="wl-corr-btn${this.showCorrelation ? " active" : ""}" id="btn-corr">Correlation</button>
          </div>
        </div>
      </div>`;
  }

  private renderChart(): string {
    const selected = Array.from(this.chartTickers);
    const chips    = selected.map((ticker, idx) => {
      const m = this.metricsCache.get(ticker);
      const { line } = CHART_PALETTE[idx % CHART_PALETTE.length];
      if (!m) {
        return `
          <span class="wl-chart-chip no-data-chip" style="border-color:${line}">
            <span class="wl-chip-dot" style="background:${line}"></span>
            <span class="wl-chip-ticker">${ticker}</span>
            <span class="wl-chip-pct" style="color:#475569">no data</span>
          </span>`;
      }
      const pct      = m.changePercent;
      const sign     = pct >= 0 ? "+" : "";
      const pctColor = pct >= 0 ? "#4ade80" : "#f87171";
      const dolSign  = m.changeDollar >= 0 ? "+$" : "-$";
      return `
        <span class="wl-chart-chip" style="border-color:${line}">
          <span class="wl-chip-dot" style="background:${line}"></span>
          <span class="wl-chip-ticker">${ticker}</span>
          <span class="wl-chip-pct" style="color:${pctColor}">${sign}${pct.toFixed(2)}%</span>
          <span class="wl-chip-dol" style="color:${pctColor}">(${dolSign}${Math.abs(m.changeDollar).toFixed(2)})</span>
        </span>`;
    }).join("");

    return `
      <div class="wl-chart-section">
        <div class="wl-chart-info">
          ${selected.length === 0
            ? `<span class="wl-chart-hint">Click 📈 on any row to plot it</span>`
            : chips
          }
          <span class="wl-chart-period-badge">${this.timeframe}</span>
          <span class="wl-vs">vs S&amp;P 500</span>
        </div>
        <div class="wl-chart-wrap">
          <canvas id="main-chart"></canvas>
        </div>
      </div>`;
  }

  private renderSearch(suggestions: TickerSuggestion[]): string {
    const SORTS: { id: SortMode; label: string }[] = [
      { id: "momentum",  label: "🔥 Streak"    },
      { id: "change",    label: "% Change"      },
      { id: "volatility",label: "⚡ Volatility" },
      { id: "alpha",     label: "A–Z"           },
    ];
    return `
      <div class="wl-search-section">
        <div class="wl-search-wrap">
          <input
            id="search-input"
            class="wl-search-input"
            type="text"
            placeholder="Search ticker to add (AMD, SOFI, COIN…)"
            value="${this.searchQuery}"
            autocomplete="off"
            spellcheck="false"
          />
          ${suggestions.length || (this.searchQuery.length >= 1 && !this.tickersLoaded) ? `
            <div class="wl-suggestions">
              ${!this.tickersLoaded && this.searchQuery.length >= 1
                ? `<div class="wl-sug-info">Loading tickers from database…</div>`
                : suggestions.map(r => `
                    <div class="wl-sug" data-ticker="${r.ticker}">
                      <span class="sug-tick">${r.ticker}</span>
                      <span class="sug-meta">
                        ${r.price     ? `<span class="sug-price">$${r.price.toFixed(2)}</span>` : ""}
                        ${r.pe_ratio  ? `<span class="sug-pe">${r.pe_ratio.toFixed(1)}x&nbsp;P/E</span>` : ""}
                        ${r.market_cap ? `<span class="sug-cap">${fmtCap(r.market_cap)}</span>` : ""}
                      </span>
                    </div>`).join("")}
              ${this.tickersLoaded && suggestions.length === 0
                ? `<div class="wl-sug-info">No match — press Enter to add anyway</div>`
                : ""}
            </div>` : ""}
        </div>
        <div class="wl-sort-row">
          <span class="wl-sort-label">Sort:</span>
          ${SORTS.map(s => `
            <button class="wl-sort-chip${this.sortMode === s.id ? " active" : ""}" data-sort="${s.id}">${s.label}</button>
          `).join("")}
        </div>
      </div>`;
  }

  private renderAddForm(): string {
    return `
      <div class="wl-add-form">
        <span class="wl-add-ticker-label">${this.addingTicker}</span>
        <input id="reason-input" class="wl-reason-input" type="text"
          placeholder="Thesis / reason (e.g. microcap &lt;10× P/E, turnaround)"
          autocomplete="off" />
        <button class="wl-btn-confirm" id="btn-add-confirm">Add</button>
        <button class="wl-btn-cancel"  id="btn-add-cancel">Cancel</button>
      </div>`;
  }

  private renderTable(sorted: WatchlistEntry[]): string {
    if (sorted.length === 0) return `
      <div class="wl-empty">
        <div>No stocks in watchlist.</div>
        <div class="wl-empty-sub">Search for a ticker above and press Enter to add.</div>
      </div>`;

    return `
      <div class="wl-table">
        <div class="wl-table-hdr">
          <span>Ticker</span>
          <span>Thesis</span>
          <span class="num">${this.showPercent ? "% Chg" : "$ Chg"}</span>
          <span class="num" data-metric="volatility" title="${METRIC_TIPS.volatility}">Vol ⓘ</span>
          <span class="num" data-metric="streak"     title="${METRIC_TIPS.streak}">Streak ⓘ</span>
          <span>Momentum ribbon (${this.timeframe})</span>
          <span></span>
        </div>
        ${sorted.map(e => this.renderRow(e)).join("")}
      </div>`;
  }

  private renderRow(entry: WatchlistEntry): string {
    const m = this.metricsCache.get(entry.ticker);

    // No real data yet — show a clear no-data state
    if (!m) {
      return `
        <div class="wl-row wl-row-nodata" data-ticker="${entry.ticker}">
          <div class="wl-row-main">
            <span class="wl-tick ticker-link" data-ticker="${entry.ticker}">${entry.ticker}</span>
            <span class="wl-reason" title="${entry.reason}">${entry.reason.length > 22 ? entry.reason.slice(0, 20) + "…" : entry.reason}</span>
            <span class="wl-chg num" style="color:#475569">—</span>
            <span class="wl-vol num" style="color:#475569">—</span>
            <span class="wl-streak num" style="color:#475569">—</span>
            <span class="wl-no-data-msg">${this.isLoadingPrices ? "↻ fetching…" : "No price data — run POST /ingest/yfinance"}</span>
            <div class="wl-row-actions">
              <button class="wl-btn-remove" data-ticker="${entry.ticker}" title="Remove">×</button>
            </div>
          </div>
        </div>`;
    }

    const isActive  = this.chartTickers.has(entry.ticker);
    const colorIdx  = Array.from(this.chartTickers).indexOf(entry.ticker);
    const dotColor  = isActive ? CHART_PALETTE[colorIdx % CHART_PALETTE.length].line : "";
    const pct      = m.changePercent;
    const change   = this.showPercent
      ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`
      : `${m.changeDollar >= 0 ? "+$" : "-$"}${Math.abs(m.changeDollar).toFixed(2)}`;
    const chgCls   = pct >= 0 ? "pos" : "neg";
    const strColor = m.streakDir === "up" ? "#4ade80" : "#f87171";
    const strLabel = `${m.streakDir === "up" ? "▲" : "▼"}${m.streak}`;

    const ribbonBars = m.ribbonBars.map((bar, i) => {
      const pct    = bar.ret * 100;
      const barH   = Math.min(Math.max(Math.abs(pct) * 12, 2), 28);
      const isUp   = bar.ret >= 0;
      const color  = isUp ? "rgba(74,222,128,0.85)" : "rgba(248,113,113,0.85)";
      const sign   = isUp ? "+" : "";
      const title  = `${bar.label}: ${sign}${pct.toFixed(2)}% | Close $${bar.close.toFixed(2)}`;
      return `
        <div class="rb-wrap" data-ticker="${entry.ticker}" data-bar="${i}" title="${title}">
          <div class="rb-bar" style="height:${barH}px;background:${color};"></div>
        </div>`;
    }).join("");

    // Bar detail panel (shown if this row's bar is clicked)
    const detailHtml = (this.detailInfo?.ticker === entry.ticker)
      ? this.renderBarDetail(m)
      : "";

    return `
      <div class="wl-row${isActive ? " wl-row-active" : ""}" data-ticker="${entry.ticker}">
        <div class="wl-row-main">
          <span class="wl-tick ticker-link" data-ticker="${entry.ticker}">${entry.ticker}</span>
          <span class="wl-reason" title="${entry.reason}">${entry.reason.length > 22 ? entry.reason.slice(0, 20) + "…" : entry.reason}</span>
          <span class="wl-chg ${chgCls} num" data-metric="change">${change}</span>
          <span class="wl-vol num" data-metric="volatility">${m.volatility.toFixed(1)}%</span>
          <span class="wl-streak num" style="color:${strColor}" data-metric="streak">${strLabel}</span>
          <div class="wl-ribbon-wrap">
            <div class="wl-ribbon">${ribbonBars}</div>
          </div>
          <div class="wl-row-actions">
            <button class="wl-btn-chart${isActive ? " on" : ""}" data-ticker="${entry.ticker}"
              title="${isActive ? "Remove from chart" : "Add to chart"}"
              style="${isActive ? `border-color:${dotColor};background:${dotColor.replace("1)", "0.12)")}` : ""}">
              ${isActive
                ? `<span class="chart-dot" style="background:${dotColor}"></span>`
                : "📈"}
            </button>
            <button class="wl-btn-remove" data-ticker="${entry.ticker}" title="Remove">×</button>
          </div>
        </div>
        ${detailHtml}
      </div>`;
  }

  private renderBarDetail(m: StockMetrics): string {
    if (!this.detailInfo) return "";
    const bar    = this.detailInfo.data;
    const pct    = bar.ret * 100;
    const cumPct = bar.cumRet * 100;
    const up     = bar.ret >= 0;
    const color  = up ? "#4ade80" : "#f87171";
    return `
      <div class="wl-bar-detail">
        <span class="bd-date">${bar.label}</span>
        <span class="bd-outcome" style="color:${color}">${up ? "▲" : "▼"} ${Math.abs(pct).toFixed(2)}%</span>
        <span class="bd-close">Close: $${bar.close.toFixed(2)}</span>
        <span class="bd-cum" style="color:${color}">Cumulative: ${cumPct >= 0 ? "+" : ""}${cumPct.toFixed(2)}%</span>
        <button class="bd-close-btn" id="btn-close-detail">✕</button>
      </div>`;
  }

  private renderCorrelation(tickers: string[], matrix: number[][]): string {
    if (tickers.length < 2) return `
      <div class="wl-corr-section">
        <div class="wl-corr-title">📊 Correlation Matrix</div>
        <div class="wl-corr-note">Add 2 or more stocks to see correlation.</div>
      </div>`;

    const cellColor = (c: number, diag: boolean): string => {
      if (diag)   return "rgba(30,41,59,0.3)";
      if (c >  0.7) return "rgba(239,68,68,0.35)";
      if (c >  0.3) return "rgba(251,191,36,0.2)";
      if (c > -0.2) return "rgba(148,163,184,0.12)";
      return "rgba(74,222,128,0.2)";
    };

    return `
      <div class="wl-corr-section">
        <div class="wl-corr-title">
          📊 Correlation Matrix
          <span class="wl-corr-legend">
            <span style="color:#f87171">■</span> High (&gt;0.7) &nbsp;
            <span style="color:#fbbf24">■</span> Moderate &nbsp;
            <span style="color:#94a3b8">■</span> Low &nbsp;
            <span style="color:#4ade80">■</span> Negative
          </span>
        </div>
        <div class="wl-corr-grid" style="grid-template-columns: 52px ${tickers.map(() => "52px").join(" ")}">
          <div class="cc ch"></div>
          ${tickers.map(t => `<div class="cc ch">${t}</div>`).join("")}
          ${tickers.map((ta, i) => `
            <div class="cc ch">${ta}</div>
            ${tickers.map((_, j) => {
              const c    = matrix[i][j];
              const diag = i === j;
              return `<div class="cc" style="background:${cellColor(c, diag)}"
                data-metric="corr" title="${ta} vs ${tickers[j]}: ${c.toFixed(2)}">${diag ? "—" : c.toFixed(2)}</div>`;
            }).join("")}
          `).join("")}
        </div>
        <div class="wl-corr-subtext">
          High correlation (red) = stocks that drop together. Consider diversifying across low-corr positions.
        </div>
      </div>`;
  }

  private renderFooter(): string {
    return `
      <div class="wl-footer">
        <view-explainer view-type="watchlist-momentum"></view-explainer>
        <view-insights config='{"viewType": "screener", "limit": 20}'></view-insights>
      </div>`;
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  private bindEvents() {
    // Timeframe
    this.shadow.querySelectorAll<HTMLButtonElement>(".wl-tf-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        this.timeframe   = btn.dataset.tf as Timeframe;
        this.detailInfo  = null;
        this.refreshCache();
        this.render();
      });
    });

    // % / $ toggle
    this.shadow.getElementById("btn-mode")?.addEventListener("click", () => {
      this.showPercent = !this.showPercent;
      this.render();
    });

    // Correlation toggle
    this.shadow.getElementById("btn-corr")?.addEventListener("click", () => {
      this.showCorrelation = !this.showCorrelation;
      this.render();
    });

    // Sort chips
    this.shadow.querySelectorAll<HTMLButtonElement>(".wl-sort-chip").forEach(c => {
      c.addEventListener("click", () => {
        this.sortMode = c.dataset.sort as SortMode;
        this.render();
      });
    });

    // Search input
    const si = this.shadow.getElementById("search-input") as HTMLInputElement | null;
    si?.addEventListener("input", () => {
      this.searchQuery = si.value;
      this.render();
    });
    si?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && this.searchQuery.trim()) {
        this.addingTicker = this.searchQuery.trim().toUpperCase();
        this.render();
        requestAnimationFrame(() =>
          (this.shadow.getElementById("reason-input") as HTMLInputElement | null)?.focus()
        );
      }
      if (e.key === "Escape") { this.searchQuery = ""; this.render(); }
    });

    // Autocomplete suggestions
    this.shadow.querySelectorAll<HTMLElement>(".wl-sug").forEach(s => {
      s.addEventListener("click", () => {
        this.addingTicker = s.dataset.ticker!;
        this.searchQuery  = "";
        this.render();
        requestAnimationFrame(() =>
          (this.shadow.getElementById("reason-input") as HTMLInputElement | null)?.focus()
        );
      });
    });

    // Add form
    const confirmAdd = () => {
      const ri = this.shadow.getElementById("reason-input") as HTMLInputElement | null;
      if (this.addingTicker) this.addTicker(this.addingTicker, ri?.value || "");
    };
    this.shadow.getElementById("btn-add-confirm")?.addEventListener("click", confirmAdd);
    this.shadow.getElementById("btn-add-cancel")?.addEventListener("click", () => {
      this.addingTicker = null; this.render();
    });
    (this.shadow.getElementById("reason-input") as HTMLInputElement | null)
      ?.addEventListener("keydown", (e) => {
        if (e.key === "Enter")  confirmAdd();
        if (e.key === "Escape") { this.addingTicker = null; this.render(); }
      });

    // Plot in chart button — toggle membership in chartTickers
    this.shadow.querySelectorAll<HTMLButtonElement>(".wl-btn-chart").forEach(btn => {
      btn.addEventListener("click", () => {
        const ticker = btn.dataset.ticker!;
        if (this.chartTickers.has(ticker)) {
          this.chartTickers.delete(ticker);
        } else {
          this.chartTickers.add(ticker);
        }
        this.render();
      });
    });

    // Remove button
    this.shadow.querySelectorAll<HTMLButtonElement>(".wl-btn-remove").forEach(btn => {
      btn.addEventListener("click", () => this.removeTicker(btn.dataset.ticker!));
    });

    // Ribbon bar click → bar detail panel
    this.shadow.querySelectorAll<HTMLElement>(".rb-wrap").forEach(bar => {
      bar.addEventListener("click", () => {
        const ticker = bar.dataset.ticker!;
        const barIdx = parseInt(bar.dataset.bar!);
        const m      = this.metricsCache.get(ticker);
        if (!m) return;
        const data   = m.ribbonBars[barIdx];
        if (this.detailInfo?.ticker === ticker && this.detailInfo?.barIdx === barIdx) {
          this.detailInfo = null;
        } else {
          this.detailInfo = { ticker, barIdx, data };
        }
        this.render();
      });
    });

    // Close bar detail
    this.shadow.getElementById("btn-close-detail")?.addEventListener("click", () => {
      this.detailInfo = null;
      this.render();
    });

    // Ticker navigation
    this.shadow.querySelectorAll<HTMLElement>(".ticker-link, .wl-tick").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const t = el.dataset.ticker;
        if (t) this.dispatchEvent(new CustomEvent("navigate-stock", {
          detail: { ticker: t }, bubbles: true, composed: true,
        }));
      });
    });

    // Metric tooltips
    const tip = this.shadow.getElementById("wl-metric-tip")!;
    if (tip) {
      this.shadow.querySelectorAll<HTMLElement>("[data-metric]").forEach(el => {
        const key  = el.dataset.metric!;
        const text = METRIC_TIPS[key] || key;
        el.addEventListener("mouseenter", (e) => {
          tip.textContent = text;
          tip.classList.add("visible");
          const r         = (e.target as HTMLElement).getBoundingClientRect();
          tip.style.left  = `${r.left}px`;
          tip.style.top   = `${r.bottom + 4}px`;
        });
        el.addEventListener("mouseleave", () => tip.classList.remove("visible"));
      });
    }
  }

  // ─── Styles ───────────────────────────────────────────────────────────────

  private buildStyles(): string {
    return `<style>
      :host { display: block; font-family: system-ui, -apple-system, sans-serif; color: #e2e8f0; }

      /* Panel wrapper */
      .wl-panel { background: rgba(15,23,42,0.97); border-radius: 12px; border: 1px solid rgba(148,163,184,0.2); overflow: hidden; }

      /* ── Header ── */
      .wl-header { padding: 0.7rem 1rem; border-bottom: 1px solid rgba(148,163,184,0.15); display: flex; flex-direction: column; gap: 0.45rem; }
      .wl-title-row { display: flex; align-items: center; gap: 0.5rem; }
      .wl-icon { font-size: 1.1rem; }
      .wl-title { font-size: 1rem; font-weight: 700; color: #f1f5f9; }
      .wl-data-badge { font-size: 0.58rem; padding: 0.1rem 0.4rem; border-radius: 3px; letter-spacing: 0.03em; border: 1px solid; }
      .wl-data-badge.live    { background: rgba(74,222,128,0.12); color: #4ade80; border-color: rgba(74,222,128,0.35); }
      .wl-data-badge.loading { background: rgba(251,191,36,0.12); color: #fbbf24; border-color: rgba(251,191,36,0.35); }
      .wl-data-badge.nodata  { background: rgba(239,68,68,0.1);   color: #f87171; border-color: rgba(239,68,68,0.25); }
      .wl-row-nodata { opacity: 0.7; }
      .wl-no-data-msg { font-size: 0.68rem; color: #475569; font-style: italic; }
      .wl-controls-row { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.4rem; }
      .wl-tf-group { display: flex; gap: 0.2rem; }
      .wl-tf-btn { padding: 0.28rem 0.55rem; font-size: 0.73rem; border-radius: 4px; background: transparent; border: 1px solid transparent; color: #64748b; cursor: pointer; transition: all 0.15s; }
      .wl-tf-btn:hover { color: #94a3b8; border-color: rgba(148,163,184,0.3); }
      .wl-tf-btn.active { background: rgba(59,130,246,0.15); border-color: rgba(59,130,246,0.45); color: #60a5fa; font-weight: 600; }
      .wl-right-group { display: flex; gap: 0.35rem; align-items: center; }
      .wl-mode-btn { padding: 0.28rem 0.65rem; font-size: 0.8rem; font-weight: 700; border-radius: 4px; cursor: pointer; transition: all 0.15s; }
      .wl-mode-btn.pct { background: rgba(74,222,128,0.12); border: 1px solid rgba(74,222,128,0.4); color: #4ade80; }
      .wl-mode-btn.dol { background: rgba(59,130,246,0.12); border: 1px solid rgba(59,130,246,0.4); color: #60a5fa; }
      .wl-corr-btn { padding: 0.28rem 0.6rem; font-size: 0.73rem; border-radius: 4px; background: rgba(30,41,59,0.6); border: 1px solid rgba(148,163,184,0.2); color: #94a3b8; cursor: pointer; transition: all 0.15s; }
      .wl-corr-btn:hover { border-color: rgba(148,163,184,0.4); color: #e2e8f0; }
      .wl-corr-btn.active { background: rgba(139,92,246,0.15); border-color: rgba(139,92,246,0.4); color: #a78bfa; }

      /* ── Chart ── */
      .wl-chart-section { padding: 0.75rem 1rem; border-bottom: 1px solid rgba(148,163,184,0.1); }
      .wl-chart-info { display: flex; align-items: baseline; gap: 0.6rem; margin-bottom: 0.5rem; flex-wrap: wrap; }
      .wl-chart-hint { font-size: 0.78rem; color: #475569; font-style: italic; }
      .wl-chart-chip { display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.15rem 0.5rem 0.15rem 0.35rem; border-radius: 5px; border: 1px solid; background: rgba(30,41,59,0.5); font-size: 0.75rem; }
      .wl-chip-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
      .wl-chip-ticker { font-weight: 700; color: #f1f5f9; font-family: ui-monospace, monospace; font-size: 0.8rem; }
      .wl-chip-pct { font-weight: 600; }
      .wl-chip-dol { font-size: 0.68rem; opacity: 0.8; }
      .wl-chart-period-badge { font-size: 0.68rem; color: #64748b; background: rgba(30,41,59,0.5); padding: 0.1rem 0.35rem; border-radius: 3px; }
      .wl-vs { font-size: 0.68rem; color: #475569; }
      .wl-chart-wrap { position: relative; height: 220px; }
      .chart-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; vertical-align: middle; }

      /* ── Search ── */
      .wl-search-section { padding: 0.6rem 1rem; border-bottom: 1px solid rgba(148,163,184,0.1); display: flex; flex-direction: column; gap: 0.45rem; }
      .wl-search-wrap { position: relative; }
      .wl-search-input { width: 100%; padding: 0.48rem 0.75rem; border: 1px solid rgba(148,163,184,0.25); border-radius: 6px; background: rgba(30,41,59,0.6); color: #e2e8f0; font-size: 0.83rem; box-sizing: border-box; }
      .wl-search-input:focus { outline: none; border-color: rgba(59,130,246,0.5); }
      .wl-suggestions { position: absolute; top: calc(100% + 2px); left: 0; right: 0; z-index: 200; background: rgba(15,23,42,0.98); border: 1px solid rgba(148,163,184,0.25); border-radius: 6px; overflow: hidden; }
      .wl-sug { display: flex; align-items: center; justify-content: space-between; padding: 0.42rem 0.75rem; font-size: 0.78rem; cursor: pointer; gap: 0.5rem; }
      .wl-sug:hover { background: rgba(59,130,246,0.1); }
      .sug-tick  { font-family: ui-monospace, monospace; font-weight: 700; color: #e2e8f0; letter-spacing: 0.02em; }
      .sug-meta  { display: flex; gap: 0.5rem; align-items: center; flex-shrink: 0; }
      .sug-price { font-family: ui-monospace, monospace; color: #94a3b8; font-size: 0.73rem; }
      .sug-pe    { color: #64748b; font-size: 0.68rem; }
      .sug-cap   { color: #64748b; font-size: 0.68rem; }
      .wl-sug-info { padding: 0.4rem 0.75rem; font-size: 0.72rem; color: #475569; font-style: italic; }
      .wl-sort-row { display: flex; align-items: center; gap: 0.3rem; flex-wrap: wrap; }
      .wl-sort-label { font-size: 0.68rem; color: #64748b; }
      .wl-sort-chip { padding: 0.22rem 0.5rem; font-size: 0.7rem; border-radius: 4px; background: transparent; border: 1px solid rgba(148,163,184,0.18); color: #64748b; cursor: pointer; transition: all 0.15s; }
      .wl-sort-chip:hover { border-color: rgba(148,163,184,0.38); color: #94a3b8; }
      .wl-sort-chip.active { background: rgba(59,130,246,0.14); border-color: rgba(59,130,246,0.4); color: #60a5fa; }

      /* ── Add form ── */
      .wl-add-form { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem; background: rgba(30,41,59,0.5); border-bottom: 1px solid rgba(148,163,184,0.1); flex-wrap: wrap; }
      .wl-add-ticker-label { font-weight: 700; font-size: 0.95rem; color: #60a5fa; min-width: 40px; }
      .wl-reason-input { flex: 1; padding: 0.4rem 0.6rem; border: 1px solid rgba(148,163,184,0.3); border-radius: 5px; background: rgba(15,23,42,0.6); color: #e2e8f0; font-size: 0.8rem; min-width: 140px; }
      .wl-reason-input:focus { outline: none; border-color: rgba(59,130,246,0.5); }
      .wl-btn-confirm, .wl-btn-cancel { padding: 0.38rem 0.7rem; border-radius: 5px; font-size: 0.73rem; cursor: pointer; }
      .wl-btn-confirm { background: rgba(59,130,246,0.2); border: 1px solid rgba(59,130,246,0.5); color: #93c5fd; }
      .wl-btn-cancel  { background: transparent; border: 1px solid rgba(148,163,184,0.3); color: #64748b; }

      /* ── Table ── */
      .wl-table-hdr { display: grid; grid-template-columns: 62px 1fr 78px 58px 60px minmax(90px,1fr) 62px; gap: 0.4rem; padding: 0.38rem 1rem; font-size: 0.63rem; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid rgba(148,163,184,0.12); }
      .wl-table-hdr .num { text-align: right; }

      .wl-row { border-bottom: 1px solid rgba(148,163,184,0.07); transition: background 0.15s; }
      .wl-row:hover { background: rgba(30,41,59,0.35); }
      .wl-row.wl-row-active { background: rgba(59,130,246,0.04); border-left: 2px solid rgba(59,130,246,0.4); }

      .wl-row-main { display: grid; grid-template-columns: 62px 1fr 78px 58px 60px minmax(90px,1fr) 62px; gap: 0.4rem; align-items: center; padding: 0.52rem 1rem; }

      .wl-tick { font-family: ui-monospace, monospace; font-weight: 700; font-size: 0.82rem; color: #60a5fa; cursor: pointer; padding: 0.12rem 0.28rem; border-radius: 3px; background: rgba(59,130,246,0.08); transition: background 0.15s; white-space: nowrap; display: inline-block; }
      .wl-tick:hover { background: rgba(59,130,246,0.22); }

      .wl-reason { font-size: 0.63rem; color: #64748b; background: rgba(30,41,59,0.55); padding: 0.1rem 0.38rem; border-radius: 3px; border: 1px solid rgba(148,163,184,0.13); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: default; }

      .wl-chg { font-family: ui-monospace, monospace; font-size: 0.8rem; font-weight: 600; text-align: right; }
      .wl-chg.pos { color: #4ade80; }
      .wl-chg.neg { color: #f87171; }

      .wl-vol { font-size: 0.75rem; color: #94a3b8; text-align: right; cursor: help; }
      .wl-streak { font-size: 0.75rem; font-weight: 600; text-align: right; cursor: help; }
      .num { text-align: right; }

      /* Ribbon */
      .wl-ribbon-wrap { overflow-x: auto; scrollbar-width: thin; scrollbar-color: rgba(148,163,184,0.15) transparent; }
      .wl-ribbon { display: flex; gap: 2px; align-items: flex-end; height: 32px; padding-bottom: 1px; width: max-content; }
      .rb-wrap { display: flex; align-items: flex-end; width: 12px; height: 30px; flex-shrink: 0; cursor: pointer; }
      .rb-wrap:hover .rb-bar { filter: brightness(1.3); }
      .rb-bar { width: 100%; min-height: 2px; border-radius: 1px 1px 0 0; }

      /* Row actions */
      .wl-row-actions { display: flex; gap: 0.2rem; justify-content: flex-end; align-items: center; }
      .wl-btn-chart { background: transparent; border: 1px solid transparent; border-radius: 4px; cursor: pointer; font-size: 0.85rem; padding: 0.12rem 0.22rem; color: #64748b; transition: all 0.15s; }
      .wl-btn-chart:hover { border-color: rgba(74,222,128,0.4); background: rgba(74,222,128,0.1); }
      .wl-btn-chart.on { color: #4ade80; border-color: rgba(74,222,128,0.4); background: rgba(74,222,128,0.08); }
      .wl-btn-remove { background: transparent; border: 1px solid transparent; border-radius: 4px; cursor: pointer; font-size: 1rem; color: #64748b; padding: 0.12rem 0.28rem; transition: all 0.15s; line-height: 1; }
      .wl-btn-remove:hover { color: #f87171; border-color: rgba(248,113,113,0.3); background: rgba(248,113,113,0.08); }

      /* Bar detail */
      .wl-bar-detail { display: flex; align-items: center; gap: 0.75rem; padding: 0.38rem 1rem; background: rgba(30,41,59,0.65); border-top: 1px solid rgba(148,163,184,0.1); font-size: 0.73rem; flex-wrap: wrap; }
      .bd-date { color: #94a3b8; font-weight: 600; }
      .bd-outcome { font-weight: 700; }
      .bd-close, .bd-cum { color: #94a3b8; }
      .bd-close-btn { background: transparent; border: none; color: #64748b; cursor: pointer; font-size: 0.85rem; margin-left: auto; padding: 0 0.2rem; }
      .bd-close-btn:hover { color: #e2e8f0; }

      /* Correlation */
      .wl-corr-section { padding: 0.7rem 1rem; border-top: 1px solid rgba(148,163,184,0.1); }
      .wl-corr-title { font-size: 0.8rem; font-weight: 600; color: #94a3b8; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
      .wl-corr-legend { font-size: 0.63rem; color: #64748b; display: flex; gap: 0.5rem; align-items: center; }
      .wl-corr-grid { display: inline-grid; gap: 2px; }
      .cc { width: 50px; height: 30px; display: flex; align-items: center; justify-content: center; font-size: 0.68rem; border-radius: 3px; }
      .cc.ch { font-weight: 600; color: #64748b; background: transparent !important; font-size: 0.62rem; }
      .wl-corr-subtext { font-size: 0.67rem; color: #475569; margin-top: 0.4rem; font-style: italic; }
      .wl-corr-note { color: #64748b; font-size: 0.78rem; }

      /* Empty */
      .wl-empty { padding: 2.5rem 1rem; text-align: center; color: #64748b; font-size: 0.9rem; }
      .wl-empty-sub { font-size: 0.75rem; margin-top: 0.4rem; color: #475569; }

      /* Footer */
      .wl-footer { padding: 0.75rem; border-top: 1px solid rgba(148,163,184,0.1); display: flex; flex-direction: column; gap: 0.5rem; }

      /* Metric tooltip */
      .wl-metric-tip { position: fixed; z-index: 9999; max-width: 280px; padding: 0.55rem 0.75rem; background: rgba(15,23,42,0.98); border: 1px solid rgba(148,163,184,0.3); border-radius: 7px; box-shadow: 0 4px 18px rgba(0,0,0,0.4); font-size: 0.71rem; line-height: 1.5; color: #94a3b8; pointer-events: none; display: none; }
      .wl-metric-tip.visible { display: block; }
    </style>`;
  }
}

customElements.define("watchlist-momentum-panel", MomentumWatchlistPanel);
