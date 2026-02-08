/**
 * TorqueHeatmap - Companies × Metrics cross-reference heatmap
 * 
 * Rows = companies
 * Columns = torque signals (EPS accel, margin, leverage, FCF, multiple)
 * Color = relative strength vs universe
 * 
 * Key insight: Look for horizontal green bands (companies strong across multiple dimensions)
 */

import { fetchScreenData } from "../api/client";
import { getMetricTooltip, formatMetricName } from "../utils/metricTooltips";

export interface TorqueHeatmapConfig {
  title?: string;
  limit?: number;
  universe?: string[];
}

interface HeatmapCell {
  value: number;
  percentile: number;
  formatted: string;
}

interface HeatmapRow {
  ticker: string;
  cells: HeatmapCell[];
  avgPercentile: number;
}

const METRICS = [
  { key: "eps_growth_yoy", label: "EPS Accel", format: (v: number) => `${v.toFixed(1)}%` },
  { key: "gross_margin", label: "Margin", format: (v: number) => `${v.toFixed(1)}%` },
  { key: "operating_margin", label: "Op Leverage", format: (v: number) => `${v.toFixed(1)}%` },
  { key: "fcf_yield", label: "FCF Yield", format: (v: number) => `${v.toFixed(1)}%` },
  { key: "revenue_growth_yoy", label: "Rev Growth", format: (v: number) => `${v.toFixed(1)}%` },
  { key: "pe_ratio", label: "P/E", format: (v: number) => `${v.toFixed(1)}x`, invert: true },
];

