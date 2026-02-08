/**
 * StructuralWinnersView - "Industry Tailwinds"
 * 
 * Pattern: Demand grows regardless of cycle, share gains compound
 * 
 * Visualizations:
 * 1. Revenue Growth Leaders - Consistent top-line growth
 * 2. Pricing Power Indicator - Revenue growth > volume proxy
 * 3. Growth + Margin Combo - Growing AND profitable
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

export class StructuralWinnersView extends HTMLElement {
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
          { field: "revenue_growth_yoy", op: ">", value: 5 },
        ],
        columns: [
          "ticker", "company_name", "price", "pe_ratio",
          "revenue", "revenue_growth_yoy", "eps_growth_yoy",
          "gross_margin", "operating_margin", "net_margin",
          "market_cap", "sector", "industry"
        ],
        rank_by: "revenue_growth_yoy",
        rank_order: "DESC",
        limit: 30,
      });

      this.fundamentals = result.rows || [];
      this.renderCharts(this.fundamentals);
    } catch (e) {
      console.error("Failed to load structural winners data:", e);
    }
  }

  private render() {
    this.shadow.innerHTML = `
      <style>
        ${SHARED_STYLES}
        :host {
          --signal-bg: rgba(20, 184, 166, 0.1);
          --signal-color: #14b8a6;
          --badge-bg: rgba(20, 184, 166, 0.15);
          --badge-color: #2dd4bf;
        }
      </style>
      <div class="container">
        <div class="header">
          <h2>🚀 Structural Winners</h2>
          <span class="signal">"Demand grows regardless of cycle."</span>
        </div>
        
        <div id="insights-container"></div>
        
        <div class="chart-section">
          <div class="chart-header">
            <div class="chart-title">Revenue Growth vs Margin</div>
            <div class="chart-explainer">
              <strong>How to read:</strong> X-axis is revenue growth, Y-axis is gross margin.
              <strong>Top-right = structural winners</strong> — growing AND profitable at scale.
            </div>
          </div>
          <div class="chart-container"><canvas id="growth-margin"></canvas></div>
          <div class="ticker-list" id="structural-candidates"></div>
        </div>
        
        <div class="chart-section">
          <div class="chart-header">
            <div class="chart-title">Revenue Growth Leaders</div>
            <div class="chart-explainer">
              <strong>How to read:</strong> Sorted by YoY revenue growth.
              <strong>>15% sustained growth</strong> suggests industry tailwinds or share gains.
            </div>
          </div>
          <div class="chart-container"><canvas id="revenue-leaders"></canvas></div>
        </div>
        
        <div class="chart-section">
          <div class="chart-header">
            <div class="chart-title">Pricing Power: Margin Expansion</div>
            <div class="chart-explainer">
              <strong>How to read:</strong> Stacked bars show gross and operating margins.
              <strong>High gross + expanding operating</strong> = true pricing power.
            </div>
          </div>
          <div class="chart-container"><canvas id="pricing-power"></canvas></div>
        </div>
      </div>
    `;
  }

  private renderCharts(data: any[]) {
    this.charts.forEach(c => c.destroy());
    this.charts = [];
    
    // Generate and render AI insights
    const insights = generateArchetypeInsights({ fundamentals: this.fundamentals, archetype: "structural-winners" });
    const insightsContainer = this.shadow.getElementById("insights-container");
    if (insightsContainer) insightsContainer.innerHTML = renderInsightsSection(insights);

    // Revenue Growth vs Margin scatter
    const canvas1 = this.shadow.getElementById("growth-margin") as HTMLCanvasElement;
    if (canvas1 && data.length > 0) {
      const points = data.map(r => ({
        ticker: r.ticker,
        x: r.revenue_growth_yoy || 0,
        y: r.gross_margin || 0,
        opMargin: r.operating_margin || 0,
      })).filter(p => p.x > -20 && p.x < 100);

      // Structural winners: growth > 10% AND margin > 40%
      const candidates = points.filter(p => p.x > 10 && p.y > 40);
      const candidatesEl = this.shadow.getElementById("structural-candidates");
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
              p.x > 10 && p.y > 40 ? "rgba(20, 184, 166, 0.8)" : "rgba(100, 116, 139, 0.5)"
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
                label: (ctx: any) => `${ctx.raw.ticker}: Growth ${ctx.raw.x.toFixed(1)}%, Margin ${ctx.raw.y.toFixed(1)}%`,
              },
            },
          },
          scales: {
            x: { title: { display: true, text: "Revenue Growth %", color: "#94a3b8" }, grid: { color: "rgba(148, 163, 184, 0.1)" }, ticks: { color: "#94a3b8" } },
            y: { title: { display: true, text: "Gross Margin %", color: "#94a3b8" }, grid: { color: "rgba(148, 163, 184, 0.1)" }, ticks: { color: "#94a3b8" } },
          },
        },
      }));
    }

    // Revenue Growth Leaders bar
    const canvas2 = this.shadow.getElementById("revenue-leaders") as HTMLCanvasElement;
    if (canvas2 && data.length > 0) {
      const sorted = [...data].sort((a, b) => (b.revenue_growth_yoy || 0) - (a.revenue_growth_yoy || 0)).slice(0, 15);
      this.charts.push(new Chart(canvas2, {
        type: "bar",
        data: {
          labels: sorted.map(r => r.ticker),
          datasets: [{
            label: "Revenue Growth %",
            data: sorted.map(r => r.revenue_growth_yoy || 0),
            backgroundColor: sorted.map(r => r.revenue_growth_yoy > 15 ? "rgba(20, 184, 166, 0.7)" : "rgba(100, 116, 139, 0.5)"),
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { title: { display: true, text: "Growth %", color: "#94a3b8" }, grid: { color: "rgba(148, 163, 184, 0.1)" }, ticks: { color: "#94a3b8" } },
            x: { grid: { display: false }, ticks: { color: "#94a3b8" } },
          },
        },
      }));
    }

    // Pricing Power - margin levels
    const canvas3 = this.shadow.getElementById("pricing-power") as HTMLCanvasElement;
    if (canvas3 && data.length > 0) {
      const sorted = [...data].filter(r => r.gross_margin > 30).sort((a, b) => (b.gross_margin || 0) - (a.gross_margin || 0)).slice(0, 12);
      this.charts.push(new Chart(canvas3, {
        type: "bar",
        data: {
          labels: sorted.map(r => r.ticker),
          datasets: [
            { label: "Gross Margin", data: sorted.map(r => r.gross_margin || 0), backgroundColor: "rgba(20, 184, 166, 0.7)" },
            { label: "Operating Margin", data: sorted.map(r => r.operating_margin || 0), backgroundColor: "rgba(59, 130, 246, 0.7)" },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "top", labels: { color: "#94a3b8", boxWidth: 12 } } },
          scales: {
            y: { title: { display: true, text: "Margin %", color: "#94a3b8" }, grid: { color: "rgba(148, 163, 184, 0.1)" }, ticks: { color: "#94a3b8" } },
            x: { grid: { display: false }, ticks: { color: "#94a3b8" } },
          },
        },
      }));
    }
  }
}

customElements.define("structural-winners-view", StructuralWinnersView);
