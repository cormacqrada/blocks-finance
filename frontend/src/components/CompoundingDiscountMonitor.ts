/**
 * CompoundingDiscountMonitor — Getty Oil Inspired
 *
 * Visualizations:
 * A. Quadrant Scatter — P/B ratio (x) vs BVPS CAGR (y) with quadrant fills,
 *    fair-value line at 1.0x, sweet-spot band 12-20%, Getty 1962 anchor
 * B. Look-Through Toggle — adjusts P/B for subsidiaries/net cash
 * C. Family Stake Filter — highlight positions with >30% insider ownership
 * D. BVPS Trail Viewer — BVPS compounding vs flat price (widening arbitrage gap)
 * E. Summary Bar
 * F. AI Insights
 * G. Ticker badges
 */

import Chart from "chart.js/auto";
import {
  computeCompoundingDiscount,
  fetchCompoundingDiscountPositions,
  fetchCompoundingDiscountSummary,
  simulateBVPSTrail,
  type CompoundingDiscountPosition,
  type CompoundingDiscountSummary,
  type BVPSTrail,
} from "../api/client";
import {
  SHARED_STYLES,
  renderTickerBadges,
  renderMetricBadge,
  setupTickerLinks,
  renderInsightsSection,
  type Insight,
} from "./archetypes/shared";

export interface CompoundingDiscountMonitorConfig {
  title?: string;
  universe?: string[];
  limit?: number;
}

const QUADRANT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  opportunity: { bg: "rgba(74, 222, 128, 0.15)", text: "#4ade80", border: "rgba(74, 222, 128, 0.4)" },
  efficient: { bg: "rgba(59, 130, 246, 0.12)", text: "#3b82f6", border: "rgba(59, 130, 246, 0.3)" },
  value_trap: { bg: "rgba(239, 68, 68, 0.12)", text: "#ef4444", border: "rgba(239, 68, 68, 0.3)" },
  overvalued: { bg: "rgba(251, 146, 60, 0.12)", text: "#fb923c", border: "rgba(251, 146, 60, 0.3)" },
  patience: { bg: "rgba(251, 191, 36, 0.10)", text: "#fbbf24", border: "rgba(251, 191, 36, 0.25)" },
  watch: { bg: "rgba(148, 163, 184, 0.08)", text: "#94a3b8", border: "rgba(148, 163, 184, 0.2)" },
};

export class CompoundingDiscountMonitor extends HTMLElement {
  private shadow: ShadowRoot;
  private scatterChart: Chart | null = null;
  private trailChart: Chart | null = null;
  private config: CompoundingDiscountMonitorConfig = {};
  private data: CompoundingDiscountPosition[] = [];
  private summary: CompoundingDiscountSummary | null = null;
  private selectedTicker: string | null = null;
  private trail: BVPSTrail | null = null;
  private lookThroughEnabled: boolean = false;
  private familyStakeFilter: boolean = false;

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
    this.scatterChart?.destroy();
    this.trailChart?.destroy();
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
      await computeCompoundingDiscount(this.config.universe);
      const { rows } = await fetchCompoundingDiscountPositions({
        universe: this.config.universe,
        limit: this.config.limit || 30,
      });
      this.data = rows;
      this.summary = await fetchCompoundingDiscountSummary({ universe: this.config.universe });

      // Auto-select best opportunity
      if (rows.length > 0 && !this.selectedTicker) {
        const best = rows.find((r) => r.quadrant === "opportunity") || rows[0];
        this.selectedTicker = best.ticker;
        await this.loadTrail(best.ticker);
      }