export class TorqueHeatmap extends HTMLElement {
  private shadow: ShadowRoot;
  private config: TorqueHeatmapConfig = {};
  private data: HeatmapRow[] = [];

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
    try {
      const result = await fetchScreenData({
        filters: [],
        columns: ["ticker", ...METRICS.map(m => m.key)],
        formulas: [],
        rank_by: "eps_growth_yoy",
        rank_order: "DESC",
        limit: this.config.limit || 30,
      });

      const rows = result.rows;
      
      // Calculate percentiles for each metric
      const percentilesByMetric: number[][] = METRICS.map((metric, mIdx) => {
        const values = rows.map((r: any) => r[metric.key] || 0);
        const sorted = [...values].sort((a, b) => 
          (metric as any).invert ? b - a : a - b // For P/E, lower is better
        );
        return values.map(v => {
          const idx = sorted.indexOf(v);
          return Math.round((idx / Math.max(sorted.length - 1, 1)) * 100);
        });
      });

      // Build heatmap data
      this.data = rows.map((row: any, rowIdx: number) => {
        const cells: HeatmapCell[] = METRICS.map((metric, mIdx) => {
          const value = row[metric.key] || 0;
          return {
            value,
            percentile: percentilesByMetric[mIdx][rowIdx],
            formatted: metric.format(value),
          };
        });
        
        const avgPercentile = Math.round(
          cells.reduce((sum, c) => sum + c.percentile, 0) / cells.length
        );

        return {
          ticker: row.ticker,
          cells,
          avgPercentile,
        };
      });

      // Sort by average percentile (best overall at top)
      this.data.sort((a, b) => b.avgPercentile - a.avgPercentile);

      this.renderHeatmap();
      this.setupTooltips();
    } catch (e) {
      console.error("Failed to fetch heatmap data:", e);
    }
  }

  private getCellColor(percentile: number): string {
    // Green to red gradient based on percentile
    if (percentile >= 80) return "rgba(74, 222, 128, 0.6)";
    if (percentile >= 60) return "rgba(163, 230, 53, 0.5)";
    if (percentile >= 40) return "rgba(251, 191, 36, 0.4)";
    if (percentile >= 20) return "rgba(251, 146, 60, 0.4)";
    return "rgba(248, 113, 113, 0.4)";
  }

  private renderHeatmap() {
    const container = this.shadow.getElementById("heatmap-body");
    if (!container) return;

    container.innerHTML = this.data.map((row, idx) => `
      <div class="heatmap-row ${row.avgPercentile >= 70 ? 'highlight-row' : ''}">
        <div class="row-rank">${idx + 1}</div>
        <div class="row-ticker"><span class="ticker-link" data-ticker="${row.ticker}">${row.ticker}</span></div>
        ${row.cells.map(cell => `
          <div class="heatmap-cell" style="background: ${this.getCellColor(cell.percentile)}">
            <span class="cell-value">${cell.formatted}</span>
            <span class="cell-pct">${cell.percentile}%</span>
          </div>
        `).join("")}
        <div class="row-avg" style="background: ${this.getCellColor(row.avgPercentile)}">
          ${row.avgPercentile}
        </div>
      </div>
    `).join("");
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
          gap: 0.5rem;
          font-size: 0.65rem;
          color: #94a3b8;
        }
        
        .legend-item {
          display: flex;
          align-items: center;
          gap: 0.2rem;
        }
        
        .legend-color {
          width: 12px;
          height: 12px;
          border-radius: 2px;
        }
        
        .heatmap-container {
          overflow-x: auto;
          max-height: 600px;
          overflow-y: auto;
        }
        
        .heatmap-header {
          display: grid;
          grid-template-columns: 40px 70px repeat(${METRICS.length}, 1fr) 50px;
          gap: 2px;
          padding: 0.5rem;
          background: rgba(15, 23, 42, 0.8);
          position: sticky;
          top: 0;
          z-index: 1;
        }
        
        .header-cell {
          font-size: 0.65rem;
          font-weight: 600;
          color: #64748b;
          text-transform: uppercase;
          text-align: center;
          padding: 0.3rem;
          cursor: help;
        }
        
        .header-cell:hover {
          color: #94a3b8;
        }
        
        /* Tooltip */
        .metric-tooltip-host {
          position: fixed;
          z-index: 10000;
          max-width: 320px;
          padding: 0.75rem;
          background: rgba(15, 23, 42, 0.98);
          border: 1px solid rgba(148,163,184,0.3);
          border-radius: 8px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.4);
          font-size: 0.75rem;
          pointer-events: none;
          display: none;
        }
        .metric-tooltip-host.visible {
          display: block;
        }
        .metric-tooltip-name {
          font-weight: 600;
          color: #e2e8f0;
          margin-bottom: 0.25rem;
        }
        .metric-tooltip-desc {
          color: #94a3b8;
          margin-bottom: 0.35rem;
        }
        .metric-tooltip-interp {
          color: #cbd5e1;
          font-style: italic;
          margin-bottom: 0.35rem;
        }
        .metric-tooltip-formula {
          color: #4ade80;
          font-family: 'SF Mono', monospace;
          font-size: 0.7rem;
          background: rgba(74, 222, 128, 0.1);
          padding: 0.2rem 0.4rem;
          border-radius: 4px;
          margin-bottom: 0.25rem;
        }
        .metric-tooltip-range {
          color: #fbbf24;
          font-size: 0.7rem;
        }
        
        .heatmap-body {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 0.5rem;
        }
        
        .heatmap-row {
          display: grid;
          grid-template-columns: 40px 70px repeat(${METRICS.length}, 1fr) 50px;
          gap: 2px;
          align-items: center;
          border-radius: 4px;
          transition: all 0.15s ease;
        }
        
        .heatmap-row:hover {
          transform: scale(1.01);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        }
        
        .heatmap-row.highlight-row {
          outline: 1px solid rgba(74, 222, 128, 0.3);
        }
        
        .row-rank {
          font-size: 0.7rem;
          font-weight: 600;
          color: #64748b;
          text-align: center;
        }
        
        .row-ticker {
          font-size: 0.8rem;
          font-weight: 600;
          color: #e2e8f0;
          padding: 0 0.3rem;
        }
        
        .ticker-link {
          color: inherit;
          cursor: pointer;
          text-decoration: none;
          transition: all 0.15s ease;
        }
        
        .ticker-link:hover {
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        
        .heatmap-cell {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 0.4rem;
          border-radius: 4px;
          min-height: 36px;
        }
        
        .cell-value {
          font-size: 0.75rem;
          font-weight: 600;
          color: #e2e8f0;
        }
        
        .cell-pct {
          font-size: 0.6rem;
          color: rgba(255, 255, 255, 0.6);
        }
        
        .row-avg {
          font-size: 0.75rem;
          font-weight: 700;
          color: #e2e8f0;
          text-align: center;
          padding: 0.4rem;
          border-radius: 4px;
        }
        
        .insight {
          padding: 0.75rem 1rem;
          background: rgba(30, 41, 59, 0.4);
          border-top: 1px solid rgba(148, 163, 184, 0.1);
          font-size: 0.75rem;
          color: #94a3b8;
        }
        
        .insight strong {
          color: #e2e8f0;
        }
      </style>
      
      <div class="metric-tooltip-host" id="tooltip-host"></div>
      
      <div class="container">
        <div class="header">
          <span class="title">${this.config.title || "Torque Heatmap: Companies × Metrics"}</span>
          <div class="legend">
            <div class="legend-item">
              <div class="legend-color" style="background: rgba(74, 222, 128, 0.6)"></div>
              80%+
            </div>
            <div class="legend-item">
              <div class="legend-color" style="background: rgba(163, 230, 53, 0.5)"></div>
              60%+
            </div>
            <div class="legend-item">
              <div class="legend-color" style="background: rgba(251, 191, 36, 0.4)"></div>
              40%+
            </div>
            <div class="legend-item">
              <div class="legend-color" style="background: rgba(248, 113, 113, 0.4)"></div>
              &lt;20%
            </div>
          </div>
        </div>
        
        <div class="heatmap-container">
          <div class="heatmap-header">
            <div class="header-cell">#</div>
            <div class="header-cell">Ticker</div>
            ${METRICS.map(m => `<div class="header-cell" data-metric="${m.key}">${m.label}</div>`).join("")}
            <div class="header-cell">Avg</div>
          </div>
          
          <div class="heatmap-body" id="heatmap-body">
            <div style="text-align: center; color: #64748b; padding: 2rem; grid-column: 1 / -1;">
              Loading...
            </div>
          </div>
        </div>
        
        <div class="insight">
          <strong>Tip:</strong> Look for horizontal green bands — companies strong across multiple dimensions have the highest torque potential.
        </div>
      </div>
    `;
  }

  private setupTooltips() {
    const tooltipHost = this.shadow.getElementById("tooltip-host");
    if (!tooltipHost) return;
    
    this.shadow.querySelectorAll(".header-cell[data-metric]").forEach(cell => {
      const metric = cell.getAttribute("data-metric");
      if (!metric) return;
      
      cell.addEventListener("mouseenter", (e) => {
        tooltipHost.innerHTML = getMetricTooltip(metric);
        tooltipHost.classList.add("visible");
        
        const rect = (e.target as HTMLElement).getBoundingClientRect();
        tooltipHost.style.left = `${rect.left}px`;
        tooltipHost.style.top = `${rect.bottom + 8}px`;
      });
      
      cell.addEventListener("mouseleave", () => {
        tooltipHost.classList.remove("visible");
      });
    });
    
    // Ticker click handlers
    this.shadow.querySelectorAll(".ticker-link").forEach(link => {
      link.addEventListener("click", (e) => {
        const ticker = (e.target as HTMLElement).getAttribute("data-ticker");
        if (ticker) {
          this.dispatchEvent(new CustomEvent("navigate-stock", {
            detail: { ticker },
            bubbles: true,
            composed: true,
          }));
        }
      });
    });
  }
}

customElements.define("torque-heatmap", TorqueHeatmap);
