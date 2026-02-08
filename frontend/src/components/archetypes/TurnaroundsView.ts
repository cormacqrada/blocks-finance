/**
 * TurnaroundsView - "Non-Linear, Risky"
 * 
 * Pattern: Bad business getting less bad, balance sheet + margins stabilize
 * 
 * Visualizations:
 * 1. Margin Trough → Recovery Line
 * 2. Net Debt / EBITDA Cliff
 * 3. Cash Burn → Cash Generation Flip
 * 
 * Signal: "Survival risk collapses."
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

export class TurnaroundsView extends HTMLElement {
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
      // Look for potential turnarounds: low margins but improving, or high debt being reduced
      const result = await fetchScreenData({
        filters: [],
        columns: [
          "ticker", "company_name", "price", "pe_ratio",
          "gross_margin", "operating_margin", "net_margin",
          "debt_to_equity", "interest_coverage", "free_cash_flow",
          "revenue_growth_yoy", "eps_growth_yoy", "total_debt", "ebit"
        ],
        rank_by: "eps_growth_yoy",
        rank_order: "DESC",
        limit: 30,
      });

      this.fundamentals = result.rows || [];
      this.renderCharts(this.fundamentals);
    } catch (e) {
      console.error("Failed to load turnaround data:", e);
    }
  }

  private render() {
    this.shadow.innerHTML = `
      <style>
        ${SHARED_STYLES}
        :host {
          --signal-bg: rgba(245, 158, 11, 0.1);
          --signal-color: #f59e0b;
          --badge-bg: rgba(245, 158, 11, 0.15);
          --badge-color: #fbbf24;
        }
        .warning { 
          background: rgba(239, 68, 68, 0.1); 
          border-left: 3px solid #ef4444; 
          padding: 0.5rem 0.75rem; 
          border-radius: 4px;
          font-size: 0.75rem; 
          color: #fca5a5; 
        }
      </style>
      <div class="container">
        <div class="header">
          <h2>🔄 Turnarounds</h2>
          <span class="signal">"Survival risk collapses."</span>
        </div>
        
        <div class="warning">⚠️ Turnarounds are high-risk. Many fail. Position sizing matters.</div>
        
        <div id="insights-container"></div>
        
        <div class="chart-section">
          <div class="chart-header">
            <div class="chart-title">Leverage vs Coverage</div>
            <div class="chart-explainer">
              <strong>How to read:</strong> X-axis is Debt/Equity, Y-axis is Interest Coverage.
              <strong>Bottom-right = danger</strong> (high debt, can't cover interest). 
              <strong>Top-left = safer</strong> turnaround.
            </div>
          </div>
          <div class="chart-container"><canvas id="leverage-coverage"></canvas></div>
          <div class="ticker-list" id="turnaround-candidates"></div>
        </div>
        
        <div class="chart-section">
          <div class="chart-header">
            <div class="chart-title">Margin Profile</div>
            <div class="chart-explainer">
              <strong>How to read:</strong> Stacked bars show gross/operating/net margins.
              <strong>Widening spreads</strong> suggest operational improvement underway.
            </div>
          </div>
          <div class="chart-container"><canvas id="margin-profile"></canvas></div>
        </div>
        
        <div class="chart-section">
          <div class="chart-header">
            <div class="chart-title">Cash Flow Status</div>
            <div class="chart-explainer">
              <strong>How to read:</strong> Green bars = positive FCF (cash generation).
              Red = cash burn. <strong>The flip from red to green</strong> is the turnaround signal.
            </div>
          </div>
          <div class="chart-container"><canvas id="cash-flow-status"></canvas></div>
        </div>
      </div>
    `;
  }

  private renderCharts(data: any[]) {
    this.charts.forEach(c => c.destroy());
    this.charts = [];
    
    // Generate and render AI insights
    const insights = generateArchetypeInsights({ fundamentals: this.fundamentals, archetype: "turnarounds" });
    const insightsContainer = this.shadow.getElementById("insights-container");
    if (insightsContainer) insightsContainer.innerHTML = renderInsightsSection(insights);

    // Leverage vs Coverage scatter
    const canvas1 = this.shadow.getElementById("leverage-coverage") as HTMLCanvasElement;
    if (canvas1 && data.length > 0) {
      const points = data
        .filter(r => r.debt_to_equity !== undefined && r.interest_coverage !== undefined)
        .map(r => ({
          ticker: r.ticker,
          x: Math.min(5, r.debt_to_equity || 0),
          y: Math.min(20, Math.max(-5, r.interest_coverage || 0)),
          fcf: r.free_cash_flow || 0,
          epsGrowth: r.eps_growth_yoy || 0,
        }));

      // Turnaround candidates: improving (high EPS growth) with manageable debt
      const candidates = points.filter(p => p.epsGrowth > 20 && p.x < 2 && p.y > 2);
      const candidatesEl = this.shadow.getElementById("turnaround-candidates");
      if (candidatesEl) {
        candidatesEl.innerHTML = renderTickerBadges(candidates.map(c => c.ticker), 8);
      }

      this.charts.push(new Chart(canvas1, {
        type: "scatter",
        data: {
          datasets: [{
            label: "Companies",
            data: points,
            backgroundColor: points.map(p => {
              if (p.x < 1 && p.y > 5) return "rgba(34, 197, 94, 0.8)"; // Safe
              if (p.x > 2 || p.y < 2) return "rgba(239, 68, 68, 0.8)"; // Risky
              return "rgba(245, 158, 11, 0.8)"; // Potential
            }),
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
            x: { title: { display: true, text: "Debt/Equity", color: "#94a3b8" }, min: 0, max: 5, grid: { color: "rgba(148, 163, 184, 0.1)" }, ticks: { color: "#94a3b8" } },
            y: { title: { display: true, text: "Interest Coverage", color: "#94a3b8" }, grid: { color: "rgba(148, 163, 184, 0.1)" }, ticks: { color: "#94a3b8" } },
          },
        },
      }));
    }

    // Margin profile
    const canvas2 = this.shadow.getElementById("margin-profile") as HTMLCanvasElement;
    if (canvas2 && data.length > 0) {
      const sorted = [...data].sort((a, b) => (b.eps_growth_yoy || 0) - (a.eps_growth_yoy || 0)).slice(0, 12);
      this.charts.push(new Chart(canvas2, {
        type: "bar",
        data: {
          labels: sorted.map(r => r.ticker),
          datasets: [
            { label: "Gross", data: sorted.map(r => r.gross_margin || 0), backgroundColor: "rgba(34, 197, 94, 0.7)" },
            { label: "Operating", data: sorted.map(r => r.operating_margin || 0), backgroundColor: "rgba(59, 130, 246, 0.7)" },
            { label: "Net", data: sorted.map(r => r.net_margin || 0), backgroundColor: "rgba(139, 92, 246, 0.7)" },
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

    // Cash flow status
    const canvas3 = this.shadow.getElementById("cash-flow-status") as HTMLCanvasElement;
    if (canvas3 && data.length > 0) {
      const sorted = [...data].sort((a, b) => (b.free_cash_flow || 0) - (a.free_cash_flow || 0));
      const fcfData = sorted.slice(0, 15).map(r => ({
        ticker: r.ticker,
        fcf: (r.free_cash_flow || 0) / 1e9, // In billions
      }));

      this.charts.push(new Chart(canvas3, {
        type: "bar",
        data: {
          labels: fcfData.map(d => d.ticker),
          datasets: [{
            label: "FCF ($B)",
            data: fcfData.map(d => d.fcf),
            backgroundColor: fcfData.map(d => d.fcf > 0 ? "rgba(34, 197, 94, 0.7)" : "rgba(239, 68, 68, 0.7)"),
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { title: { display: true, text: "FCF ($B)", color: "#94a3b8" }, grid: { color: "rgba(148, 163, 184, 0.1)" }, ticks: { color: "#94a3b8" } },
            x: { grid: { display: false }, ticks: { color: "#94a3b8" } },
          },
        },
      }));
    }
  }
}

customElements.define("turnarounds-view", TurnaroundsView);
