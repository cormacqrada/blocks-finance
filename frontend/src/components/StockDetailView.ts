/**
 * StockDetailView - Comprehensive individual stock analysis
 * 
 * Similar to Simply Wall St - shows valuation, growth, health, dividends etc.
 * Lazy-loaded for FCP optimization.
 */

import { fetchScreenData, API_BASE } from "../api/client";
import { METRIC_DEFINITIONS, formatMetricName } from "../utils/metricTooltips";
import "./InsiderActivityPanel";
import "./CompanyNewsPanel";

interface StockData {
  ticker: string;
  price?: number;
  market_cap?: number;
  enterprise_value?: number;
  pe_ratio?: number;
  pb_ratio?: number;
  ps_ratio?: number;
  ev_to_ebitda?: number;
  earnings_yield?: number;
  return_on_capital?: number;
  gross_margin?: number;
  operating_margin?: number;
  net_margin?: number;
  revenue_growth_yoy?: number;
  eps_growth_yoy?: number;
  free_cash_flow?: number;
  fcf_yield?: number;
  debt_to_equity?: number;
  interest_coverage?: number;
  dividend_yield?: number;
  payout_ratio?: number;
  book_value_per_share?: number;
}

interface AnalystRecommendation {
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}

interface WhaleHolder {
  holder: string;
  shares: number;
  dateReported: string;
  change: number;
}

export class StockDetailView extends HTMLElement {
  private ticker: string = "";
  private data: StockData | null = null;
  private isLoading: boolean = false;
  private error: string | null = null;
  private analystRecs: AnalystRecommendation[] = [];
  private whaleHolders: WhaleHolder[] = [];

