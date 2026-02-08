/**
 * MacroOverviewPanel - Key Macro Economic Indicators
 * 
 * Shows real-time macro data from FRED:
 * - Treasury yields (10Y, 2Y)
 * - Yield curve spread
 * - Fed Funds Rate
 * - VIX (fear gauge)
 * - CPI and Unemployment
 */

import Chart from "chart.js/auto";

const API_BASE = (window as any).VITE_API_URL || "http://localhost:8000";

interface MacroIndicator {
  date: string;
  value: number;
  name: string;
  units: string;
}

interface MacroData {
  indicators: Record<string, MacroIndicator>;
}

const INDICATOR_CONFIG: Record<string, { icon: string; name: string; format: (v: number) => string; goodDirection?: "up" | "down" | "neutral" }> = {
  DGS10: { icon: "📊", name: "10Y Treasury", format: (v) => `${v.toFixed(2)}%`, goodDirection: "neutral" },
  DGS2: { icon: "📊", name: "2Y Treasury", format: (v) => `${v.toFixed(2)}%`, goodDirection: "neutral" },
  T10Y2Y: { icon: "📈", name: "Yield Curve", format: (v) => `${v.toFixed(2)}%`, goodDirection: "up" },
  FEDFUNDS: { icon: "🏦", name: "Fed Funds", format: (v) => `${v.toFixed(2)}%`, goodDirection: "neutral" },
  VIXCLS: { icon: "😱", name: "VIX", format: (v) => v.toFixed(1), goodDirection: "down" },
  CPIAUCSL: { icon: "💰", name: "CPI Index", format: (v) => v.toFixed(1), goodDirection: "neutral" },
  UNRATE: { icon: "👥", name: "Unemployment", format: (v) => `${v.toFixed(1)}%`, goodDirection: "down" },
};

export class MacroOverviewPanel extends HTMLElement {
  private data: MacroData | null = null;
  private yieldCurveChart: Chart | null = null;
  private isLoading = false;

  connectedCallback() {
    this.render();
    this.loadData();
  }

  disconnectedCallback() {
    this.yieldCurveChart?.destroy();
  }

  private async loadData() {
    this.isLoading = true;
    this.render();

    try {
      const resp = await fetch(`${API_BASE}/api/macro_overview`);
      if (resp.ok) {
        this.data = await resp.json();
      }
    } catch (e) {
      console.error("Failed to load macro data:", e);
    }

    this.isLoading = false;
    this.render();
    this.renderYieldCurveChart();
  }

