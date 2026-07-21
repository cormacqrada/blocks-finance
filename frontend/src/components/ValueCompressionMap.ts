/**
 * ValueCompressionMap - Bubble chart showing stocks plotted across composite axes.
 *
 * X-axis: Operational Stability (0-100) — Right = boring, durable, survivable.
 * Y-axis: Valuation Compression (0-100) — Higher = more compressed, more undervalued.
 * Bubble size: Shareholder Yield — dividends + buybacks + debt paydown.
 * Bubble color: IVRV (Intrinsic Value Realization Velocity) — dim (value trap) to bright (thesis working).
 *   S&P 500 stocks use a blue ramp; small caps use amber/orange.
 *
 * Dashed green target zone in top-right quadrant where all signals converge.
 * Hover tooltip shows ticker, stability, compression, shareholder yield %, IVRV %.
 * Click a bubble to call sendPrompt() with a drill-down message.
 */

import Chart from "chart.js/auto";
import {
  fetchValueCompressionScores,
  computeValueCompressionScores,
  type ValueCompressionScore,
} from "../api/client";
import {
  SHARED_STYLES,
  renderTickerBadges,
  renderMetricBadge,
  setupTickerLinks,
  renderInsightsSection,
  type Insight,
} from "./archetypes/shared";

export interface ValueCompressionMapConfig {
  title?: string;
  universe?: string[];
  limit?: number;
}

interface DataPoint extends ValueCompressionScore {
  isSmallCap: boolean;
}

export class ValueCompressionMap extends HTMLElement {
  private shadow: ShadowRoot;
  private chart: Chart | null = null;
  private config: ValueCompressionMapConfig = {};
  private data: DataPoint[] = [];
  private selectedTicker: string | null = null;
  private selectedPreset: string = "all";

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
    const limit = this.config.limit || 100;