  static get observedAttributes() {
    return ["ticker"];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback(name: string, _old: string, value: string) {
    if (name === "ticker" && value) {
      this.ticker = value.toUpperCase();
      this.fetchStockData();
    }
  }

  private async fetchStockData() {
    if (!this.ticker) return;

    this.isLoading = true;
    this.error = null;
    this.render();

    try {
      // Fetch all data in parallel
      const [screenResult, analystResult, whaleResult] = await Promise.all([
        fetchScreenData({
          filters: [{ field: "ticker", op: "=" as const, value: this.ticker }],
          columns: [
            "ticker", "price", "market_cap", "enterprise_value",
            "pe_ratio", "pb_ratio", "ps_ratio", "ev_to_ebitda",
            "earnings_yield", "return_on_capital",
            "gross_margin", "operating_margin", "net_margin",
            "revenue_growth_yoy", "eps_growth_yoy",
            "free_cash_flow", "fcf_yield",
            "debt_to_equity", "interest_coverage",
            "dividend_yield", "payout_ratio",
            "book_value_per_share"
          ],
          limit: 1,
        }),
        fetch(`${API_BASE}/api/analyst_recommendations/${this.ticker}`).then(r => r.ok ? r.json() : { recommendations: [] }),
        fetch(`${API_BASE}/api/whale_holdings/${this.ticker}`).then(r => r.ok ? r.json() : { holders: [] }),
      ]);

      if (screenResult.rows.length > 0) {
        this.data = screenResult.rows[0] as StockData;
      } else {
        this.error = `No data found for ${this.ticker}`;
      }
      
      this.analystRecs = analystResult.recommendations || [];
      this.whaleHolders = whaleResult.holders || [];
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Failed to load stock data";
    }

    this.isLoading = false;
    this.render();
  }

  private getScoreColor(score: number): string {
    if (score >= 4) return "#22c55e";
    if (score >= 3) return "#a3e635";
    if (score >= 2) return "#fbbf24";
    return "#f87171";
  }

  private calculateValuationScore(): { score: number; max: number; details: string[] } {
    if (!this.data) return { score: 0, max: 6, details: [] };
    const details: string[] = [];
    let score = 0;

    if (this.data.pe_ratio && this.data.pe_ratio > 0) {
      if (this.data.pe_ratio < 15) { score += 2; details.push("P/E below 15 ✓"); }
      else if (this.data.pe_ratio < 25) { score += 1; details.push("P/E reasonable"); }
      else { details.push("P/E elevated"); }
    }

    if (this.data.pb_ratio && this.data.pb_ratio > 0) {
      if (this.data.pb_ratio < 1.5) { score += 2; details.push("P/B below 1.5 ✓"); }
      else if (this.data.pb_ratio < 3) { score += 1; details.push("P/B reasonable"); }
      else { details.push("P/B elevated"); }
    }

    if (this.data.earnings_yield) {
      if (this.data.earnings_yield > 0.1) { score += 2; details.push("High earnings yield ✓"); }
      else if (this.data.earnings_yield > 0.05) { score += 1; details.push("Decent earnings yield"); }
    }

    return { score, max: 6, details };
  }

  private calculateGrowthScore(): { score: number; max: number; details: string[] } {
    if (!this.data) return { score: 0, max: 6, details: [] };
    const details: string[] = [];
    let score = 0;

    if (this.data.revenue_growth_yoy) {
      if (this.data.revenue_growth_yoy > 0.2) { score += 2; details.push("Strong revenue growth ✓"); }
      else if (this.data.revenue_growth_yoy > 0.1) { score += 1; details.push("Solid revenue growth"); }
      else if (this.data.revenue_growth_yoy > 0) { details.push("Positive revenue growth"); }
      else { details.push("Revenue declining"); }
    }

    if (this.data.eps_growth_yoy) {
      if (this.data.eps_growth_yoy > 0.25) { score += 2; details.push("Strong EPS growth ✓"); }
      else if (this.data.eps_growth_yoy > 0.15) { score += 1; details.push("Solid EPS growth"); }
      else if (this.data.eps_growth_yoy > 0) { details.push("Positive EPS growth"); }
      else { details.push("EPS declining"); }
    }

    if (this.data.return_on_capital) {
      if (this.data.return_on_capital > 0.2) { score += 2; details.push("Excellent ROIC ✓"); }
      else if (this.data.return_on_capital > 0.1) { score += 1; details.push("Good ROIC"); }
    }

    return { score, max: 6, details };
  }

  private calculateHealthScore(): { score: number; max: number; details: string[] } {
    if (!this.data) return { score: 0, max: 6, details: [] };
    const details: string[] = [];
    let score = 0;

    if (this.data.debt_to_equity !== undefined) {
      if (this.data.debt_to_equity < 0.3) { score += 2; details.push("Low debt ✓"); }
      else if (this.data.debt_to_equity < 1) { score += 1; details.push("Manageable debt"); }
      else { details.push("High leverage"); }
    }

    if (this.data.interest_coverage) {
      if (this.data.interest_coverage > 5) { score += 2; details.push("Strong interest coverage ✓"); }
      else if (this.data.interest_coverage > 2) { score += 1; details.push("Adequate coverage"); }
      else { details.push("Weak interest coverage"); }
    }

    if (this.data.fcf_yield) {
      if (this.data.fcf_yield > 0.08) { score += 2; details.push("Strong FCF yield ✓"); }
      else if (this.data.fcf_yield > 0.04) { score += 1; details.push("Positive FCF"); }
    }

    return { score, max: 6, details };
  }

  private formatValue(value: any, key: string): string {
    if (value === null || value === undefined) return "—";
    if (typeof value !== "number") return String(value);

    // Percentages
    if (key.includes("margin") || key.includes("yield") || key.includes("growth") || 
        key === "earnings_yield" || key === "return_on_capital" || key === "payout_ratio") {
      return `${(value * 100).toFixed(1)}%`;
    }

    // Ratios
    if (key.includes("ratio") || key === "ev_to_ebitda" || key === "interest_coverage") {
      return value.toFixed(2);
    }

    // Currency
    if (key === "price" || key === "book_value_per_share") {
      return `$${value.toFixed(2)}`;
    }

    // Large numbers
    if (key.includes("cap") || key.includes("value") || key === "free_cash_flow") {
      if (Math.abs(value) >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
      if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
      if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
      return `$${value.toLocaleString()}`;
    }

    return value.toFixed(2);
  }

  private render() {
    if (this.isLoading) {
      this.innerHTML = `
        <div class="stock-detail-loading">
          <div class="loading-spinner"></div>
          <p>Loading ${this.ticker}...</p>
        </div>
      `;
      return;
    }

    if (this.error) {
      this.innerHTML = `
        <div class="stock-detail-error">
          <span class="error-icon">⚠️</span>
          <p>${this.error}</p>
          <button class="btn btn-sm" onclick="this.parentElement.parentElement.dispatchEvent(new CustomEvent('close-detail', { bubbles: true }))">Back to Dashboard</button>
        </div>
      `;
      return;
    }

    if (!this.data) {
      this.innerHTML = `<div class="stock-detail-empty">Select a stock to view details</div>`;
      return;
    }

    const valuation = this.calculateValuationScore();
    const growth = this.calculateGrowthScore();
    const health = this.calculateHealthScore();

    this.innerHTML = `
      <div class="stock-detail">
        <header class="stock-detail-header">
          <button class="back-btn" id="back-btn">← Back</button>
          <div class="stock-title">
            <h1>${this.ticker}</h1>
            ${this.data.price ? `<span class="stock-price">$${this.data.price.toFixed(2)}</span>` : ''}
          </div>
          ${this.data.market_cap ? `<span class="stock-cap">${this.formatValue(this.data.market_cap, 'market_cap')} Market Cap</span>` : ''}
          <button class="refresh-btn" id="refresh-btn" title="Refresh data">↻</button>
        </header>

        <div class="score-cards">
          <div class="score-card">
            <div class="score-header">
              <span class="score-title">Valuation</span>
              <span class="score-badge" style="background: ${this.getScoreColor(valuation.score)}">${valuation.score}/${valuation.max}</span>
            </div>
            <div class="score-details">${valuation.details.join('<br>')}</div>
          </div>

          <div class="score-card">
            <div class="score-header">
              <span class="score-title">Future Growth</span>
              <span class="score-badge" style="background: ${this.getScoreColor(growth.score)}">${growth.score}/${growth.max}</span>
            </div>
            <div class="score-details">${growth.details.join('<br>')}</div>
          </div>

          <div class="score-card">
            <div class="score-header">
              <span class="score-title">Financial Health</span>
              <span class="score-badge" style="background: ${this.getScoreColor(health.score)}">${health.score}/${health.max}</span>
            </div>
            <div class="score-details">${health.details.join('<br>')}</div>
          </div>
        </div>

        <div class="metrics-grid">
          <section class="metrics-section">
            <h3>📊 Valuation</h3>
            <div class="metrics-list">
              ${this.renderMetric("pe_ratio", this.data.pe_ratio)}
              ${this.renderMetric("pb_ratio", this.data.pb_ratio)}
              ${this.renderMetric("ps_ratio", this.data.ps_ratio)}
              ${this.renderMetric("ev_to_ebitda", this.data.ev_to_ebitda)}
              ${this.renderMetric("earnings_yield", this.data.earnings_yield)}
            </div>
          </section>

          <section class="metrics-section">
            <h3>📈 Growth & Profitability</h3>
            <div class="metrics-list">
              ${this.renderMetric("revenue_growth_yoy", this.data.revenue_growth_yoy)}
              ${this.renderMetric("eps_growth_yoy", this.data.eps_growth_yoy)}
              ${this.renderMetric("return_on_capital", this.data.return_on_capital)}
              ${this.renderMetric("gross_margin", this.data.gross_margin)}
              ${this.renderMetric("operating_margin", this.data.operating_margin)}
              ${this.renderMetric("net_margin", this.data.net_margin)}
            </div>
          </section>

          <section class="metrics-section">
            <h3>💰 Cash & Debt</h3>
            <div class="metrics-list">
              ${this.renderMetric("free_cash_flow", this.data.free_cash_flow)}
              ${this.renderMetric("fcf_yield", this.data.fcf_yield)}
              ${this.renderMetric("debt_to_equity", this.data.debt_to_equity)}
              ${this.renderMetric("interest_coverage", this.data.interest_coverage)}
            </div>
          </section>

          <section class="metrics-section">
            <h3>💵 Dividends & Book Value</h3>
            <div class="metrics-list">
              ${this.renderMetric("dividend_yield", this.data.dividend_yield)}
              ${this.renderMetric("payout_ratio", this.data.payout_ratio)}
              ${this.renderMetric("book_value_per_share", this.data.book_value_per_share)}
            </div>
          </section>
        </div>
        
        ${this.renderAnalystRecommendations()}
        ${this.renderWhaleHolders()}
        
        <div class="alt-data-grid">
          <section class="alt-data-section">
            <h3>👔 Insider Activity</h3>
            <insider-activity-panel ticker="${this.ticker}"></insider-activity-panel>
          </section>
          
          <section class="alt-data-section">
            <h3>📰 Recent News</h3>
            <company-news-panel ticker="${this.ticker}"></company-news-panel>
          </section>
        </div>
      </div>
    `;

    // Back button
    this.querySelector("#back-btn")?.addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("close-detail", { bubbles: true }));
    });
    
