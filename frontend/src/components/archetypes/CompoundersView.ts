/**
 * CompoundersView - "Quiet, Relentless Winners"
 * 
 * Pattern: Steady growth, high ROIC, reinvestment works, few fireworks
 * 
 * Visualizations:
 * 1. ROIC vs Reinvestment Rate (Scatter) - Winners sit top-right
 * 2. Earnings Staircase - EPS over time with minimal drawdowns
 * 3. Margin Stability Band - Narrow margin range over years
 */

import { fetchScreenData } from "../../api/client";
import Chart from "chart.js/auto";
import {
  SHARED_STYLES,
  renderTickerBadges,
  renderInsightsSection,
  generateArchetypeInsights,
  setupTickerLinks,
} from "./shared";

const API_BASE = (window as any).VITE_API_URL || "http://localhost:8000";

interface CompoundersData {
  fundamentals: any[];
  earningsHistory: Map<string, any[]>;
  priceHistory: Map<string, any[]>;
}

export class CompoundersView extends HTMLElement {
  private shadow: ShadowRoot;
  private charts: Chart[] = [];
  private data: CompoundersData | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.render();
    this.loadData();
    setupTickerLinks(this.shadow);
  }

  disconnectedCallback() {
    this.charts.forEach(c => c.destroy());
  }

  private async loadData() {
    try {
      // Fetch fundamentals with ROIC-relevant metrics
      const result = await fetchScreenData({
        filters: [
          { field: "gross_margin", op: ">", value: 30 },
        ],
        columns: [
          "ticker", "company_name", "price", "pe_ratio", "eps", "eps_growth_yoy",
          "gross_margin", "operating_margin", "net_margin",
          "free_cash_flow", "market_cap", "total_equity", "revenue",
          "debt_to_equity", "payout_ratio"
        ],
        rank_by: "gross_margin",
        rank_order: "DESC",
        limit: 30,
      });

      const fundamentals = result.rows || [];
      const earningsHistory = new Map<string, any[]>();
      const priceHistory = new Map<string, any[]>();

      // Fetch historical data for top compounders
      const topTickers = fundamentals.slice(0, 10).map((r: any) => r.ticker);
      
      for (const ticker of topTickers) {
        try {
          const [earnings, prices] = await Promise.all([
            fetch(`${API_BASE}/api/earnings_history/${ticker}`).then(r => r.json()),
            fetch(`${API_BASE}/api/price_history/${ticker}?period=5y`).then(r => r.json()),
          ]);
          if (earnings.data) earningsHistory.set(ticker, earnings.data);
          if (prices.data) priceHistory.set(ticker, prices.data);
        } catch (e) {
          // Continue without historical data
        }
      }

      this.data = { fundamentals, earningsHistory, priceHistory };
      this.renderCharts();
    } catch (e) {
      console.error("Failed to load compounders data:", e);
      this.showError("Failed to load data");
    }
  }

  private render() {
    this.shadow.innerHTML = `
      <style>
        ${SHARED_STYLES}
        
        /* Compounder-specific overrides */
        :host {
          --signal-bg: rgba(34, 197, 94, 0.1);
          --signal-color: #22c55e;
          --badge-bg: rgba(34, 197, 94, 0.15);
          --badge-color: #4ade80;
        }
      </style>
      <div class="container">
        <div class="header">
          <h2>🏔️ Compounders</h2>
          <span class="signal">"Boring business, exceptional outcome."</span>
        </div>
        
        <div id="insights-container"></div>
        
        <div class="chart-section">
          <div class="chart-header">
            <div class="chart-title">ROIC vs Reinvestment Rate</div>
            <div class="chart-explainer">
              <strong>How to read:</strong> X-axis shows how much earnings are reinvested (vs paid out). 
              Y-axis shows return on invested capital. <strong>Top-right = compounders</strong> — 
              high reinvestment that actually generates returns.
            </div>
          </div>
          <div class="chart-container">
            <canvas id="roic-scatter"></canvas>
          </div>
          <div class="ticker-list" id="roic-winners"></div>
        </div>
        
        <div class="chart-section">
          <div class="chart-header">
            <div class="chart-title">Earnings Staircase</div>
            <div class="chart-explainer">
              <strong>How to read:</strong> True compounders show EPS climbing steadily over quarters 
              with minimal drawdowns. Erratic lines suggest cyclicality or execution issues.
            </div>
          </div>
          <div class="chart-container">
            <canvas id="earnings-staircase"></canvas>
          </div>
        </div>
        
        <div class="chart-section">
          <div class="chart-header">
            <div class="chart-title">Margin Stability Band</div>
            <div class="chart-explainer">
              <strong>How to read:</strong> Stacked bars show gross/operating/net margins. 
              <strong>Consistent spreads</strong> across companies indicate pricing power and operational discipline.
            </div>
          </div>
          <div class="chart-container">
            <canvas id="margin-stability"></canvas>
          </div>
        </div>
      </div>
    `;
  }

  private renderCharts() {
    if (!this.data) return;
    
    this.charts.forEach(c => c.destroy());
    this.charts = [];

    // Generate and render AI insights
    const insights = generateArchetypeInsights({
      fundamentals: this.data.fundamentals,
      archetype: "compounders",
    });
    const insightsContainer = this.shadow.getElementById("insights-container");
    if (insightsContainer) {
      insightsContainer.innerHTML = renderInsightsSection(insights);
    }

    this.renderROICScatter();
    this.renderEarningsStaircase();
    this.renderMarginStability();
  }

  private renderROICScatter() {
    const canvas = this.shadow.getElementById("roic-scatter") as HTMLCanvasElement;
    const winnersEl = this.shadow.getElementById("roic-winners");
    if (!canvas || !this.data) return;

    // Calculate ROIC and reinvestment rate
    const points = this.data.fundamentals
      .filter((r: any) => r.total_equity > 0 && r.free_cash_flow !== undefined)
      .map((r: any) => {
        // ROIC approximation: operating_margin * revenue / total_equity
        const roic = (r.operating_margin / 100) * (r.revenue / r.total_equity) * 100;
        // Reinvestment rate: 1 - payout_ratio (what's not paid out is reinvested)
        const reinvestRate = 100 - (r.payout_ratio || 0);
        return {
          ticker: r.ticker,
          name: r.company_name || r.ticker,
          x: Math.max(0, Math.min(100, reinvestRate)),
          y: Math.max(-20, Math.min(100, roic)),
          margin: r.gross_margin,
        };
      })
      .filter((p: any) => !isNaN(p.x) && !isNaN(p.y));

    // Identify winners (top-right quadrant)
    const winners = points.filter((p: any) => p.x > 50 && p.y > 15);
    if (winnersEl) {
      winnersEl.innerHTML = renderTickerBadges(winners.map((w: any) => w.ticker), 8);
    }

    const chart = new Chart(canvas, {
      type: "scatter",
      data: {
        datasets: [{
          label: "Companies",
          data: points,
          backgroundColor: points.map((p: any) => 
            p.x > 50 && p.y > 15 ? "rgba(34, 197, 94, 0.8)" : "rgba(100, 116, 139, 0.5)"
          ),
          pointRadius: 8,
          pointHoverRadius: 10,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx: any) => {
                const p = ctx.raw;
                return `${p.ticker}: ROIC ${p.y.toFixed(1)}%, Reinvest ${p.x.toFixed(0)}%`;
              },
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: "Reinvestment Rate %", color: "#94a3b8" },
            min: 0,
            max: 100,
            grid: { color: "rgba(148, 163, 184, 0.1)" },
            ticks: { color: "#94a3b8" },
          },
          y: {
            title: { display: true, text: "ROIC %", color: "#94a3b8" },
            min: -10,
            max: 60,
            grid: { color: "rgba(148, 163, 184, 0.1)" },
            ticks: { color: "#94a3b8" },
          },
        },
      },
    });
    this.charts.push(chart);
  }

  private renderEarningsStaircase() {
    const canvas = this.shadow.getElementById("earnings-staircase") as HTMLCanvasElement;
    if (!canvas || !this.data) return;

    const datasets: any[] = [];
    const colors = ["#22c55e", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6"];
    let colorIdx = 0;

    this.data.earningsHistory.forEach((history, ticker) => {
      if (history.length < 4) return;
      
      const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
      const data = sorted.map(h => ({
        x: h.date,
        y: h.eps,
      })).filter(d => d.y !== null);

      if (data.length > 0) {
        datasets.push({
          label: ticker,
          data,
          borderColor: colors[colorIdx % colors.length],
          backgroundColor: "transparent",
          tension: 0.1,
          pointRadius: 3,
        });
        colorIdx++;
      }
    });

    if (datasets.length === 0) {
      canvas.parentElement!.innerHTML = `<div class="loading">No earnings history available. Run yfinance ingestion first.</div>`;
      return;
    }

    const chart = new Chart(canvas, {
      type: "line",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "top",
            labels: { color: "#94a3b8", boxWidth: 12 },
          },
        },
        scales: {
          x: {
            type: "category",
            grid: { color: "rgba(148, 163, 184, 0.1)" },
            ticks: { color: "#94a3b8", maxRotation: 45 },
          },
          y: {
            title: { display: true, text: "EPS $", color: "#94a3b8" },
            grid: { color: "rgba(148, 163, 184, 0.1)" },
            ticks: { color: "#94a3b8" },
          },
        },
      },
    });
    this.charts.push(chart);
  }

  private renderMarginStability() {
    const canvas = this.shadow.getElementById("margin-stability") as HTMLCanvasElement;
    if (!canvas || !this.data) return;

    // Show current margin ranges as horizontal bar chart
    const marginData = this.data.fundamentals
      .slice(0, 15)
      .map((r: any) => ({
        ticker: r.ticker,
        gross: r.gross_margin || 0,
        operating: r.operating_margin || 0,
        net: r.net_margin || 0,
      }));

    const chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: marginData.map((d: any) => d.ticker),
        datasets: [
          {
            label: "Gross Margin",
            data: marginData.map((d: any) => d.gross),
            backgroundColor: "rgba(34, 197, 94, 0.7)",
          },
          {
            label: "Operating Margin",
            data: marginData.map((d: any) => d.operating),
            backgroundColor: "rgba(59, 130, 246, 0.7)",
          },
          {
            label: "Net Margin",
            data: marginData.map((d: any) => d.net),
            backgroundColor: "rgba(139, 92, 246, 0.7)",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "y",
        plugins: {
          legend: {
            position: "top",
            labels: { color: "#94a3b8", boxWidth: 12 },
          },
        },
        scales: {
          x: {
            title: { display: true, text: "Margin %", color: "#94a3b8" },
            grid: { color: "rgba(148, 163, 184, 0.1)" },
            ticks: { color: "#94a3b8" },
          },
          y: {
            grid: { display: false },
            ticks: { color: "#94a3b8" },
          },
        },
      },
    });
    this.charts.push(chart);
  }

  private showError(message: string) {
    const container = this.shadow.querySelector(".container");
    if (container) {
      container.innerHTML = `<div class="loading">⚠️ ${message}</div>`;
    }
  }
}

customElements.define("compounders-view", CompoundersView);