    try {
      // First ensure scores are computed
      await computeValueCompressionScores(this.config.universe);

      // Then fetch
      const { rows } = await fetchValueCompressionScores({
        universe: this.config.universe,
        limit,
      });

      this.data = rows.map((r) => ({
        ...r,
        isSmallCap: (r.market_cap || 0) < 10_000_000_000, // < $10B = small/mid cap
      }));

      this.renderChart();
      this.renderInsights();
    } catch (e: any) {
      console.error("Failed to fetch value compression data:", e);
      const container = this.shadow.getElementById("chart-container");
      if (container) {
        const msg = e?.message?.includes('500') || e?.message?.includes('Failed to fetch')
          ? "Backend not reachable — make sure the server is running (uvicorn app.main:app --reload --port 8000)."
          : "No value compression data yet. Run data ingestion first (POST /ingest/fmp or /debug/seed_sample_greenblatt), then refresh.";
        container.innerHTML = `<div class="empty-state">${msg}</div>`;
      }
    }
  }

  private getBubbleColor(d: DataPoint): string {
    // IVRV drives brightness: 0 = dim (value trap), 100 = bright (thesis working)
    const ivrv = d.ivrv_pct || 0;
    const t = Math.min(1, Math.max(0, ivrv / 100));

    if (d.isSmallCap) {
      // Amber/orange ramp for small caps
      const r = Math.round(180 + 60 * t);
      const g = Math.round(100 + 60 * t);
      const b = Math.round(30 + 20 * t);
      return `rgba(${r}, ${g}, ${b}, ${0.4 + 0.5 * t})`;
    } else {
      // Blue ramp for S&P 500
      const r = Math.round(40 + 40 * t);
      const g = Math.round(80 + 80 * t);
      const b = Math.round(160 + 90 * t);
      return `rgba(${r}, ${g}, ${b}, ${0.4 + 0.5 * t})`;
    }
  }

  private getBubbleBorderColor(d: DataPoint): string {
    const ivrv = d.ivrv_pct || 0;
    const t = Math.min(1, Math.max(0, ivrv / 100));

    if (d.isSmallCap) {
      const r = Math.round(200 + 55 * t);
      const g = Math.round(120 + 60 * t);
      const b = Math.round(40 + 30 * t);
      return `rgba(${r}, ${g}, ${b}, 0.9)`;
    } else {
      const r = Math.round(60 + 40 * t);
      const g = Math.round(100 + 80 * t);
      const b = Math.round(180 + 70 * t);
      return `rgba(${r}, ${g}, ${b}, 0.9)`;
    }
  }

  private getBubbleRadius(d: DataPoint): number {
    // Shareholder yield maps to bubble size (3-25px)
    const yield_ = d.shareholder_yield_pct || 0;
    return Math.max(3, Math.min(25, 3 + yield_ * 1.5));
  }

  private renderChart() {
    const canvas = this.shadow.getElementById("chart") as HTMLCanvasElement;
    if (!canvas) return;

    this.chart?.destroy();

    // Separate datasets for SP500 and small caps for legend
    const sp500 = this.data.filter((d) => !d.isSmallCap);
    const smallCap = this.data.filter((d) => d.isSmallCap);

    this.chart = new Chart(canvas, {
      type: "bubble",
      data: {
        datasets: [
          {
            label: "S&P 500 / Large Cap",
            data: sp500.map((d) => ({
              x: d.operational_stability,
              y: d.valuation_compression,
              r: this.getBubbleRadius(d),
              _point: d,
            })),
            backgroundColor: sp500.map((d) => this.getBubbleColor(d)),
            borderColor: sp500.map((d) => this.getBubbleBorderColor(d)),
            borderWidth: 1.5,
          },
          {
            label: "Small & Mid Cap",
            data: smallCap.map((d) => ({
              x: d.operational_stability,
              y: d.valuation_compression,
              r: this.getBubbleRadius(d),
              _point: d,
            })),
            backgroundColor: smallCap.map((d) => this.getBubbleColor(d)),
            borderColor: smallCap.map((d) => this.getBubbleBorderColor(d)),
            borderWidth: 1.5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: "bottom",
            labels: {
              color: "#94a3b8",
              font: { size: 10 },
              boxWidth: 12,
              padding: 12,
            },
          },
          tooltip: {
            callbacks: {
              label: (ctx: any) => {
                const point = ctx.raw._point as DataPoint;
                if (!point) return "";
                const name = (point as any).company_name || "";
                return [
                  `${point.ticker}${name ? ` — ${name}` : ""}`,
                  `Stability: ${point.operational_stability?.toFixed(1) || "—"}`,
                  `Compression: ${point.valuation_compression?.toFixed(1) || "—"}`,
                  `Shareholder Yield: ${point.shareholder_yield_pct?.toFixed(1) || "—"}%`,
                  `IVRV: ${point.ivrv_pct?.toFixed(1) || "—"}%`,
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
            min: 0,
            max: 100,
            title: {
              display: true,
              text: "Operational Stability →  (boring, durable, survivable)",
              color: "#94a3b8",
              font: { size: 11 },
            },
            grid: {
              color: "rgba(148, 163, 184, 0.1)",
            },
            ticks: { color: "#64748b" },
          },
          y: {
            min: 0,
            max: 100,
            title: {
              display: true,
              text: "↑ Valuation Compression  (more undervalued)",
              color: "#94a3b8",
              font: { size: 11 },
            },
            grid: {
              color: "rgba(148, 163, 184, 0.1)",
            },
            ticks: { color: "#64748b" },
          },
        },
        onClick: (_event: any, elements: any[]) => {
          if (elements.length > 0) {
            const dsIdx = elements[0].datasetIndex;
            const idx = elements[0].index;
            const point = this.chart!.data.datasets[dsIdx].data[idx] as any;
            const d = point._point as DataPoint;
            if (d) {
              this.selectedTicker = d.ticker;
              this.renderDetails(d);
              // Call sendPrompt for AI drill-down
              const prompt = `Analyze ${d.ticker} on the Value Compression Map: Operational Stability ${d.operational_stability?.toFixed(1)}/100, Valuation Compression ${d.valuation_compression?.toFixed(1)}/100, Shareholder Yield ${d.shareholder_yield_pct?.toFixed(1)}%, IVRV ${d.ivrv_pct?.toFixed(1)}%. Is this a value trap or a genuine opportunity?`;
              (window as any).sendPrompt?.(prompt);
            }
          }
        },
      },
      plugins: [
        {
          id: "targetZone",
          beforeDraw: (chart: any) => {
            const { ctx, chartArea, scales } = chart;
            if (!chartArea) return;

            const x50 = scales.x.getPixelForValue(50);
            const x100 = scales.x.getPixelForValue(100);
            const y50 = scales.y.getPixelForValue(50);
            const y100 = scales.y.getPixelForValue(100);

            // Draw dashed green rectangle for target zone (top-right quadrant)
            ctx.save();
            ctx.setLineDash([6, 4]);
            ctx.strokeStyle = "rgba(74, 222, 128, 0.5)";
            ctx.lineWidth = 2;
            ctx.fillStyle = "rgba(74, 222, 128, 0.05)";
            ctx.fillRect(x50, y100, x100 - x50, y50 - y100);
            ctx.strokeRect(x50, y100, x100 - x50, y50 - y100);

            // Label
            ctx.setLineDash([]);
            ctx.fillStyle = "rgba(74, 222, 128, 0.6)";
            ctx.font = "600 11px system-ui";
            ctx.textAlign = "center";
            ctx.fillText("TARGET ZONE", (x50 + x100) / 2, (y50 + y100) / 2 - 6);
            ctx.font = "400 9px system-ui";
            ctx.fillStyle = "rgba(74, 222, 128, 0.4)";
            ctx.fillText("stable + compressed + yield + IVRV", (x50 + x100) / 2, (y50 + y100) / 2 + 8);

            ctx.restore();
          },
        },
      ],
    });
  }

  private renderDetails(d: DataPoint) {
    const details = this.shadow.getElementById("details");
    if (!details) return;

    const mktCapB = ((d.market_cap || 0) / 1e9).toFixed(1);

    details.innerHTML = `
      <div class="detail-header">
        <span class="detail-ticker">${d.ticker}</span>
        <span class="detail-cap">${mktCapB}B ${d.isSmallCap ? "(Small/Mid)" : "(Large Cap)"}</span>
      </div>
      <div class="detail-grid">
        <div class="detail-item">
          <span class="detail-label">Operational Stability</span>
          <span class="detail-value">${d.operational_stability?.toFixed(1) || "—"}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Valuation Compression</span>
          <span class="detail-value">${d.valuation_compression?.toFixed(1) || "—"}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Shareholder Yield</span>
          <span class="detail-value positive">${d.shareholder_yield_pct?.toFixed(1) || "—"}%</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">IVRV</span>
          <span class="detail-value ${d.ivrv_pct > 40 ? "positive" : d.ivrv_pct < 15 ? "warning" : ""}">${d.ivrv_pct?.toFixed(1) || "—"}%</span>
        </div>
      </div>
      <div class="detail-actions">
        <button class="drill-btn" data-ticker="${d.ticker}">🧠 Deep Dive</button>
      </div>
    `;

    // Drill-down button handler
    const drillBtn = details.querySelector(".drill-btn");
    if (drillBtn) {
      drillBtn.addEventListener("click", () => {
        const ticker = (drillBtn as HTMLElement).dataset.ticker || d.ticker;
        const prompt = `Deep dive into ${ticker}: analyze its value compression profile, operational stability, valuation compression, shareholder yield, and intrinsic value realization velocity. Is the market mispricing this stock?`;
        (window as any).sendPrompt?.(prompt);
      });
    }
  }

  private renderInsights() {
    const container = this.shadow.getElementById("insights-container");
    if (!container || this.data.length === 0) return;

    const insights: Insight[] = [];

    // Target zone stocks (stability > 50, compression > 50)
    const targetZone = this.data.filter(
      (d) => d.operational_stability > 50 && d.valuation_compression > 50
    );
    if (targetZone.length > 0) {
      const topTarget = targetZone.sort(
        (a, b) =>
          b.valuation_compression +
          b.operational_stability -
          (a.valuation_compression + a.operational_stability)
      )[0];
      insights.push({
        icon: "🎯",
        text: `${targetZone.length} stock${targetZone.length > 1 ? "s" : ""} in the target zone (stability > 50 + compression > 50). Top: ${topTarget.ticker}`,
        type: "positive",
      });
    }

    // High IVRV stocks (thesis actively working)
    const highIvrv = this.data.filter((d) => d.ivrv_pct > 50);
    if (highIvrv.length > 0) {
      insights.push({
        icon: "⚡",
        text: `${highIvrv.length} stock${highIvrv.length > 1 ? "s" : ""} with IVRV > 50% — thesis is actively working (${highIvrv.map((d) => d.ticker).slice(0, 5).join(", ")})`,
        type: "positive",
      });
    }

    // Value trap risk (high compression but low IVRV)
    const traps = this.data.filter(
      (d) => d.valuation_compression > 50 && d.ivrv_pct < 15
    );
    if (traps.length > 0) {
      insights.push({
        icon: "⚠️",
        text: `${traps.length} stock${traps.length > 1 ? "s" : ""} with high compression but low IVRV — potential value traps (${traps.map((d) => d.ticker).slice(0, 4).join(", ")})`,
        type: "warning",
      });
    }

    // Average metrics
    const avgStability =
      this.data.reduce((s, d) => s + (d.operational_stability || 0), 0) /
      this.data.length;
    const avgCompression =
      this.data.reduce((s, d) => s + (d.valuation_compression || 0), 0) /
      this.data.length;

    insights.push({
      icon: "📊",
      text: `Universe avg: Stability ${avgStability.toFixed(0)}/100, Compression ${avgCompression.toFixed(0)}/100 — ${avgCompression > 50 ? "universe skews undervalued" : "fair valuations dominate"}`,
      type: avgCompression > 50 ? "positive" : "neutral",
    });

    container.innerHTML = renderInsightsSection(insights.slice(0, 4));

    // Ticker links in target zone
    const tickerContainer = this.shadow.getElementById("target-tickers");
    if (tickerContainer && targetZone.length > 0) {
      tickerContainer.innerHTML = `
        <div class="chart-header">
          <span class="chart-title">Target Zone Stocks</span>
        </div>
        <div class="ticker-list">
          ${renderTickerBadges(
            targetZone
              .sort(
                (a, b) =>
                  b.valuation_compression +
                  b.operational_stability -
                  (a.valuation_compression + a.operational_stability)
              )
              .map((d) => d.ticker),
            12,
            "rgba(74, 222, 128, 0.15)",
            "#4ade80"
          )}
        </div>
      `;
    }

    setupTickerLinks(this.shadow);
  }

  private render() {
    this.shadow.innerHTML = `
      <style>
        ${SHARED_STYLES}
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
          flex-wrap: wrap;
          gap: 0.5rem;
        }
        .title {
          font-size: 0.9rem;
          font-weight: 600;
          color: #e2e8f0;
        }
        .header-badges {
          display: flex;
          gap: 0.4rem;
          flex-wrap: wrap;
        }
        .chart-section {
          padding: 0.75rem 1rem;
        }
        .chart-container {
          position: relative;
          height: 400px;
        }
        .detail-panel {
          background: rgba(30, 41, 59, 0.6);
          border: 1px solid rgba(148, 163, 184, 0.15);
          border-radius: 8px;
          padding: 0.75rem 1rem;
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
          color: #f1f5f9;
          font-family: ui-monospace, monospace;
        }
        .detail-cap {
          font-size: 0.75rem;
          color: #94a3b8;
        }
        .detail-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 0.5rem;
        }
        .detail-item {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }
        .detail-label {
          font-size: 0.7rem;
          color: #64748b;
        }
        .detail-value {
          font-size: 0.85rem;
          font-weight: 600;
          color: #e2e8f0;
        }
        .detail-value.positive { color: #4ade80; }
        .detail-value.warning { color: #fbbf24; }
        .detail-actions {
          margin-top: 0.5rem;
          display: flex;
          gap: 0.5rem;
        }
        .drill-btn {
          background: rgba(139, 92, 246, 0.2);
          border: 1px solid rgba(139, 92, 246, 0.3);
          color: #a78bfa;
          font-size: 0.75rem;
          padding: 0.3rem 0.75rem;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .drill-btn:hover {
          background: rgba(139, 92, 246, 0.3);
          border-color: rgba(139, 92, 246, 0.5);
        }
        .empty-state {
          text-align: center;
          padding: 3rem 1rem;
          color: #64748b;
          font-size: 0.85rem;
        }
      </style>

      <div class="container">
        <div class="header">
          <span class="title">Value Compression Map</span>
          <div class="header-badges">
            ${renderMetricBadge("operational_stability", "X", 0)}
            ${renderMetricBadge("valuation_compression", "Y", 0)}
            ${renderMetricBadge("shareholder_yield", "Size", 0)}
            ${renderMetricBadge("ivrv", "Color", 0)}
          </div>
        </div>
        
        <div class="chart-section">
          <div class="chart-explainer">
            <strong>X:</strong> Operational Stability (margin + leverage + coverage) — right = durable. 
            <strong>Y:</strong> Valuation Compression (inverted multiples + FCF) — top = cheap. 
            <strong>Size:</strong> Shareholder Yield. <strong>Color:</strong> IVRV (dim = trap risk, bright = thesis working). 
            <strong style="color: #4ade80;">Dashed zone</strong> = target convergence.
          </div>
          <div class="chart-container">
            <canvas id="chart"></canvas>
          </div>
        </div>

        <div id="details" class="detail-panel" style="margin: 0 1rem;"></div>
        <div id="target-tickers" style="margin: 0 1rem;"></div>
        <div id="insights-container" style="margin: 0.75rem 1rem 1rem;"></div>
      </div>
    `;
  }
}

customElements.define("value-compression-map", ValueCompressionMap);