    // Refresh button
    this.querySelector("#refresh-btn")?.addEventListener("click", () => {
      this.fetchStockData();
    });
  }

  private renderMetric(key: string, value: any): string {
    const def = METRIC_DEFINITIONS[key];
    const name = def?.name || formatMetricName(key);
    const formatted = this.formatValue(value, key);
    
    let quality = "";
    if (value !== null && value !== undefined && typeof value === "number") {
      // Color coding based on metric quality
      if (key === "pe_ratio" && value > 0) {
        quality = value < 15 ? "good" : value > 30 ? "bad" : "";
      } else if (key === "debt_to_equity") {
        quality = value < 0.5 ? "good" : value > 1.5 ? "bad" : "";
      } else if (key.includes("margin") || key.includes("yield") || key === "return_on_capital") {
        quality = value > 0.15 ? "good" : value < 0.05 ? "bad" : "";
      } else if (key.includes("growth")) {
        quality = value > 0.15 ? "good" : value < 0 ? "bad" : "";
      }
    }

    return `
      <div class="metric-row ${quality}">
        <span class="metric-name" title="${def?.description || ''}">${name}</span>
        <span class="metric-value">${formatted}</span>
      </div>
    `;
  }
  
  private renderAnalystRecommendations(): string {
    if (!this.analystRecs || this.analystRecs.length === 0) {
      return `
        <section class="analyst-section">
          <h3>📊 Analyst Recommendations</h3>
          <p class="no-data">No analyst data available</p>
        </section>
      `;
    }
    
    const latest = this.analystRecs[0];
    const total = latest.strongBuy + latest.buy + latest.hold + latest.sell + latest.strongSell;
    const bullish = latest.strongBuy + latest.buy;
    const bearish = latest.sell + latest.strongSell;
    const consensus = total > 0 ? (bullish > bearish ? "Bullish" : bearish > bullish ? "Bearish" : "Neutral") : "N/A";
    const consensusColor = consensus === "Bullish" ? "#22c55e" : consensus === "Bearish" ? "#ef4444" : "#94a3b8";
    
    return `
      <section class="analyst-section">
        <h3>📊 Analyst Recommendations</h3>
        <div class="analyst-content">
          <div class="consensus-badge" style="background: ${consensusColor}20; color: ${consensusColor}; border: 1px solid ${consensusColor}40;">
            ${consensus} Consensus
          </div>
          <div class="analyst-bars">
            <div class="analyst-bar-row">
              <span class="bar-label">Strong Buy</span>
              <div class="bar-container"><div class="bar strong-buy" style="width: ${total > 0 ? (latest.strongBuy / total * 100) : 0}%"></div></div>
              <span class="bar-count">${latest.strongBuy}</span>
            </div>
            <div class="analyst-bar-row">
              <span class="bar-label">Buy</span>
              <div class="bar-container"><div class="bar buy" style="width: ${total > 0 ? (latest.buy / total * 100) : 0}%"></div></div>
              <span class="bar-count">${latest.buy}</span>
            </div>
            <div class="analyst-bar-row">
              <span class="bar-label">Hold</span>
              <div class="bar-container"><div class="bar hold" style="width: ${total > 0 ? (latest.hold / total * 100) : 0}%"></div></div>
              <span class="bar-count">${latest.hold}</span>
            </div>
            <div class="analyst-bar-row">
              <span class="bar-label">Sell</span>
              <div class="bar-container"><div class="bar sell" style="width: ${total > 0 ? (latest.sell / total * 100) : 0}%"></div></div>
              <span class="bar-count">${latest.sell}</span>
            </div>
            <div class="analyst-bar-row">
              <span class="bar-label">Strong Sell</span>
              <div class="bar-container"><div class="bar strong-sell" style="width: ${total > 0 ? (latest.strongSell / total * 100) : 0}%"></div></div>
              <span class="bar-count">${latest.strongSell}</span>
            </div>
          </div>
          <p class="analyst-note">Based on ${total} analyst ratings as of ${latest.period}</p>
        </div>
      </section>
    `;
  }
  
  private renderWhaleHolders(): string {
    if (!this.whaleHolders || this.whaleHolders.length === 0) {
      return `
        <section class="whale-section">
          <h3>🐋 Institutional Holders</h3>
          <p class="no-data">No institutional holder data available</p>
        </section>
      `;
    }
    
    const formatShares = (n: number) => {
      if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
      if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
      if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
      return n.toLocaleString();
    };
    
    return `
      <section class="whale-section">
        <h3>🐋 Top Institutional Holders</h3>
        <div class="whale-table">
          <div class="whale-header">
            <span>Institution</span>
            <span>Shares</span>
            <span>Change</span>
          </div>
          ${this.whaleHolders.slice(0, 10).map(h => `
            <div class="whale-row">
              <span class="holder-name">${h.holder}</span>
              <span class="shares">${formatShares(h.shares)}</span>
              <span class="change ${h.change > 0 ? 'up' : h.change < 0 ? 'down' : ''}">
                ${h.change > 0 ? '+' : ''}${h.change !== 0 ? formatShares(h.change) : '—'}
              </span>
            </div>
          `).join('')}
        </div>
        <p class="whale-note">Data from latest 13F filings (quarterly)</p>
      </section>
    `;
  }
}

customElements.define("stock-detail-view", StockDetailView);
