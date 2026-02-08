/**
 * AntifragileView - "Resilient Businesses"
 * 
 * Pattern: Doesn't win big, doesn't lose big either. Compounds through cycles.
 * 
 * Visualizations:
 * 1. Cash Flow Stability - Consistent FCF generation
 * 2. Margin Consistency - Narrow band across companies
 * 3. Leverage Safety - Low debt, high coverage
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

export class AntifragileView extends HTMLElement {
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
      // Look for stable, low-volatility businesses
      const result = await fetchScreenData({
        filters: [
          { field: "debt_to_equity", op: "<", value: 1 },
          { field: "free_cash_flow", op: ">", value: 0 },
        ],
        columns: [
          "ticker", "company_name", "price", "pe_ratio",
          "gross_margin", "operating_margin", "net_margin",
          "debt_to_equity", "interest_coverage", "free_cash_flow",
          "fcf_yield", "dividend_yield", "payout_ratio", "market_cap"
        ],
        rank_by: "interest_coverage",
        rank_order: "DESC",
        limit: 30,
      });

      this.fundamentals = result.rows || [];
      this.renderCharts(this.fundamentals);
    } catch (e) {
      console.error("Failed to load antifragile data:", e);
    }
  }

  private render() {
    this.shadow.innerHTML = `
      <style>
        ${SHARED_STYLES}
        :host {
          --signal-bg: rgba(99, 102, 241, 0.1);
          --signal-color: #6366f1;
          --badge-bg: rgba(99, 102, 241, 0.15);
          --badge-color: #818cf8;
        }
      </style>
      <div class="container">
        <div class="header">
          <h2>🛡️ Anti-Fragile</h2>
          <span class="signal">"Survives downturns, compounds through cycles."</span>
        </div>
        
        <div id="insights-container"></div>
        
        <div class="chart-section">
          <div class="chart-header">
            <div class="chart-title">Leverage vs Coverage Safety</div>
            <div class="chart-explainer">
              <strong>How to read:</strong> X-axis is Debt/Equity, Y-axis is Interest Coverage.
              <strong>Top-left = fortress</strong> — low debt, easily covers interest. Sleep well at night.
            </div>
          </div>
          <div class="chart-container"><canvas id="safety-scatter"></canvas></div>
          <div class="ticker-list" id="antifragile-candidates"></div>
        </div>
        
        <div class="chart-section">
          <div class="chart-header">
            <div class="chart-title">FCF Yield Distribution</div>
            <div class="chart-explainer">
              <strong>How to read:</strong> FCF yield shows cash generation per dollar invested.
              <strong>Consistent 4-6%+ yields</strong> indicate reliable cash machines.
            </div>
          </div>
          <div class="chart-container"><canvas id="fcf-distribution"></canvas></div>
        </div>
        
        <div class="chart-section">
          <div class="chart-header">
            <div class="chart-title">Margin Stability Profile</div>
            <div class="chart-explainer">
              <strong>How to read:</strong> Stacked bars show gross/operating/net margins.
              <strong>Tight bands across companies</strong> = consistent operational excellence.
            </div>
          </div>
          <div class="chart-container"><canvas id="margin-stability"></canvas></div>
        </div>
      </div>
    `;
  }

  private renderCharts(data: any[]) {
    this.charts.forEach(c => c.destroy());
    this.charts = [];
    
    // Generate and render AI insights
    const insights = generateArchetypeInsights({ fundamentals: this.fundamentals, archetype: "antifragile" });
    const insightsContainer = this.shadow.getElementById("insights-container");
    if (insightsContainer) insightsContainer.innerHTML = renderInsightsSection(insights);

    // Leverage vs Coverage scatter
    const canvas1 = this.shadow.getElementById("safety-scatter") as HTMLCanvasElement;
    if (canvas1 && data.length > 0) {
      const points = data.map(r => ({
        ticker: r.ticker,
        x: r.debt_to_equity || 0,
        y: Math.min(50, r.interest_coverage || 0),
        fcfYield: r.fcf_yield || 0,
      })).filter(p => p.y > 0);

      // Anti-fragile candidates: low leverage + high coverage
      const candidates = points.filter(p => p.x < 0.5 && p.y > 10);
      const candidatesEl = this.shadow.getElementById("antifragile-candidates");
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
              p.x < 0.5 && p.y > 10 ? "rgba(99, 102, 241, 0.8)" : "rgba(100, 116, 139, 0.5)"
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
                label: (ctx: any) => `${ctx.raw.ticker}: D/E ${ctx.raw.x.toFixed(2)}, Coverage ${ctx.raw.y.toFixed(1)}x`,
              },
            },
          },
          scales: {
            x: { title: { display: true, text: "Debt/Equity", color: "#94a3b8" }, min: 0, max: 2, grid: { color: "rgba(148, 163, 184, 0.1)" }, ticks: { color: "#94a3b8" } },
            y: { title: { display: true, text: "Interest Coverage", color: "#94a3b8" }, grid: { color: "rgba(148, 163, 184, 0.1)" }, ticks: { color: "#94a3b8" } },
          },
        },
      }));
    }

    // FCF Distribution
    const canvas2 = this.shadow.getElementById("fcf-distribution") as HTMLCanvasElement;
    if (canvas2 && data.length > 0) {
      const sorted = [...data].sort((a, b) => (b.fcf_yield || 0) - (a.fcf_yield || 0)).slice(0, 15);
      this.charts.push(new Chart(canvas2, {
        type: "bar",
        data: {
          labels: sorted.map(r => r.ticker),
          datasets: [{
            label: "FCF Yield %",
            data: sorted.map(r => r.fcf_yield || 0),
            backgroundColor: sorted.map(r => r.fcf_yield > 4 ? "rgba(99, 102, 241, 0.7)" : "rgba(100, 116, 139, 0.5)"),
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { title: { display: true, text: "FCF Yield %", color: "#94a3b8" }, grid: { color: "rgba(148, 163, 184, 0.1)" }, ticks: { color: "#94a3b8" } },
            x: { grid: { display: false }, ticks: { color: "#94a3b8" } },
          },
        },
      }));
    }

    // Margin Stability
    const canvas3 = this.shadow.getElementById("margin-stability") as HTMLCanvasElement;
    if (canvas3 && data.length > 0) {
      const top = data.slice(0, 12);
      this.charts.push(new Chart(canvas3, {
        type: "bar",
        data: {
          labels: top.map(r => r.ticker),
          datasets: [
            { label: "Gross", data: top.map(r => r.gross_margin || 0), backgroundColor: "rgba(99, 102, 241, 0.7)" },
            { label: "Operating", data: top.map(r => r.operating_margin || 0), backgroundColor: "rgba(59, 130, 246, 0.7)" },
            { label: "Net", data: top.map(r => r.net_margin || 0), backgroundColor: "rgba(139, 92, 246, 0.7)" },
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

customElements.define("antifragile-view", AntifragileView);
