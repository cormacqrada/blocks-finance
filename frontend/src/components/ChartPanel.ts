/**
 * ChartPanel - Chart.js based visualization panel for financial metrics.
 * 
 * Features:
 * - Multiple chart types (bar, line, scatter)
 * - Compare metrics across tickers
 * - Visualize formula results
 * - Interactive tooltips and legends
 */

import { Chart, registerables } from "chart.js";
import { evaluateFormula, fetchFormulas, type Formula } from "../api/client";

// Register all Chart.js components
Chart.register(...registerables);

export interface ChartConfig {
  type: "bar" | "line" | "scatter" | "radar";
  metric: string;  // field name or formula id
  tickers: string[];
  title?: string;
}

export class ChartPanel extends HTMLElement {
  private shadow: ShadowRoot;
  private chart: Chart | null = null;
  private config: ChartConfig = {
    type: "bar",
    metric: "pe_ratio",
    tickers: ["AAPL", "MSFT", "GOOGL", "AMZN", "META"],
  };
  private availableFormulas: Formula[] = [];
  private isLoading: boolean = false;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.render();
    this.loadFormulas();
  }

  disconnectedCallback() {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }

  setConfig(config: Partial<ChartConfig>) {
    this.config = { ...this.config, ...config };
    this.render();
    this.updateChart();
  }

  private async loadFormulas() {
    try {
      const { formulas } = await fetchFormulas();
      this.availableFormulas = formulas;
      this.render();
    } catch (e) {
      console.error("Failed to load formulas:", e);
    }
  }

  private async updateChart() {
    this.isLoading = true;
    this.renderLoading();

    try {
      const { metric, tickers, type, title } = this.config;
      
      // Evaluate the metric for all tickers
      const { results } = await evaluateFormula({
        expression: metric.startsWith("formula:") ? undefined : metric,
        formula_id: metric.startsWith("formula:") ? metric : undefined,
        universe: tickers,
      });

      // Prepare chart data
      const labels = results.map(r => r.ticker);
      const values = results.map(r => r.value ?? 0);
      
      // Get colors based on values
      const colors = values.map(v => {
        if (v > 0) return "rgba(74, 222, 128, 0.7)";
        if (v < 0) return "rgba(248, 113, 113, 0.7)";
        return "rgba(148, 163, 184, 0.7)";
      });

      const borderColors = values.map(v => {
        if (v > 0) return "rgba(74, 222, 128, 1)";
        if (v < 0) return "rgba(248, 113, 113, 1)";
        return "rgba(148, 163, 184, 1)";
      });

      // Create or update chart
      const canvas = this.shadow.getElementById("chart") as HTMLCanvasElement;
      if (!canvas) return;

      if (this.chart) {
        this.chart.destroy();
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const chartTitle = title || this.getMetricLabel(metric);

      this.chart = new Chart(ctx, {
        type: type === "scatter" ? "scatter" : type === "radar" ? "radar" : type,
        data: {
          labels,
          datasets: [{
            label: chartTitle,
            data: type === "scatter" 
              ? values.map((v, i) => ({ x: i, y: v }))
              : values,
            backgroundColor: colors,
            borderColor: borderColors,
            borderWidth: 1,
            borderRadius: type === "bar" ? 4 : 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false,
            },
            title: {
              display: true,
              text: chartTitle,
              color: "#e2e8f0",
                        font: {
                          size: 11,
                          weight: 600,
                        },
            },
            tooltip: {
              backgroundColor: "rgba(15, 23, 42, 0.95)",
              titleColor: "#e2e8f0",
              bodyColor: "#94a3b8",
              borderColor: "rgba(148, 163, 184, 0.3)",
              borderWidth: 1,
              padding: 10,
              callbacks: {
                label: (ctx) => {
                  const value = ctx.parsed.y ?? ctx.parsed;
                  return `${this.formatValue(value as number, metric)}`;
                },
              },
            },
          },
          scales: type === "radar" ? {} : {
            x: {
              grid: {
                color: "rgba(148, 163, 184, 0.1)",
              },
              ticks: {
                color: "#94a3b8",
              },
            },
            y: {
              grid: {
                color: "rgba(148, 163, 184, 0.1)",
              },
              ticks: {
                color: "#94a3b8",
                callback: (value) => this.formatValue(value as number, metric),
              },
            },
          },
        },
      });

    } catch (e) {
      console.error("Chart update failed:", e);
    }

    this.isLoading = false;
  }

  private getMetricLabel(metric: string): string {
    if (metric.startsWith("formula:")) {
      const formula = this.availableFormulas.find(f => f.id === metric);
      return formula?.name || metric;
    }
    return metric.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  }

  private formatValue(value: number, metric: string): string {
    if (metric.includes("margin") || metric.includes("yield") || metric.includes("growth")) {
      return `${value.toFixed(1)}%`;
    }
    if (metric === "price" || metric.includes("cap") || metric.includes("value")) {
      return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    }
    return value.toFixed(2);
  }

  private renderLoading() {
    const loadingEl = this.shadow.querySelector(".loading");
    if (loadingEl) {
      loadingEl.classList.add("visible");
    }
  }

  private render() {
    const metrics = [
      // Fields
      "pe_ratio", "pb_ratio", "ps_ratio", "ev_to_ebitda",
      "gross_margin", "operating_margin", "net_margin",
      "revenue_growth_yoy", "eps_growth_yoy",
      "debt_to_equity", "fcf_yield", "dividend_yield",
      // Formulas
      ...this.availableFormulas.map(f => f.id),
    ];

    this.shadow.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: system-ui, -apple-system, sans-serif;
          color: #e2e8f0;
        }
        
        .chart-panel {
          background: rgba(15, 23, 42, 0.6);
          border-radius: 8px;
          border: 1px solid rgba(148, 163, 184, 0.2);
          padding: 1rem;
        }
        
        .controls {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem;
          margin-bottom: 1rem;
        }
        
        .control-group {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        
        .control-group label {
          font-size: 0.7rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #94a3b8;
        }
        
        select, input {
          padding: 0.35rem 0.5rem;
          border: 1px solid rgba(148, 163, 184, 0.3);
          border-radius: 4px;
          background: rgba(30, 41, 59, 0.6);
          color: #e2e8f0;
          font-size: 0.8rem;
        }
        
        select:focus, input:focus {
          outline: none;
          border-color: rgba(59, 130, 246, 0.6);
        }
        
        .chart-container {
          position: relative;
          height: 300px;
        }
        
        .loading {
          position: absolute;
          inset: 0;
          display: none;
          align-items: center;
          justify-content: center;
          background: rgba(15, 23, 42, 0.8);
          color: #64748b;
          font-size: 0.85rem;
          border-radius: 4px;
        }
        
        .loading.visible {
          display: flex;
        }
        
        .btn {
          padding: 0.35rem 0.75rem;
          border: 1px solid rgba(59, 130, 246, 0.5);
          border-radius: 4px;
          background: rgba(59, 130, 246, 0.2);
          color: #93c5fd;
          font-size: 0.75rem;
          cursor: pointer;
          transition: all 0.15s ease;
          align-self: flex-end;
        }
        
        .btn:hover {
          background: rgba(59, 130, 246, 0.3);
        }
      </style>
      
      <div class="chart-panel">
        <div class="controls">
          <div class="control-group">
            <label>Chart Type</label>
            <select id="chart-type">
              <option value="bar" ${this.config.type === "bar" ? "selected" : ""}>Bar</option>
              <option value="line" ${this.config.type === "line" ? "selected" : ""}>Line</option>
              <option value="radar" ${this.config.type === "radar" ? "selected" : ""}>Radar</option>
            </select>
          </div>
          
          <div class="control-group">
            <label>Metric</label>
            <select id="metric">
              <optgroup label="Valuation">
                <option value="pe_ratio" ${this.config.metric === "pe_ratio" ? "selected" : ""}>PE Ratio</option>
                <option value="pb_ratio" ${this.config.metric === "pb_ratio" ? "selected" : ""}>PB Ratio</option>
                <option value="ps_ratio" ${this.config.metric === "ps_ratio" ? "selected" : ""}>PS Ratio</option>
                <option value="ev_to_ebitda" ${this.config.metric === "ev_to_ebitda" ? "selected" : ""}>EV/EBITDA</option>
              </optgroup>
              <optgroup label="Margins">
                <option value="gross_margin" ${this.config.metric === "gross_margin" ? "selected" : ""}>Gross Margin</option>
                <option value="operating_margin" ${this.config.metric === "operating_margin" ? "selected" : ""}>Operating Margin</option>
                <option value="net_margin" ${this.config.metric === "net_margin" ? "selected" : ""}>Net Margin</option>
              </optgroup>
              <optgroup label="Growth">
                <option value="revenue_growth_yoy" ${this.config.metric === "revenue_growth_yoy" ? "selected" : ""}>Revenue Growth</option>
                <option value="eps_growth_yoy" ${this.config.metric === "eps_growth_yoy" ? "selected" : ""}>EPS Growth</option>
              </optgroup>
              <optgroup label="Quality">
                <option value="debt_to_equity" ${this.config.metric === "debt_to_equity" ? "selected" : ""}>Debt/Equity</option>
                <option value="fcf_yield" ${this.config.metric === "fcf_yield" ? "selected" : ""}>FCF Yield</option>
              </optgroup>
              ${this.availableFormulas.length > 0 ? `
                <optgroup label="Formulas">
                  ${this.availableFormulas.map(f => `
                    <option value="${f.id}" ${this.config.metric === f.id ? "selected" : ""}>${f.name}</option>
                  `).join("")}
                </optgroup>
              ` : ""}
            </select>
          </div>
          
          <div class="control-group">
            <label>Tickers (comma-separated)</label>
            <input type="text" id="tickers" value="${this.config.tickers.join(", ")}" style="width: 200px;" />
          </div>
          
          <button class="btn" id="update-chart">Update Chart</button>
        </div>
        
        <div class="chart-container">
          <canvas id="chart"></canvas>
          <div class="loading">Loading...</div>
        </div>
      </div>
    `;

    this.setupEventListeners();
    this.updateChart();
  }

  private setupEventListeners() {
    this.shadow.getElementById("chart-type")?.addEventListener("change", (e) => {
      this.config.type = (e.target as HTMLSelectElement).value as ChartConfig["type"];
    });

    this.shadow.getElementById("metric")?.addEventListener("change", (e) => {
      this.config.metric = (e.target as HTMLSelectElement).value;
    });

    this.shadow.getElementById("tickers")?.addEventListener("change", (e) => {
      const value = (e.target as HTMLInputElement).value;
      this.config.tickers = value.split(",").map(t => t.trim()).filter(Boolean);
    });

    this.shadow.getElementById("update-chart")?.addEventListener("click", () => {
      this.updateChart();
    });
  }
}

customElements.define("chart-panel", ChartPanel);
