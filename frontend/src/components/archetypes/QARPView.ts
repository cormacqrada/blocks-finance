/**
 * QARPView - "Quality at a Reasonable Price"
 * 
 * Pattern: Strong business, multiple doesn't expand much, returns driven by fundamentals
 * 
 * Visualizations:
 * 1. Earnings Growth vs Price CAGR - Shows price tracking fundamentals
 * 2. Multiple Flatline - P/E stable over time
 * 3. FCF Yield Trend - Yield improves as cash compounds
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

export class QARPView extends HTMLElement {
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
          { field: "gross_margin", op: ">", value: 35 },
          { field: "pe_ratio", op: "<", value: 30 },
          { field: "pe_ratio", op: ">", value: 5 },
        ],
        columns: [
          "ticker", "company_name", "price", "pe_ratio", "pb_ratio",
          "eps", "eps_growth_yoy", "revenue_growth_yoy",
          "gross_margin", "free_cash_flow", "fcf_yield", "market_cap"
        ],
        rank_by: "fcf_yield",
        rank_order: "DESC",
        limit: 30,
      });

      this.fundamentals = result.rows || [];
      this.renderCharts(this.fundamentals);
    } catch (e) {
      console.error("Failed to load QARP data:", e);
    }
  }

  private render() {
    this.shadow.innerHTML = `
      <style>
        ${SHARED_STYLES}
        :host {
          --signal-bg: rgba(59, 130, 246, 0.1);
          --signal-color: #3b82f6;
          --badge-bg: rgba(59, 130, 246, 0.15);
          --badge-color: #60a5fa;
        }
      </style>
      <div class="container">
        <div class="header">
          <h2>💎 Quality at Reasonable Price</h2>
          <span class="signal">"Pay fair, let fundamentals do the work."</span>
        </div>
        
        <div id="insights-container"></div>
        
        <div class="chart-section">
          <div class="chart-header">
            <div class="chart-title">EPS Growth vs Price Multiple</div>
            <div class="chart-explainer">
              <strong>How to read:</strong> X-axis is P/E ratio, Y-axis is EPS growth. 
              <strong>Above the diagonal = PEG < 1</strong> — growth exceeds what you're paying for.
            </div>
          </div>
          <div class="chart-container"><canvas id="growth-vs-multiple"></canvas></div>
          <div class="ticker-list" id="qarp-candidates"></div>
        </div>
        
        <div class="chart-section">
          <div class="chart-header">
            <div class="chart-title">FCF Yield Distribution</div>
            <div class="chart-explainer">
              <strong>How to read:</strong> FCF Yield = Free Cash Flow / Market Cap. 
              <strong>>5% is attractive</strong> — more cash returned per dollar invested.
            </div>
          </div>
          <div class="chart-container"><canvas id="fcf-yield"></canvas></div>
        </div>
        
        <div class="chart-section">
          <div class="chart-header">
            <div class="chart-title">Quality Metrics Overview</div>
            <div class="chart-explainer">
              <strong>How to read:</strong> Radar shows 5 quality dimensions. 
              <strong>Larger area = higher quality</strong>. Well-rounded shapes suggest balanced quality.
            </div>
          </div>
          <div class="chart-container"><canvas id="quality-radar"></canvas></div>
        </div>
      </div>
    `;
  }

  private renderCharts(data: any[]) {
    this.charts.forEach(c => c.destroy());
    this.charts = [];
    
    // Generate and render AI insights
    const insights = generateArchetypeInsights({ fundamentals: this.fundamentals, archetype: "qarp" });
    const insightsContainer = this.shadow.getElementById("insights-container");
    if (insightsContainer) insightsContainer.innerHTML = renderInsightsSection(insights);

    // Growth vs Multiple scatter
    const canvas1 = this.shadow.getElementById("growth-vs-multiple") as HTMLCanvasElement;
    if (canvas1 && data.length > 0) {
      const points = data.map(r => ({
        ticker: r.ticker,
        x: r.pe_ratio || 0,
        y: r.eps_growth_yoy || 0,
        fcf: r.fcf_yield || 0,
      })).filter(p => p.x > 0 && p.x < 50);

      // QARP candidates: growth > PE (PEG < 1 equivalent)
      const qarpCandidates = points.filter(p => p.y > p.x && p.fcf > 3);
      const candidatesEl = this.shadow.getElementById("qarp-candidates");
      if (candidatesEl) {
        candidatesEl.innerHTML = renderTickerBadges(qarpCandidates.map(c => c.ticker), 8);
      }

      this.charts.push(new Chart(canvas1, {
        type: "scatter",
        data: {
          datasets: [{
            label: "Companies",
            data: points,
            backgroundColor: points.map(p => 
              p.y > p.x ? "rgba(59, 130, 246, 0.8)" : "rgba(100, 116, 139, 0.5)"
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
                label: (ctx: any) => `${ctx.raw.ticker}: PE ${ctx.raw.x.toFixed(1)}, Growth ${ctx.raw.y.toFixed(1)}%`,
              },
            },
          },
          scales: {
            x: { title: { display: true, text: "P/E Ratio", color: "#94a3b8" }, grid: { color: "rgba(148, 163, 184, 0.1)" }, ticks: { color: "#94a3b8" } },
            y: { title: { display: true, text: "EPS Growth %", color: "#94a3b8" }, grid: { color: "rgba(148, 163, 184, 0.1)" }, ticks: { color: "#94a3b8" } },
          },
        },
      }));
    }

    // FCF Yield bar chart
    const canvas2 = this.shadow.getElementById("fcf-yield") as HTMLCanvasElement;
    if (canvas2 && data.length > 0) {
      const sorted = [...data].sort((a, b) => (b.fcf_yield || 0) - (a.fcf_yield || 0)).slice(0, 15);
      this.charts.push(new Chart(canvas2, {
        type: "bar",
        data: {
          labels: sorted.map(r => r.ticker),
          datasets: [{
            label: "FCF Yield %",
            data: sorted.map(r => r.fcf_yield || 0),
            backgroundColor: sorted.map(r => r.fcf_yield > 5 ? "rgba(59, 130, 246, 0.7)" : "rgba(100, 116, 139, 0.5)"),
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

    // Quality radar for top 5
    const canvas3 = this.shadow.getElementById("quality-radar") as HTMLCanvasElement;
    if (canvas3 && data.length > 0) {
      const top5 = data.slice(0, 5);
      const colors = ["#3b82f6", "#22c55e", "#f59e0b", "#ec4899", "#8b5cf6"];
      this.charts.push(new Chart(canvas3, {
        type: "radar",
        data: {
          labels: ["Gross Margin", "FCF Yield", "EPS Growth", "Revenue Growth", "Low PE"],
          datasets: top5.map((r, i) => ({
            label: r.ticker,
            data: [
              Math.min(100, r.gross_margin || 0),
              Math.min(100, (r.fcf_yield || 0) * 10),
              Math.min(100, Math.max(0, r.eps_growth_yoy || 0)),
              Math.min(100, Math.max(0, r.revenue_growth_yoy || 0)),
              Math.min(100, Math.max(0, 50 - (r.pe_ratio || 25))),
            ],
            borderColor: colors[i],
            backgroundColor: colors[i] + "20",
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "right", labels: { color: "#94a3b8", boxWidth: 12 } } },
          scales: { r: { grid: { color: "rgba(148, 163, 184, 0.2)" }, ticks: { display: false }, pointLabels: { color: "#94a3b8" } } },
        },
      }));
    }
  }
}

customElements.define("qarp-view", QARPView);