  private async renderYieldCurveChart() {
    const canvas = this.querySelector("#yield-curve-chart") as HTMLCanvasElement;
    if (!canvas) return;

    // Fetch yield curve history
    try {
      const resp = await fetch(`${API_BASE}/api/macro/T10Y2Y?period=2y`);
      if (!resp.ok) return;
      
      const data = await resp.json();
      if (!data.data || data.data.length === 0) return;

      this.yieldCurveChart?.destroy();
      this.yieldCurveChart = new Chart(canvas, {
        type: "line",
        data: {
          labels: data.data.map((d: any) => d.date),
          datasets: [{
            label: "10Y-2Y Spread",
            data: data.data.map((d: any) => d.value),
            borderColor: data.data.map((d: any) => d.value < 0 ? "#f87171" : "#4ade80"),
            backgroundColor: "transparent",
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.1,
            segment: {
              borderColor: (ctx: any) => {
                const value = ctx.p1.parsed.y;
                return value < 0 ? "#f87171" : "#4ade80";
              },
            },
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx: any) => `${(ctx.parsed?.y ?? 0).toFixed(2)}%`
          }
        }
          },
          scales: {
            x: {
              display: false,
            },
            y: {
              grid: { color: "rgba(148, 163, 184, 0.1)" },
              ticks: { color: "#64748b", callback: (v) => `${v}%` },
            },
          },
        },
      });
    } catch (e) {
      console.error("Failed to load yield curve history:", e);
    }
  }

  private getSignalColor(key: string, value: number): string {
    if (key === "VIXCLS") {
      if (value > 30) return "#f87171"; // High fear
      if (value > 20) return "#fbbf24"; // Elevated
      return "#4ade80"; // Low fear
    }
    if (key === "T10Y2Y") {
      if (value < 0) return "#f87171"; // Inverted = recession signal
      if (value < 0.5) return "#fbbf24"; // Flat
      return "#4ade80"; // Normal
    }
    if (key === "UNRATE") {
      if (value > 6) return "#f87171";
      if (value > 4.5) return "#fbbf24";
      return "#4ade80";
    }
    return "#94a3b8";
  }

  private render() {
    const indicators = this.data?.indicators || {};

    this.innerHTML = `
      <style>
        .macro-panel {
          height: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .macro-header {
          padding: 0.75rem 1rem;
          border-bottom: 1px solid rgba(148, 163, 184, 0.15);
        }
        .macro-header h3 {
          margin: 0;
          font-size: 0.95rem;
          color: #e2e8f0;
        }
        .macro-explainer {
          font-size: 0.7rem;
          color: #64748b;
          padding: 0.5rem 1rem;
          background: rgba(30, 41, 59, 0.3);
          border-bottom: 1px solid rgba(148, 163, 184, 0.1);
        }
        .macro-content {
          flex: 1;
          overflow-y: auto;
          padding: 0.75rem;
        }
        .macro-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
          gap: 0.5rem;
        }
        .macro-card {
          background: rgba(30, 41, 59, 0.5);
          border-radius: 8px;
          padding: 0.6rem;
          text-align: center;
        }
        .macro-icon {
          font-size: 1.2rem;
          margin-bottom: 0.25rem;
        }
        .macro-name {
          font-size: 0.65rem;
          color: #64748b;
          text-transform: uppercase;
          margin-bottom: 0.25rem;
        }
        .macro-value {
          font-size: 1.1rem;
          font-weight: 600;
          color: #e2e8f0;
        }
        .macro-date {
          font-size: 0.6rem;
          color: #475569;
          margin-top: 0.25rem;
        }
        .yield-section {
          margin-top: 1rem;
          padding-top: 0.75rem;
          border-top: 1px solid rgba(148, 163, 184, 0.1);
        }
        .yield-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 0.5rem;
        }
        .yield-title {
          font-size: 0.8rem;
          font-weight: 600;
          color: #cbd5e1;
        }
        .yield-status {
          font-size: 0.7rem;
          padding: 0.15rem 0.5rem;
          border-radius: 4px;
        }
        .yield-status.inverted {
          background: rgba(239, 68, 68, 0.2);
          color: #f87171;
        }
        .yield-status.normal {
          background: rgba(34, 197, 94, 0.2);
          color: #4ade80;
        }
        .yield-chart {
          height: 120px;
          margin-top: 0.5rem;
        }
        .macro-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 200px;
          color: #64748b;
        }
        .macro-empty {
          text-align: center;
          padding: 2rem;
          color: #64748b;
          font-size: 0.8rem;
        }
      </style>

      <div class="macro-panel">
        <div class="macro-header">
          <h3>📉 Macro Overview</h3>
        </div>

        <div class="macro-explainer">
          <strong>Key indicators:</strong> Fed rates drive borrowing costs. VIX measures fear. 
          <strong>Inverted yield curve</strong> (negative spread) historically signals recession risk.
        </div>

        <div class="macro-content">
          ${this.isLoading 
            ? `<div class="macro-loading">Loading macro data...</div>`
            : Object.keys(indicators).length === 0
            ? `<div class="macro-empty">No macro data available. Run FRED ingestion to populate.</div>`
            : `
              <div class="macro-grid">
                ${Object.entries(indicators).map(([key, ind]) => {
                  const config = INDICATOR_CONFIG[key];
                  if (!config) return "";
                  return `
                    <div class="macro-card">
                      <div class="macro-icon">${config.icon}</div>
                      <div class="macro-name">${config.name}</div>
                      <div class="macro-value" style="color: ${this.getSignalColor(key, ind.value)}">${config.format(ind.value)}</div>
                      <div class="macro-date">${ind.date}</div>
                    </div>
                  `;
                }).join("")}
              </div>

              <div class="yield-section">
                <div class="yield-header">
                  <span class="yield-title">📈 Yield Curve History (2Y)</span>
                  ${indicators.T10Y2Y ? `
                    <span class="yield-status ${indicators.T10Y2Y.value < 0 ? "inverted" : "normal"}">
                      ${indicators.T10Y2Y.value < 0 ? "⚠️ Inverted" : "✓ Normal"}
                    </span>
                  ` : ""}
                </div>
                <div class="yield-chart">
                  <canvas id="yield-curve-chart"></canvas>
                </div>
              </div>
            `}
        </div>
      </div>
    `;
  }
}

customElements.define("macro-overview-panel", MacroOverviewPanel);
