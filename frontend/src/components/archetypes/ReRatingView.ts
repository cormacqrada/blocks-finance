/**
 * ReRatingView - "Multiple Expansion"
 * 
 * Pattern: Business quality recognized late, valuation does the work
 * 
 * Visualizations:
 * 1. Multiple Expansion vs EPS Growth - EPS flat, multiple rising
 * 2. P/E Distribution - Where stocks sit relative to market
 * 3. Quality vs Valuation Gap - High quality at low multiple = re-rating potential
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

export class ReRatingView extends HTMLElement {
  private shadow: ShadowRoot;
  private charts: Chart[] = [];
  private fundamentals: any[] = [];

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
      const result = await fetchScreenData({
        filters: [
          { field: "pe_ratio", op: ">", value: 0 },
          { field: "pe_ratio", op: "<", value: 50 },
        ],
        columns: [
          "ticker", "company_name", "price", "pe_ratio", "pb_ratio",
          "eps", "eps_growth_yoy", "gross_margin", "operating_margin",
          "revenue_growth_yoy", "fcf_yield", "market_cap"
        ],
        rank_by: "gross_margin",
        rank_order: "DESC",
        limit: 40,
      });

      this.fundamentals = result.rows || [];
      this.renderCharts(this.fundamentals);
    } catch (e) {
      console.error("Failed to load re-rating data:", e);
    }
  }

  private render() {
    this.shadow.innerHTML = `
      <style>
        ${SHARED_STYLES}
        :host {
          --signal-bg: rgba(139, 92, 246, 0.1);
          --signal-color: #8b5cf6;
          --badge-bg: rgba(139, 92, 246, 0.15);
          --badge-color: #a78bfa;
        }
      </style>
      <div class="container">
        <div class="header">
          <h2>📈 Re-Rating Plays</h2>
          <span class="signal">"Quality discovered, multiple expands."</span>
        </div>
        
        <div id="insights-container"></div>
        
        <div class="chart-section">
          <div class="chart-header">
            <div class="chart-title">Quality vs Multiple Gap</div>
            <div class="chart-explainer">
              <strong>How to read:</strong> X-axis is P/E, Y-axis is gross margin.
              <strong>Top-left quadrant = re-rating opportunity</strong> — high quality at low valuation.
            </div>
          </div>
          <div class="chart-container"><canvas id="quality-gap"></canvas></div>
          <div class="ticker-list" id="rerate-candidates"></div>
        </div>
        
        <div class="chart-section">
          <div class="chart-header">
            <div class="chart-title">P/E Distribution</div>
            <div class="chart-explainer">
              <strong>How to read:</strong> Histogram shows where stocks cluster by valuation.
              <strong>Left bars = value</strong>, right bars = growth premium.
            </div>
          </div>
          <div class="chart-container"><canvas id="pe-distribution"></canvas></div>
        </div>
        
        <div class="chart-section">
          <div class="chart-header">
            <div class="chart-title">Quality Score Breakdown</div>
            <div class="chart-explainer">
              <strong>How to read:</strong> Stacked bars show margin components.
              <strong>Taller total bars = higher quality</strong> businesses.
            </div>
          </div>
          <div class="chart-container"><canvas id="quality-breakdown"></canvas></div>
        </div>
      </div>
    `;
  }

  private renderCharts(data: any[]) {
    this.charts.forEach(c => c.destroy());
    this.charts = [];
    
    // Generate and render AI insights
    const insights = generateArchetypeInsights({ fundamentals: this.fundamentals, archetype: "rerating" });
    const insightsContainer = this.shadow.getElementById("insights-container");
    if (insightsContainer) insightsContainer.innerHTML = renderInsightsSection(insights);

    // Quality vs Multiple scatter
    const canvas1 = this.shadow.getElementById("quality-gap") as HTMLCanvasElement;
    if (canvas1 && data.length > 0) {
      const points = data.map(r => ({
        ticker: r.ticker,
        x: r.pe_ratio || 0,
        y: r.gross_margin || 0,
        quality: ((r.gross_margin || 0) + (r.operating_margin || 0)) / 2,
      })).filter(p => p.x > 0 && p.x < 40);

      // Re-rating candidates: high quality (margin > 40) at reasonable PE (< 20)
      const candidates = points.filter(p => p.y > 40 && p.x < 20);
      const candidatesEl = this.shadow.getElementById("rerate-candidates");
      if (candidatesEl) {
        candidatesEl.innerHTML = renderTickerBadges(candidates.map(c => c.ticker), 8);
      }

      this.charts.push(new Chart(canvas1, {
        type: "scatter",
        data: {
          datasets: [{
            label: "Companies",
            data: points,
            backgroundColor: points.map(p => 
              p.y > 40 && p.x < 20 ? "rgba(139, 92, 246, 0.8)" : "rgba(100, 116, 139, 0.5)"
            ),
            pointRadius: 8,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx: any) => `${ctx.raw.ticker}: PE ${ctx.raw.x.toFixed(1)}, Margin ${ctx.raw.y.toFixed(1)}%`,
              },
            },
          },
          scales: {
            x: { title: { display: true, text: "P/E Ratio", color: "#94a3b8" }, grid: { color: "rgba(148, 163, 184, 0.1)" }, ticks: { color: "#94a3b8" } },
            y: { title: { display: true, text: "Gross Margin %", color: "#94a3b8" }, grid: { color: "rgba(148, 163, 184, 0.1)" }, ticks: { color: "#94a3b8" } },
          },
        },
      }));
    }

    // P/E Distribution histogram
    const canvas2 = this.shadow.getElementById("pe-distribution") as HTMLCanvasElement;
    if (canvas2 && data.length > 0) {
      const pes = data.map(r => r.pe_ratio || 0).filter(pe => pe > 0 && pe < 50);
      const buckets = [0, 10, 15, 20, 25, 30, 40, 50];
      const counts = buckets.slice(0, -1).map((min, i) => {
        const max = buckets[i + 1];
        return pes.filter(pe => pe >= min && pe < max).length;
      });

      this.charts.push(new Chart(canvas2, {
        type: "bar",
        data: {
          labels: buckets.slice(0, -1).map((min, i) => `${min}-${buckets[i + 1]}`),
          datasets: [{
            label: "Count",
            data: counts,
            backgroundColor: "rgba(139, 92, 246, 0.7)",
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { title: { display: true, text: "# Companies", color: "#94a3b8" }, grid: { color: "rgba(148, 163, 184, 0.1)" }, ticks: { color: "#94a3b8" } },
            x: { title: { display: true, text: "P/E Range", color: "#94a3b8" }, grid: { display: false }, ticks: { color: "#94a3b8" } },
          },
        },
      }));
    }

    // Quality breakdown for top candidates
    const canvas3 = this.shadow.getElementById("quality-breakdown") as HTMLCanvasElement;
    if (canvas3 && data.length > 0) {
      const candidates = data
        .filter(r => r.gross_margin > 35 && r.pe_ratio < 25 && r.pe_ratio > 0)
        .slice(0, 10);

      this.charts.push(new Chart(canvas3, {
        type: "bar",
        data: {
          labels: candidates.map(r => r.ticker),
          datasets: [
            { label: "Gross Margin", data: candidates.map(r => r.gross_margin || 0), backgroundColor: "rgba(139, 92, 246, 0.7)" },
            { label: "Op Margin", data: candidates.map(r => r.operating_margin || 0), backgroundColor: "rgba(59, 130, 246, 0.7)" },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: "y",
          plugins: { legend: { position: "top", labels: { color: "#94a3b8", boxWidth: 12 } } },
          scales: {
            x: { title: { display: true, text: "Margin %", color: "#94a3b8" }, grid: { color: "rgba(148, 163, 184, 0.1)" }, ticks: { color: "#94a3b8" } },
            y: { grid: { display: false }, ticks: { color: "#94a3b8" } },
          },
        },
      }));
    }
  }
}

customElements.define("rerating-view", ReRatingView);