      this.renderSummary();
      this.renderScatter();
      this.renderInsights();
    } catch (e) {
      console.error("Failed to fetch compounding discount data:", e);
      const container = this.shadow.getElementById("scatter-container");
      if (container) {
        container.innerHTML = `<div class="empty-state">Failed to load data. Ensure the backend is running and data has been ingested.</div>`;
      }
    }
  }

  private async loadTrail(ticker: string) {
    try {
      this.trail = await simulateBVPSTrail({ ticker, years: 22, steps: 44 });
      this.selectedTicker = ticker;
      this.renderTrail();
    } catch (e) {
      console.error("Failed to simulate BVPS trail:", e);
    }
  }

  private renderSummary() {
    const el = this.shadow.getElementById("summary-bar");
    if (!el || !this.summary) return;

    const s = this.summary;
    const bestTicker = s.best_opportunity?.ticker || "—";
    const bestCAGR = s.best_opportunity?.bvps_cagr_5yr?.toFixed(1) || "—";
    const bestPB = s.best_opportunity?.look_through_pb?.toFixed(2) || s.best_opportunity?.pb_ratio?.toFixed(2) || "—";

    el.innerHTML = `
      <div class="summary-item">
        <span class="summary-label">Opportunity zone</span>
        <span class="summary-value" style="color: #4ade80;">${s.total_in_opportunity}</span>
        <span class="summary-sub">high CAGR + low P/B</span>
      </div>
      <div class="summary-item highlight">
        <span class="summary-label">Best opportunity</span>
        <span class="summary-value ticker-link" data-ticker="${bestTicker}">${bestTicker}</span>
        <span class="summary-sub">CAGR ${bestCAGR}% · Look-through P/B ${bestPB}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Avg CAGR (opportunity)</span>
        <span class="summary-value">${s.avg_cagr_opportunity.toFixed(1)}%</span>
        <span class="summary-sub">internal compounding rate</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Avg P/B (opportunity)</span>
        <span class="summary-value">${s.avg_pb_opportunity.toFixed(2)}x</span>
        <span class="summary-sub">market discount</span>
      </div>
      <div class="summary-item warning">
        <span class="summary-label">Getty-type gaps</span>
        <span class="summary-value">${s.getty_gap_count}</span>
        <span class="summary-sub">compounding at <1x P/B</span>
      </div>
    `;

    el.querySelectorAll(".ticker-link").forEach((link) => {
      link.addEventListener("click", () => {
        const ticker = (link as HTMLElement).dataset.ticker;
        if (ticker) this.loadTrail(ticker);
      });
    });
  }

  private renderScatter() {
    const canvas = this.shadow.getElementById("scatter-chart") as HTMLCanvasElement;
    if (!canvas) return;

    this.scatterChart?.destroy();

    const visibleData = this.familyStakeFilter
      ? this.data.filter((d) => d.family_stake_flag)
      : this.data;

    const getX = (d: CompoundingDiscountPosition) =>
      this.lookThroughEnabled && d.look_through_pb != null ? d.look_through_pb : d.pb_ratio ?? 0;
    const getY = (d: CompoundingDiscountPosition) => d.bvps_cagr_5yr ?? 0;

    const quadrantBubbleColor = (d: CompoundingDiscountPosition): string => {
      const c = QUADRANT_COLORS[d.quadrant];
      return c?.bg?.replace("0.15", "0.65").replace("0.12", "0.55").replace("0.10", "0.45").replace("0.08", "0.4") || "rgba(148,163,184,0.4)";
    };
    const quadrantBorderColor = (d: CompoundingDiscountPosition): string => {
      return QUADRANT_COLORS[d.quadrant]?.border || "rgba(148,163,184,0.5)";
    };

    this.scatterChart = new Chart(canvas, {
      type: "bubble",
      data: {
        datasets: [
          {
            label: "Positions",
            data: visibleData.map((d) => ({
              x: getX(d),
              y: getY(d),
              r: Math.max(5, Math.min(18, 4 + Math.log10(Math.max(1, d.market_cap / 1e9)) * 4)),
              _point: d,
            })),
            backgroundColor: visibleData.map(quadrantBubbleColor),
            borderColor: visibleData.map(quadrantBorderColor),
            borderWidth: 1.5,
          },
          {
            label: "Getty Oil 1962",
            data: [{ x: 0.63, y: 11, r: 8, _point: null as any }],
            backgroundColor: "rgba(251, 191, 36, 0.5)",
            borderColor: "rgba(251, 191, 36, 0.9)",
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx: any) => {
                if (ctx.datasetIndex === 1) return ["Getty Oil 1962", "P/B 0.63 · CAGR 11%"];
                const d = ctx.raw._point as CompoundingDiscountPosition;
                if (!d) return [];
                return [
                  `${d.ticker}`,
                  `P/B: ${d.pb_ratio?.toFixed(2) || "—"}`,
                  `Look-through P/B: ${d.look_through_pb?.toFixed(2) || "—"}`,
                  `BVPS CAGR 5yr: ${d.bvps_cagr_5yr?.toFixed(1) || "—"}`,
                  `Arbitrage gap: ${d.arbitrage_gap.toFixed(1)}%`,
                  `Family stake: ${d.family_stake_pct.toFixed(0)}%`,
                  `Quadrant: ${d.quadrant.replace(/_/g, " ")}`,
                ];
              },
            },
            backgroundColor: "rgba(15, 23, 42, 0.95)",
            titleColor: "#e2e8f0",
            bodyColor: "#94a3b8",
            padding: 10,
            cornerRadius: 6,
          },
        },
        scales: {
          x: {
            min: 0,
            max: 3.0,
            title: {
              display: true,
              text: this.lookThroughEnabled ? "← Look-Through P/B (adj. for subsidiaries) →" : "← P/B Ratio →",
              color: "#94a3b8",
              font: { size: 10 },
            },
            grid: { color: "rgba(148, 163, 184, 0.08)" },
            ticks: { color: "#64748b" },
          },
          y: {
            min: -5,
            max: 35,
            title: {
              display: true,
              text: "↑ BVPS CAGR 5yr (%)",
              color: "#94a3b8",
              font: { size: 10 },
            },
            grid: { color: "rgba(148, 163, 184, 0.08)" },
            ticks: { color: "#64748b" },
          },
        },
        onClick: (_event: any, elements: any[]) => {
          if (elements.length > 0 && elements[0].datasetIndex === 0) {
            const idx = elements[0].index;
            const point = this.scatterChart!.data.datasets[0].data[idx] as any;
            const d = point._point as CompoundingDiscountPosition;
            if (d) this.loadTrail(d.ticker);
          }
        },
      },
      plugins: [
        // Quadrant fills + fair value line + sweet-spot band
        {
          id: "quadrantFills",
          beforeDraw: (chart: any) => {
            const { ctx, chartArea, scales } = chart;
            if (!chartArea) return;

            const x1_0 = scales.x.getPixelForValue(1.0);
            const x1_5 = scales.x.getPixelForValue(1.5);
            const y5 = scales.y.getPixelForValue(5);
            const y12 = scales.y.getPixelForValue(12);
            const y20 = scales.y.getPixelForValue(20);
            const x0 = scales.x.getPixelForValue(0);
            const xMax = scales.x.getPixelForValue(3.0);
            const yMin = scales.y.getPixelForValue(-5);
            const yMax = scales.y.getPixelForValue(35);

            ctx.save();

            // Opportunity zone: P/B < 1.0, CAGR >= 12% (green)
            ctx.fillStyle = "rgba(74, 222, 128, 0.04)";
            ctx.fillRect(x0, y20, x1_0 - x0, yMax - y20);
            ctx.fillRect(x0, y12, x1_0 - x0, y20 - y12);

            // Efficient market zone: P/B >= 1.5, CAGR >= 12% (blue)
            ctx.fillStyle = "rgba(59, 130, 246, 0.03)";
            ctx.fillRect(x1_5, y12, xMax - x1_5, yMax - y12);

            // Value trap zone: P/B < 1.0, CAGR < 5% (red)
            ctx.fillStyle = "rgba(239, 68, 68, 0.03)";
            ctx.fillRect(x0, y5, x1_0 - x0, yMin - y5);

            // Overvalued zone: P/B >= 1.5, CAGR < 5% (orange)
            ctx.fillStyle = "rgba(251, 146, 60, 0.03)";
            ctx.fillRect(x1_5, y5, xMax - x1_5, yMin - y5);

            // Fair value line at P/B = 1.0
            ctx.setLineDash([6, 4]);
            ctx.strokeStyle = "rgba(226, 232, 240, 0.35)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x1_0, yMin);
            ctx.lineTo(x1_0, yMax);
            ctx.stroke();

            // Sweet-spot band 12-20% CAGR
            ctx.fillStyle = "rgba(74, 222, 128, 0.02)";
            ctx.fillRect(x0, y20, xMax - x0, y12 - y20);

            // Band border lines
            ctx.strokeStyle = "rgba(74, 222, 128, 0.15)";
            ctx.lineWidth = 0.5;
            ctx.setLineDash([2, 4]);
            ctx.beginPath();
            ctx.moveTo(x0, y12);
            ctx.lineTo(xMax, y12);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x0, y20);
            ctx.lineTo(xMax, y20);
            ctx.stroke();

            ctx.setLineDash([]);

            // Quadrant labels
            ctx.font = "600 9px system-ui";
            ctx.textAlign = "center";

            // Opportunity
            ctx.fillStyle = "rgba(74, 222, 128, 0.45)";
            ctx.fillText("Opportunity", (x0 + x1_0) / 2, (y12 + yMax) / 2);

            // Efficient
            ctx.fillStyle = "rgba(59, 130, 246, 0.4)";
            ctx.fillText("Efficient", (x1_5 + xMax) / 2, (y12 + yMax) / 2);

            // Value Trap
            ctx.fillStyle = "rgba(239, 68, 68, 0.4)";
            ctx.fillText("Value Trap", (x0 + x1_0) / 2, (y5 + yMin) / 2 + 4);

            // Overvalued
            ctx.fillStyle = "rgba(251, 146, 60, 0.4)";
            ctx.fillText("Overvalued", (x1_5 + xMax) / 2, (y5 + yMin) / 2 + 4);

            // Patience zone label
            ctx.fillStyle = "rgba(251, 191, 36, 0.3)";
            ctx.fillText("Patience", (x0 + x1_0) / 2, (y5 + y12) / 2);

            // Watch zone label
            ctx.fillStyle = "rgba(148, 163, 184, 0.25)";
            ctx.fillText("Watch", (x1_0 + x1_5) / 2, (y5 + y12) / 2);

            // Fair value label
            ctx.fillStyle = "rgba(226, 232, 240, 0.5)";
            ctx.font = "500 8px system-ui";
            ctx.fillText("P/B = 1.0", x1_0 + 2, yMax + 10);

            // Sweet-spot label
            ctx.fillStyle = "rgba(74, 222, 128, 0.35)";
            ctx.font = "italic 8px system-ui";
            ctx.fillText("Sweet spot 12-20%", xMax - 50, (y12 + y20) / 2 + 3);

            ctx.restore();
          },
        },
        // Ticker labels on bubbles
        {
          id: "tickerLabels",
          afterDraw: (chart: any) => {
            const { ctx } = chart;
            ctx.save();
            ctx.font = "600 7px ui-monospace, monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            const meta = chart.getDatasetMeta(0);
            meta.data.forEach((point: any, i: number) => {
              const d = visibleData[i];
              if (!d) return;
              ctx.fillStyle = "rgba(226, 232, 240, 0.7)";
              ctx.fillText(d.ticker, point.x, point.y - point.options.radius - 5);
            });

            // Getty anchor label
            const gettyMeta = chart.getDatasetMeta(1);
            if (gettyMeta.data.length > 0) {
              const gp = gettyMeta.data[0] as any;
              ctx.fillStyle = "rgba(251, 191, 36, 0.8)";
              ctx.font = "600 8px ui-monospace, monospace";
              ctx.fillText("Getty '62", gp.x, gp.y - gp.options.radius - 5);
            }

            ctx.restore();
          },
        },
      ],
    });
  }

  private renderTrail() {
    const container = this.shadow.getElementById("trail-container");
    if (!container) return;

    if (!this.trail) {
      container.innerHTML = `<div class="empty-state">Select a ticker from the scatter above to see the BVPS compounding trail.</div>`;
      return;
    }

    const t = this.trail;
    const currentGap = t.current_pb > 0 ? ((t.current_pb - (t.look_through_pb || t.current_pb)) / t.current_pb * 100).toFixed(1) : "0";

    container.innerHTML = `
      <div class="section-header">
        <span class="section-title">BVPS Compounding Trail</span>
        <span class="section-sub">— ${t.ticker}</span>
        <div class="trail-controls">
          ${renderMetricBadge("bvps_cagr", t.bvps_cagr.toFixed(1) + "%")}
          ${renderMetricBadge("look_through_pb", t.look_through_pb?.toFixed(2) || t.current_pb.toFixed(2))}
          ${renderMetricBadge("arbitrage_gap", currentGap + "%")}
        </div>
      </div>
      <div class="trail-chart-container">
        <canvas id="trail-chart"></canvas>
      </div>
      <div id="trail-readout" class="trail-readout">
        <span class="trail-detail">BVPS compounding at ${t.bvps_cagr.toFixed(1)}% while price stays flat — widening arbitrage gap (Getty went $18 → $625 over 22 years)</span>
      </div>
    `;

    this.renderTrailChart();
  }

  private renderTrailChart() {
    const canvas = this.shadow.getElementById("trail-chart") as HTMLCanvasElement;
    if (!canvas || !this.trail) return;

    this.trailChart?.destroy();

    const points = this.trail.points;

    this.trailChart = new Chart(canvas, {
      type: "line",
      data: {
        labels: points.map((p) => `Yr ${p.year}`),
        datasets: [
          {
            label: "Book Value / Share",
            data: points.map((p) => p.bvps),
            borderColor: "#4ade80",
            backgroundColor: "rgba(74, 222, 128, 0.08)",
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2,
            yAxisID: "y",
          },
          {
            label: "Market Price",
            data: points.map((p) => p.price),
            borderColor: "#3b82f6",
            backgroundColor: "rgba(59, 130, 246, 0.05)",
            fill: true,
            tension: 0.1,
            pointRadius: 0,
            borderWidth: 2,
            yAxisID: "y",
          },
          {
            label: "P/B Ratio",
            data: points.map((p) => p.pb_ratio),
            borderColor: "rgba(167, 139, 250, 0.6)",
            borderDash: [4, 4],
            tension: 0.2,
            pointRadius: 0,
            borderWidth: 1.5,
            yAxisID: "y1",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            display: true,
            position: "top",
            labels: { color: "#94a3b8", font: { size: 9 }, boxWidth: 12, padding: 8 },
          },
          tooltip: {
            callbacks: {
              label: (ctx: any) => {
                const idx = ctx.dataIndex;
                const p = points[idx];
                if (!p) return "";
                if (ctx.datasetIndex === 0) return `BVPS: $${p.bvps.toFixed(2)}`;
                if (ctx.datasetIndex === 1) return `Price: $${p.price.toFixed(2)}`;
                return `P/B: ${p.pb_ratio.toFixed(2)}x`;
              },
            },
            backgroundColor: "rgba(15, 23, 42, 0.95)",
            titleColor: "#e2e8f0",
            bodyColor: "#94a3b8",
            padding: 10,
            cornerRadius: 6,
          },
        },
        scales: {
          x: {
            title: { display: true, text: "Year", color: "#94a3b8", font: { size: 10 } },
            grid: { color: "rgba(148, 163, 184, 0.08)" },
            ticks: { color: "#64748b", maxTicksLimit: 12 },
          },
          y: {
            position: "left",
            title: { display: true, text: "$ per Share", color: "#94a3b8", font: { size: 10 } },
            grid: { color: "rgba(148, 163, 184, 0.08)" },
            ticks: { color: "#64748b" },
          },
          y1: {
            position: "right",
            min: 0,
            max: 3,
            title: { display: true, text: "P/B Ratio", color: "#a78bfa", font: { size: 10 } },
            grid: { drawOnChartArea: false },
            ticks: { color: "#64748b" },
          },
        },
      },
      plugins: [
        // Arbitrage gap shading
        {
          id: "gapShading",
          beforeDraw: (chart: any) => {
            const { ctx, chartArea, scales } = chart;
            if (!chartArea) return;

            // Draw a subtle annotation for the gap between BVPS and price
            ctx.save();
            ctx.fillStyle = "rgba(74, 222, 128, 0.02)";
            ctx.restore();
          },
        },
        // Fair value P/B = 1.0 reference line
        {
          id: "fairValueRef",
          beforeDraw: (chart: any) => {
            const { ctx, chartArea, scales } = chart;
            if (!chartArea) return;

            const pb1 = scales.y1.getPixelForValue(1.0);
            ctx.save();
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = "rgba(226, 232, 240, 0.2)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(chartArea.left, pb1);
            ctx.lineTo(chartArea.right, pb1);
            ctx.stroke();
            ctx.restore();
          },
        },
      ],
    });
  }

  private renderInsights() {
    const container = this.shadow.getElementById("insights-container");
    if (!container || this.data.length === 0) return;

    const insights: Insight[] = [];

    // Opportunity zone positions
    const opportunity = this.data.filter((d) => d.quadrant === "opportunity");
    if (opportunity.length > 0) {
      insights.push({
        icon: "🎯",
        text: `${opportunity.length} position${opportunity.length > 1 ? "s" : ""} in opportunity zone: ${opportunity.map((d) => d.ticker).slice(0, 5).join(", ")}`,
        type: "positive",
      });
    }

    // Getty-type gaps: high CAGR + very low P/B
    const gettyGaps = this.data.filter((d) => (d.bvps_cagr_5yr ?? 0) >= 10 && (d.pb_ratio ?? 99) < 0.8);
    if (gettyGaps.length > 0) {
      insights.push({
        icon: "🏛️",
        text: `${gettyGaps.length} stock${gettyGaps.length > 1 ? "s" : ""} with Getty-type disconnect (CAGR ≥ 10%, P/B < 0.8): ${gettyGaps.map((d) => d.ticker).slice(0, 4).join(", ")}`,
        type: "positive",
      });
    }

    // Large arbitrage gaps (look-through adjustment)
    const bigGap = this.data.filter((d) => d.arbitrage_gap > 20);
    if (bigGap.length > 0) {
      insights.push({
        icon: "📐",
        text: `${bigGap.length} stock${bigGap.length > 1 ? "s" : ""} with >20% look-through arbitrage gap — reported P/B hides real value (${bigGap.map((d) => d.ticker).slice(0, 4).join(", ")})`,
        type: "positive",
      });
    }

    // Family-controlled compounders
    const familyControlled = this.data.filter((d) => d.family_stake_flag);
    if (familyControlled.length > 0) {
      insights.push({
        icon: "👨‍👩‍👧‍👦",
        text: `${familyControlled.length} family-controlled compounder${familyControlled.length > 1 ? "s" : ""} — insider alignment may resist takeovers, extending the discount period (${familyControlled.map((d) => d.ticker).slice(0, 4).join(", ")})`,
        type: "warning",
      });
    }

    // Value trap signals
    const valueTraps = this.data.filter((d) => d.quadrant === "value_trap");
    if (valueTraps.length > 0) {
      insights.push({
        icon: "⚠️",
        text: `${valueTraps.length} stock${valueTraps.length > 1 ? "s" : ""} in value trap zone: low CAGR + low P/B — compounding isn't happening (${valueTraps.map((d) => d.ticker).slice(0, 4).join(", ")})`,
        type: "warning",
      });
    }

    container.innerHTML = renderInsightsSection(insights.slice(0, 4));

    // Ticker badges for opportunity zone
    const tickerContainer = this.shadow.getElementById("opportunity-tickers");
    if (tickerContainer && opportunity.length > 0) {
      tickerContainer.innerHTML = `
        <div class="chart-header">
          <span class="chart-title">Opportunity Zone</span>
        </div>
        <div class="ticker-list">
          ${renderTickerBadges(
            opportunity.map((d) => d.ticker),
            10,
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

        /* Summary bar */
        .summary-bar {
          display: flex;
          gap: 1rem;
          padding: 0.75rem 1rem;
          background: rgba(30, 41, 59, 0.4);
          border-bottom: 1px solid rgba(148, 163, 184, 0.1);
          flex-wrap: wrap;
        }
        .summary-item {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
          padding: 0.4rem 0.75rem;
          background: rgba(15, 23, 42, 0.5);
          border-radius: 6px;
          border: 1px solid rgba(148, 163, 184, 0.1);
          min-width: 120px;
        }
        .summary-item.highlight {
          border-color: rgba(74, 222, 128, 0.3);
          background: rgba(74, 222, 128, 0.05);
        }
        .summary-item.warning {
          border-color: rgba(251, 191, 36, 0.2);
        }
        .summary-label {
          font-size: 0.65rem;
          font-weight: 500;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }
        .summary-value {
          font-size: 1rem;
          font-weight: 700;
          color: #e2e8f0;
          font-family: ui-monospace, monospace;
        }
        .summary-item.highlight .summary-value {
          color: #4ade80;
        }
        .summary-sub {
          font-size: 0.6rem;
          color: #475569;
        }

        /* Section headers */
        .section-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
          flex-wrap: wrap;
        }
        .section-title {
          font-size: 0.8rem;
          font-weight: 600;
          color: #e2e8f0;
        }
        .section-sub {
          font-size: 0.75rem;
          color: #64748b;
        }

        /* Scatter section */
        .scatter-section {
          padding: 0.75rem 1rem;
          border-bottom: 1px solid rgba(148, 163, 184, 0.1);
        }
        .scatter-controls {
          display: flex;
          gap: 1rem;
          margin-left: auto;
          flex-wrap: wrap;
          align-items: center;
        }
        .toggle-label {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          font-size: 0.7rem;
          color: #94a3b8;
          cursor: pointer;
        }
        .toggle-label input[type="checkbox"] {
          width: 14px;
          height: 14px;
          accent-color: #4ade80;
          cursor: pointer;
        }
        .scatter-chart-container {
          position: relative;
          height: 320px;
        }

        /* Trail section */
        .trail-section {
          padding: 0.75rem 1rem;
          border-bottom: 1px solid rgba(148, 163, 184, 0.1);
        }
        .trail-controls {
          display: flex;
          gap: 0.75rem;
          margin-left: auto;
          flex-wrap: wrap;
          align-items: center;
        }
        .trail-chart-container {
          position: relative;
          height: 260px;
        }
        .trail-readout {
          margin-top: 0.5rem;
          text-align: center;
        }
        .trail-detail {
          font-size: 0.72rem;
          color: #64748b;
          font-style: italic;
        }
      </style>

      <div class="container">
        <div class="header">
          <span class="title">Compounding Discount Monitor</span>
          <span class="signal" style="--signal-bg: rgba(74,222,128,0.1); --signal-color: #22c55e;">
            Getty Oil inspired — tracking the disconnect between compounding book value and market perception
          </span>
        </div>

        <div id="summary-bar" class="summary-bar">
          <div class="summary-item"><span class="summary-label">Loading...</span></div>
        </div>

        <div class="scatter-section">
          <div class="section-header">
            <span class="section-title">P/B vs BVPS CAGR quadrant map</span>
            <div class="scatter-controls">
              <label class="toggle-label">
                <input type="checkbox" id="look-through-toggle" />
                Look-Through P/B
              </label>
              <label class="toggle-label">
                <input type="checkbox" id="family-stake-filter" />
                Family Stake Only
              </label>
            </div>
          </div>
          <div id="scatter-container" class="scatter-chart-container">
            <canvas id="scatter-chart"></canvas>
          </div>
        </div>

        <div id="trail-container" class="trail-section">
          <div class="loading">Loading BVPS trail...</div>
        </div>

        <div id="insights-container" class="insights-section" style="margin: 0.75rem 1rem;"></div>
        <div id="opportunity-tickers" style="padding: 0 1rem 0.75rem;"></div>
      </div>
    `;

    // Bind toggle controls
    const lookThroughToggle = this.shadow.getElementById("look-through-toggle") as HTMLInputElement;
    const familyStakeFilter = this.shadow.getElementById("family-stake-filter") as HTMLInputElement;

    if (lookThroughToggle) {
      lookThroughToggle.addEventListener("change", () => {
        this.lookThroughEnabled = lookThroughToggle.checked;
        this.renderScatter();
      });
    }
    if (familyStakeFilter) {
      familyStakeFilter.addEventListener("change", () => {
        this.familyStakeFilter = familyStakeFilter.checked;
        this.renderScatter();
      });
    }
  }
}

customElements.define("compounding-discount-monitor", CompoundingDiscountMonitor);
