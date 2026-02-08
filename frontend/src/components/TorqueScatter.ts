/**
 * TorqueScatter - Primary torque finder visualization
 * 
 * X-axis: EPS QoQ acceleration (earnings momentum)
 * Y-axis: Valuation multiple (P/E or EV/EBITDA)
 * Color: Margin trend (green improving, red declining)
 * Size: Operating leverage
 * 
 * Key insight: Top-left quadrant = improving earnings + still cheap = TORQUE
 */

import Chart from "chart.js/auto";
import { fetchScreenData, type ScreenFilter } from "../api/client";

export interface TorqueScatterConfig {
  title?: string;
  valuationMetric?: "pe_ratio" | "ev_to_ebitda";
  universe?: string[];
  limit?: number;
}

interface DataPoint {
  ticker: string;
  x: number; // EPS acceleration
  y: number; // Valuation
  marginTrend: number; // For color
  opLeverage: number; // For size
  raw: Record<string, any>;
}

export class TorqueScatter extends HTMLElement {
  private shadow: ShadowRoot;
  private chart: Chart | null = null;
  private config: TorqueScatterConfig = {};
  private data: DataPoint[] = [];
  private selectedTicker: string | null = null;

  static get observedAttributes() {
    return ["config"];
  }

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.render();
    this.fetchData();
  }

  disconnectedCallback() {
    this.chart?.destroy();
  }

  attributeChangedCallback(name: string, _old: string, value: string) {
    if (name === "config" && value) {
      try {
        this.config = JSON.parse(value);
        this.fetchData();
      } catch (e) {
        console.error("Invalid config:", e);
      }
    }
  }

  private async fetchData() {
    const valMetric = this.config.valuationMetric || "pe_ratio";
    
    try {
      const result = await fetchScreenData({
        filters: [],
        columns: [
          "ticker", "price", valMetric, "eps_growth_yoy", 
          "gross_margin", "operating_margin", "revenue_growth_yoy",
          "debt_to_equity", "market_cap"
        ],
        formulas: [],
        rank_by: "eps_growth_yoy",
        rank_order: "DESC",
        limit: this.config.limit || 50,
      });

      // Transform to scatter data points
      this.data = result.rows.map((row: any) => {
        const epsAccel = row.eps_growth_yoy || 0;
        const valuation = row[valMetric] || 0;
        // Margin trend: approximate with gross margin level (would need historical for true trend)
        const marginTrend = (row.gross_margin || 0) - 30; // Centered around 30%
        // Operating leverage: revenue growth vs margin (simplified)
        const opLeverage = Math.abs(row.operating_margin || 0) / 10;
        
        return {
          ticker: row.ticker,
          x: epsAccel,
          y: valuation,
          marginTrend,
          opLeverage: Math.max(3, Math.min(opLeverage * 3, 20)),
          raw: row,
        };
      });

      this.renderChart();
    } catch (e) {
      console.error("Failed to fetch torque data:", e);
    }
  }

  private getPointColor(marginTrend: number): string {
    if (marginTrend > 10) return "rgba(74, 222, 128, 0.8)"; // Green - improving
    if (marginTrend > 0) return "rgba(163, 230, 53, 0.7)"; // Light green
    if (marginTrend > -10) return "rgba(251, 191, 36, 0.7)"; // Yellow - flat
    return "rgba(248, 113, 113, 0.7)"; // Red - declining
  }

  private renderChart() {
    const canvas = this.shadow.getElementById("chart") as HTMLCanvasElement;
    if (!canvas) return;

    this.chart?.destroy();

    const valLabel = this.config.valuationMetric === "ev_to_ebitda" ? "EV/EBITDA" : "P/E Ratio";

    this.chart = new Chart(canvas, {
      type: "scatter",
      data: {
        datasets: [{
          label: "Companies",
          data: this.data.map(d => ({
            x: d.x,
            y: d.y,
            ticker: d.ticker,
            raw: d.raw,
          })),
          backgroundColor: this.data.map(d => this.getPointColor(d.marginTrend)),
          borderColor: this.data.map(d => this.getPointColor(d.marginTrend).replace("0.8", "1").replace("0.7", "1")),
          borderWidth: 1,
          pointRadius: this.data.map(d => d.opLeverage),
          pointHoverRadius: this.data.map(d => d.opLeverage + 3),
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
                const point = ctx.raw;
                return [
                  `${point.ticker}`,
                  `EPS Growth: ${point.x.toFixed(1)}%`,
                  `${valLabel}: ${point.y.toFixed(1)}x`,
                ];
              },
            },
            backgroundColor: "rgba(15, 23, 42, 0.95)",
            titleColor: "#e2e8f0",
            bodyColor: "#94a3b8",
            padding: 12,
            cornerRadius: 8,
          },
        },
        scales: {
          x: {
            title: {
              display: true,
              text: "EPS Growth YoY (%)",
              color: "#94a3b8",
              font: { size: 11 },
            },
            grid: {
              color: "rgba(148, 163, 184, 0.1)",
            },
            ticks: { color: "#64748b" },
          },
          y: {
            title: {
              display: true,
              text: valLabel,
              color: "#94a3b8",
              font: { size: 11 },
            },
            grid: {
              color: "rgba(148, 163, 184, 0.1)",
            },
            ticks: { color: "#64748b" },
            reverse: true, // Lower P/E at top (better value)
          },
        },
        onClick: (_event: any, elements: any[]) => {
          if (elements.length > 0) {
            const idx = elements[0].index;
            const ticker = this.data[idx].ticker;
            this.selectedTicker = ticker;
            this.dispatchEvent(new CustomEvent("ticker-select", {
              detail: { ticker, data: this.data[idx].raw },
              bubbles: true,
            }));
            this.renderDetails();
          }
        },
      },
    });

    // Draw quadrant lines
    this.drawQuadrantOverlay();
  }

  private drawQuadrantOverlay() {
    // Add quadrant annotations (would need chart.js annotation plugin for proper implementation)
    const overlay = this.shadow.getElementById("quadrant-overlay");
    if (overlay) {
      // Y-axis is REVERSED (low P/E at top), X-axis has high EPS to right
      // So: top-right = high EPS + low P/E = TORQUE ZONE
      overlay.innerHTML = `
        <div class="quadrant top-left">💤 VALUE TRAP?<br><span>Low growth + Low P/E</span></div>
        <div class="quadrant top-right torque-zone">🎯 TORQUE ZONE<br><span>High growth + Low P/E</span></div>
        <div class="quadrant bottom-left">🚫 AVOID<br><span>Low growth + High P/E</span></div>
        <div class="quadrant bottom-right">⚠️ EXPENSIVE GROWTH<br><span>High growth + High P/E</span></div>
      `;
    }
  }

  private renderDetails() {
    const details = this.shadow.getElementById("details");
    if (!details || !this.selectedTicker) return;

    const point = this.data.find(d => d.ticker === this.selectedTicker);
    if (!point) return;

    const r = point.raw;
    details.innerHTML = `
      <div class="detail-header">
        <span class="detail-ticker">${point.ticker}</span>
        <span class="detail-price">$${r.price?.toFixed(2) || "—"}</span>
      </div>
      <div class="detail-grid">
        <div class="detail-item">
          <span class="detail-label">EPS Growth</span>
          <span class="detail-value ${r.eps_growth_yoy > 0 ? 'positive' : 'negative'}">${r.eps_growth_yoy?.toFixed(1)}%</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">P/E Ratio</span>
          <span class="detail-value">${r.pe_ratio?.toFixed(1)}x</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Gross Margin</span>
          <span class="detail-value">${r.gross_margin?.toFixed(1)}%</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Op Margin</span>
          <span class="detail-value">${r.operating_margin?.toFixed(1)}%</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Revenue Growth</span>
          <span class="detail-value ${r.revenue_growth_yoy > 0 ? 'positive' : 'negative'}">${r.revenue_growth_yoy?.toFixed(1)}%</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Market Cap</span>
          <span class="detail-value">$${(r.market_cap / 1e9).toFixed(1)}B</span>
        </div>
      </div>
    `;
  }

  private render() {
    this.shadow.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: system-ui, -apple-system, sans-serif;
        }
        
        .container {
          background: rgba(15, 23, 42, 0.7);
          border: 1px solid rgba(148, 163, 184, 0.25);
          border-radius: 10px;
          overflow: hidden;
        }
        
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.75rem 1rem;
          background: rgba(15, 23, 42, 0.5);
          border-bottom: 1px solid rgba(148, 163, 184, 0.15);
        }
        
        .title {
          font-size: 0.9rem;
          font-weight: 600;
          color: #e2e8f0;
        }
        
        .legend {
          display: flex;
          gap: 1rem;
          font-size: 0.7rem;
          color: #94a3b8;
        }
        
        .legend-item {
          display: flex;
          align-items: center;
          gap: 0.3rem;
        }
        
        .legend-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        
        .legend-dot.green { background: rgba(74, 222, 128, 0.8); }
        .legend-dot.yellow { background: rgba(251, 191, 36, 0.7); }
        .legend-dot.red { background: rgba(248, 113, 113, 0.7); }
        
        .chart-container {
          position: relative;
          height: 400px;
          padding: 1rem;
        }
        
        #quadrant-overlay {
          position: absolute;
          inset: 1rem;
          pointer-events: none;
          display: grid;
          grid-template-columns: 1fr 1fr;
          grid-template-rows: 1fr 1fr;
        }
        
        .quadrant {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          font-size: 0.7rem;
          font-weight: 600;
          color: rgba(148, 163, 184, 0.3);
          text-align: center;
        }
        
        .quadrant span {
          font-size: 0.6rem;
          font-weight: 400;
        }
        
        .quadrant.torque-zone {
          color: rgba(74, 222, 128, 0.5);
          background: rgba(74, 222, 128, 0.03);
          border-radius: 8px;
        }
        
        #details {
          padding: 0.75rem 1rem;
          border-top: 1px solid rgba(148, 163, 184, 0.15);
          min-height: 80px;
        }
        
        .detail-header {
          display: flex;
          align-items: baseline;
          gap: 0.75rem;
          margin-bottom: 0.5rem;
        }
        
        .detail-ticker {
          font-size: 1rem;
          font-weight: 700;
          color: #e2e8f0;
        }
        
        .detail-price {
          font-size: 0.85rem;
          color: #94a3b8;
        }
        
        .detail-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
          gap: 0.5rem;
        }
        
        .detail-item {
          display: flex;
          flex-direction: column;
          gap: 0.1rem;
        }
        
        .detail-label {
          font-size: 0.65rem;
          color: #64748b;
          text-transform: uppercase;
        }
        
        .detail-value {
          font-size: 0.85rem;
          font-weight: 600;
          color: #e2e8f0;
          font-family: 'SF Mono', monospace;
        }
        
        .detail-value.positive { color: #4ade80; }
        .detail-value.negative { color: #f87171; }
        
        .empty-details {
          color: #64748b;
          font-size: 0.8rem;
          text-align: center;
          padding: 1.5rem;
        }
      </style>
      
      <div class="container">
        <div class="header">
          <span class="title">${this.config.title || "Torque Scatter: Earnings Acceleration vs Valuation"}</span>
          <div class="legend">
            <div class="legend-item"><span class="legend-dot green"></span> Margin ↑</div>
            <div class="legend-item"><span class="legend-dot yellow"></span> Flat</div>
            <div class="legend-item"><span class="legend-dot red"></span> Margin ↓</div>
            <div class="legend-item" style="margin-left: 0.5rem;">Size = Op Leverage</div>
          </div>
        </div>
        
        <div class="chart-container">
          <div id="quadrant-overlay"></div>
          <canvas id="chart"></canvas>
        </div>
        
        <div id="details">
          <div class="empty-details">Click a point to see details</div>
        </div>
      </div>
    `;
  }
}

customElements.define("torque-scatter", TorqueScatter);
