/**
 * CapitalAllocatorsView - "Capital Allocation Winners"
 * 
 * Pattern: Buybacks, M&A, spin-offs done well. Per-share metrics accelerate.
 * 
 * Visualizations:
 * 1. Per-Share vs Absolute Earnings - Share count declining = EPS boost
 * 2. FCF Yield vs Payout - How cash is being returned
 * 3. Capital Efficiency Matrix - FCF per share vs reinvestment
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

export class CapitalAllocatorsView extends HTMLElement {
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
          { field: "free_cash_flow", op: ">", value: 0 },
        ],
        columns: [
          "ticker", "company_name", "price", "pe_ratio",
          "eps", "eps_growth_yoy", "free_cash_flow", "fcf_yield",
          "shares_outstanding", "market_cap", "payout_ratio",
          "dividend_yield", "revenue", "net_margin"
        ],
        rank_by: "fcf_yield",
        rank_order: "DESC",
        limit: 30,
      });

      this.fundamentals = result.rows || [];
      this.renderCharts(this.fundamentals);
    } catch (e) {
      console.error("Failed to load capital allocators data:", e);
    }
  }

  private render() {
    this.shadow.innerHTML = `
      <style>
        ${SHARED_STYLES}
        :host {
          --signal-bg: rgba(236, 72, 153, 0.1);
          --signal-color: #ec4899;
          --badge-bg: rgba(236, 72, 153, 0.15);
          --badge-color: #f472b6;
        }
      </style>
      <div class="container">
        <div class="header">
          <h2>💰 Capital Allocators</h2>
          <span class="signal">"Per-share value compounds through smart capital deployment."</span>
        </div>
        
        <div id="insights-container"></div>
        
        <div class="chart-section">
          <div class="chart-header">
            <div class="chart-title">FCF Yield vs Shareholder Return</div>
            <div class="chart-explainer">
              <strong>How to read:</strong> X-axis is FCF yield, Y-axis is total return yield.
              <strong>Top-right = best allocators</strong> — high cash generation returned to shareholders.
            </div>
          </div>
          <div class="chart-container"><canvas id="fcf-return"></canvas></div>
          <div class="ticker-list" id="allocator-candidates"></div>
        </div>
        
        <div class="chart-section">
          <div class="chart-header">
            <div class="chart-title">FCF per Market Cap</div>
            <div class="chart-explainer">
              <strong>How to read:</strong> FCF yield = annual free cash flow / market cap.
              <strong>>5% is attractive</strong> — company generates significant cash relative to price.
            </div>
          </div>
          <div class="chart-container"><canvas id="fcf-per-cap"></canvas></div>
        </div>
        
        <div class="chart-section">
          <div class="chart-header">
            <div class="chart-title">Capital Return Mix</div>
            <div class="chart-explainer">
              <strong>How to read:</strong> Stacked bars show dividends vs implied buybacks.
              <strong>Both components growing</strong> = balanced shareholder-friendly approach.
            </div>
          </div>
          <div class="chart-container"><canvas id="return-mix"></canvas></div>
        </div>
      </div>
    `;
  }

  private renderCharts(data: any[]) {
    this.charts.forEach(c => c.destroy());
    this.charts = [];
    
    // Generate and render AI insights
    const insights = generateArchetypeInsights({ fundamentals: this.fundamentals, archetype: "capital-allocators" });
    const insightsContainer = this.shadow.getElementById("insights-container");
    if (insightsContainer) insightsContainer.innerHTML = renderInsightsSection(insights);

    // FCF Yield vs Shareholder Return
    const canvas1 = this.shadow.getElementById("fcf-return") as HTMLCanvasElement;
    if (canvas1 && data.length > 0) {
      const points = data.map(r => ({
        ticker: r.ticker,
        x: r.fcf_yield || 0,
        y: (r.dividend_yield || 0) + Math.max(0, (r.fcf_yield || 0) - (r.dividend_yield || 0) - (r.payout_ratio || 0) / 10),
        fcf: r.free_cash_flow || 0,
      })).filter(p => p.x > 0 && p.x < 20);

      // Top allocators: high FCF yield with good return
      const candidates = points.filter(p => p.x > 5 && p.y > 3);
      const candidatesEl = this.shadow.getElementById("allocator-candidates");
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
              p.x > 5 ? "rgba(236, 72, 153, 0.8)" : "rgba(100, 116, 139, 0.5)"
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
                label: (ctx: any) => `${ctx.raw.ticker}: FCF Yield ${ctx.raw.x.toFixed(1)}%, Return ${ctx.raw.y.toFixed(1)}%`,
              },
            },
          },
          scales: {
            x: { title: { display: true, text: "FCF Yield %", color: "#94a3b8" }, grid: { color: "rgba(148, 163, 184, 0.1)" }, ticks: { color: "#94a3b8" } },
            y: { title: { display: true, text: "Total Return Yield %", color: "#94a3b8" }, grid: { color: "rgba(148, 163, 184, 0.1)" }, ticks: { color: "#94a3b8" } },
          },
        },
      }));
    }

    // FCF per Market Cap bar
    const canvas2 = this.shadow.getElementById("fcf-per-cap") as HTMLCanvasElement;
    if (canvas2 && data.length > 0) {
      const sorted = [...data].sort((a, b) => (b.fcf_yield || 0) - (a.fcf_yield || 0)).slice(0, 15);
      this.charts.push(new Chart(canvas2, {
        type: "bar",
        data: {
          labels: sorted.map(r => r.ticker),
          datasets: [{
            label: "FCF Yield %",
            data: sorted.map(r => r.fcf_yield || 0),
            backgroundColor: sorted.map(r => r.fcf_yield > 5 ? "rgba(236, 72, 153, 0.7)" : "rgba(100, 116, 139, 0.5)"),
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

    // Capital Return Mix - stacked bar
    const canvas3 = this.shadow.getElementById("return-mix") as HTMLCanvasElement;
    if (canvas3 && data.length > 0) {
      const top = data.filter(r => r.fcf_yield > 3).slice(0, 12);
      this.charts.push(new Chart(canvas3, {
        type: "bar",
        data: {
          labels: top.map(r => r.ticker),
          datasets: [
            {
              label: "Dividend Yield",
              data: top.map(r => r.dividend_yield || 0),
              backgroundColor: "rgba(236, 72, 153, 0.7)",
            },
            {
              label: "Implied Buyback",
              data: top.map(r => Math.max(0, (r.fcf_yield || 0) - (r.dividend_yield || 0))),
              backgroundColor: "rgba(139, 92, 246, 0.7)",
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "top", labels: { color: "#94a3b8", boxWidth: 12 } } },
          scales: {
            x: { stacked: true, grid: { display: false }, ticks: { color: "#94a3b8" } },
            y: { stacked: true, title: { display: true, text: "Yield %", color: "#94a3b8" }, grid: { color: "rgba(148, 163, 184, 0.1)" }, ticks: { color: "#94a3b8" } },
          },
        },
      }));
    }
  }
}

customElements.define("capital-allocators-view", CapitalAllocatorsView);
