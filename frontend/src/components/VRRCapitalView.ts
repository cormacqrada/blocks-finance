/**
 * VRRCapitalView — Thesis Realization & Capital Deployment Dashboard
 *
 * Three sub-visualizations:
 * A. VRR Gauge bars — how much thesis has been realized per position
 * B. Capital Deployment Matrix — 2x2 scatter of velocity vs spread
 * C. Kelly + Marginal IRR Simulator — interactive IRR curve with Kelly sizing
 */

import Chart from "chart.js/auto";
import {
  computeVRR,
  fetchVRRPositions,
  fetchVRRSummary,
  simulateMarginalIRR,
  type VRRPosition,
  type VRRSummary,
  type IRRSimulation,
} from "../api/client";
import {
  SHARED_STYLES,
  renderTickerBadges,
  renderMetricBadge,
  setupTickerLinks,
  renderInsightsSection,
  type Insight,
} from "./archetypes/shared";

export interface VRRCapitalViewConfig {
  title?: string;
  universe?: string[];
  limit?: number;
}

const ACTION_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  add_aggressively: { bg: "rgba(74, 222, 128, 0.15)", text: "#4ade80", border: "rgba(74, 222, 128, 0.4)" },
  add_capital: { bg: "rgba(34, 197, 94, 0.12)", text: "#22c55e", border: "rgba(34, 197, 94, 0.3)" },
  hold: { bg: "rgba(59, 130, 246, 0.12)", text: "#3b82f6", border: "rgba(59, 130, 246, 0.3)" },
  patience: { bg: "rgba(251, 191, 36, 0.12)", text: "#fbbf24", border: "rgba(251, 191, 36, 0.3)" },
  rotate: { bg: "rgba(239, 68, 68, 0.12)", text: "#ef4444", border: "rgba(239, 68, 68, 0.3)" },
};

const VELOCITY_COLORS: Record<string, string> = {
  fast: "#4ade80",
  moderate: "#fbbf24",
  slow: "#ef4444",
};

export class VRRCapitalView extends HTMLElement {
  private shadow: ShadowRoot;
  private matrixChart: Chart | null = null;
  private irrChart: Chart | null = null;
  private config: VRRCapitalViewConfig = {};
  private data: VRRPosition[] = [];
  private summary: VRRSummary | null = null;
  private selectedTicker: string | null = null;
  private simulation: IRRSimulation | null = null;
  private hurdleRate: number = 8;
  private horizonYears: number = 3;
  private capitalSliderValue: number = 0;

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
    this.matrixChart?.destroy();
    this.irrChart?.destroy();
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
      await computeVRR(this.config.universe);
      const { rows } = await fetchVRRPositions({
        universe: this.config.universe,
        limit: this.config.limit || 30,
      });
      this.data = rows;
      this.summary = await fetchVRRSummary({ universe: this.config.universe });

      // Auto-select first ticker with highest IRR
      if (rows.length > 0 && !this.selectedTicker) {
        this.selectedTicker = rows[0].ticker;
        await this.loadSimulation(rows[0].ticker);
      }

      this.renderSummary();
      this.renderGauges();
      this.renderMatrix();
      this.renderInsights();
    } catch (e) {
      console.error("Failed to fetch VRR data:", e);
      const container = this.shadow.getElementById("gauges-container");
      if (container) {
        container.innerHTML = `<div class="empty-state">Failed to load data. Ensure the backend is running and data has been ingested.</div>`;
      }
    }
  }

  private async loadSimulation(ticker: string) {
    try {
      this.simulation = await simulateMarginalIRR({
        ticker,
        horizon_years: this.horizonYears,
        hurdle_rate: this.hurdleRate,
        capital_steps: 20,
      });
      this.selectedTicker = ticker;
      this.capitalSliderValue = 0;
      this.renderIRRSimulator();
    } catch (e) {
      console.error("Failed to simulate IRR:", e);
    }
  }

  private renderSummary() {
    const el = this.shadow.getElementById("summary-bar");
    if (!el || !this.summary) return;

    const s = this.summary;
    const bestTicker = s.best_opportunity.ticker || "—";
    const bestIRR = s.best_opportunity.marginal_irr_3yr?.toFixed(1) || "—";

    el.innerHTML = `
      <div class="summary-item">
        <span class="summary-label">Avg VRR</span>
        <span class="summary-value">${s.avg_vrr}%</span>
        <span class="summary-sub">across all positions</span>
      </div>
      <div class="summary-item highlight">
        <span class="summary-label">Best opportunity</span>
        <span class="summary-value ticker-link" data-ticker="${bestTicker}">${bestTicker}</span>
        <span class="summary-sub">highest marginal IRR</span>
      </div>
      <div class="summary-item positive">
        <span class="summary-label">Positions to add</span>
        <span class="summary-value">${s.positions_to_add}</span>
        <span class="summary-sub">wide spread + velocity</span>
      </div>
      <div class="summary-item warning">
        <span class="summary-label">Positions to rotate</span>
        <span class="summary-value">${s.positions_to_rotate}</span>
        <span class="summary-sub">narrow spread + slow</span>
      </div>
    `;

    // Ticker link click
    el.querySelectorAll(".ticker-link").forEach((link) => {
      link.addEventListener("click", () => {
        const ticker = (link as HTMLElement).dataset.ticker;
        if (ticker) {
          this.loadSimulation(ticker);
        }
      });
    });
  }

  private renderGauges() {
    const container = this.shadow.getElementById("gauges-container");
    if (!container || this.data.length === 0) return;

    const gaugesHtml = this.data
      .sort((a, b) => b.marginal_irr_3yr - a.marginal_irr_3yr)
      .slice(0, 8)
      .map((d) => {
        const vrr = d.vrr_pct || 0;
        const spread = d.spread_pct || 0;
        const velColor = VELOCITY_COLORS[d.velocity_label] || "#94a3b8";
        const actionColors = ACTION_COLORS[d.action] || ACTION_COLORS.hold;
        const actionLabel = d.action.replace(/_/g, " ");

        return `
          <div class="gauge-row" data-ticker="${d.ticker}">
            <div class="gauge-info">
              <span class="gauge-ticker ticker-link" data-ticker="${d.ticker}">${d.ticker}</span>
              <span class="gauge-vrr">${vrr.toFixed(0)}%</span>
              <span class="gauge-spread">thesis realized · ${spread.toFixed(0)}% spread left</span>
            </div>
            <div class="gauge-bar-wrapper">
              <div class="gauge-bar">
                <div class="gauge-fill" style="width: ${vrr}%; background: ${velColor};"></div>
              </div>
              <span class="velocity-badge" style="background: ${velColor}22; color: ${velColor}; border: 1px solid ${velColor}44;">${d.velocity_label}</span>
            </div>
            <span class="action-label" style="background: ${actionColors.bg}; color: ${actionColors.text}; border: 1px solid ${actionColors.border};">${actionLabel}</span>
          </div>
        `;
      })
      .join("");

    container.innerHTML = `
      <div class="section-header">
        <span class="section-title">Position VRR gauges — how much thesis has been realized</span>
      </div>
      ${gaugesHtml}
    `;

    // Click handler for gauge rows
    container.querySelectorAll(".gauge-row, .ticker-link").forEach((el) => {
      el.addEventListener("click", () => {
        const ticker = (el as HTMLElement).dataset.ticker;
        if (ticker) this.loadSimulation(ticker);
      });
    });
  }

  private renderMatrix() {
    const canvas = this.shadow.getElementById("matrix-chart") as HTMLCanvasElement;
    if (!canvas) return;

    this.matrixChart?.destroy();

    const actionBubbleColor = (d: VRRPosition): string => {
      const colors: Record<string, string> = {
        add_aggressively: "rgba(74, 222, 128, 0.7)",
        add_capital: "rgba(34, 197, 94, 0.6)",
        hold: "rgba(59, 130, 246, 0.5)",
        patience: "rgba(251, 191, 36, 0.5)",
        rotate: "rgba(239, 68, 68, 0.5)",
      };
      return colors[d.action] || "rgba(148, 163, 184, 0.4)";
    };

    const actionBorderColor = (d: VRRPosition): string => {
      const colors: Record<string, string> = {
        add_aggressively: "rgba(74, 222, 128, 0.9)",
        add_capital: "rgba(34, 197, 94, 0.8)",
        hold: "rgba(59, 130, 246, 0.7)",
        patience: "rgba(251, 191, 36, 0.7)",
        rotate: "rgba(239, 68, 68, 0.7)",
      };
      return colors[d.action] || "rgba(148, 163, 184, 0.6)";
    };

    this.matrixChart = new Chart(canvas, {
      type: "bubble",
      data: {
        datasets: [
          {
            label: "Positions",
            data: this.data.map((d) => ({
              x: d.velocity,
              y: d.spread_pct,
              r: Math.max(5, Math.min(20, 5 + Math.log10(Math.max(1, d.market_cap / 1e9)) * 4)),
              _point: d,
            })),
            backgroundColor: this.data.map(actionBubbleColor),
            borderColor: this.data.map(actionBorderColor),
            borderWidth: 1.5,
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
                const d = ctx.raw._point as VRRPosition;
                return [
                  `${d.ticker}`,
                  `Velocity: ${d.velocity.toFixed(1)} (${d.velocity_label})`,
                  `Spread: ${d.spread_pct.toFixed(1)}%`,
                  `VRR: ${d.vrr_pct.toFixed(1)}%`,
                  `Kelly: ${d.kelly_fraction.toFixed(1)}%`,
                  `IRR 3yr: ${d.marginal_irr_3yr.toFixed(1)}%`,
                  `Action: ${d.action.replace(/_/g, " ")}`,
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
            min: 0, max: 100,
            title: { display: true, text: "Velocity → (IVRV-derived)", color: "#94a3b8", font: { size: 10 } },
            grid: { color: "rgba(148, 163, 184, 0.08)" },
            ticks: { color: "#64748b" },
          },
          y: {
            min: 0, max: 100,
            title: { display: true, text: "↑ Spread (valuation compression)", color: "#94a3b8", font: { size: 10 } },
            grid: { color: "rgba(148, 163, 184, 0.08)" },
            ticks: { color: "#64748b" },
          },
        },
        onClick: (_event: any, elements: any[]) => {
          if (elements.length > 0) {
            const idx = elements[0].index;
            const point = this.matrixChart!.data.datasets[0].data[idx] as any;
            const d = point._point as VRRPosition;
            this.loadSimulation(d.ticker);
          }
        },
      },
      plugins: [
        {
          id: "quadrantLines",
          beforeDraw: (chart: any) => {
            const { ctx, chartArea, scales } = chart;
            if (!chartArea) return;

            const x50 = scales.x.getPixelForValue(50);
            const y50 = scales.y.getPixelForValue(50);
            const x0 = scales.x.getPixelForValue(0);
            const x100 = scales.x.getPixelForValue(100);
            const y0 = scales.y.getPixelForValue(0);
            const y100 = scales.y.getPixelForValue(100);

            ctx.save();
            ctx.setLineDash([6, 4]);
            ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
            ctx.lineWidth = 1;

            // Vertical line at x=50
            ctx.beginPath();
            ctx.moveTo(x50, y0);
            ctx.lineTo(x50, y100);
            ctx.stroke();

            // Horizontal line at y=50
            ctx.beginPath();
            ctx.moveTo(x0, y50);
            ctx.lineTo(x100, y50);
            ctx.stroke();

            ctx.setLineDash([]);

            // Quadrant labels
            ctx.font = "600 10px system-ui";
            ctx.textAlign = "center";

            // Top-right: Add aggressively
            ctx.fillStyle = "rgba(74, 222, 128, 0.5)";
            ctx.fillText("Add aggressively", (x50 + x100) / 2, (y50 + y100) / 2 - 4);

            // Bottom-right: Hold, let it run
            ctx.fillStyle = "rgba(59, 130, 246, 0.5)";
            ctx.fillText("Hold, let it run", (x50 + x100) / 2, (y0 + y50) / 2 - 4);

            // Top-left: Patience required
            ctx.fillStyle = "rgba(251, 191, 36, 0.5)";
            ctx.fillText("Patience required", (x0 + x50) / 2, (y50 + y100) / 2 - 4);

            // Bottom-left: Rotate
            ctx.fillStyle = "rgba(239, 68, 68, 0.5)";
            ctx.fillText("Rotate", (x0 + x50) / 2, (y0 + y50) / 2 - 4);

            ctx.restore();
          },
        },
        {
          id: "tickerLabels",
          afterDraw: (chart: any) => {
            const { ctx } = chart;
            ctx.save();
            ctx.font = "600 8px ui-monospace, monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            const meta = chart.getDatasetMeta(0);
            meta.data.forEach((point: any, i: number) => {
              const d = this.data[i];
              if (!d) return;
              ctx.fillStyle = "rgba(226, 232, 240, 0.7)";
              ctx.fillText(d.ticker, point.x, point.y - point.options.radius - 6);
            });

            ctx.restore();
          },
        },
      ],
    });
  }

  private renderIRRSimulator() {
    const container = this.shadow.getElementById("irr-simulator");
    if (!container) return;

    const sim = this.simulation;
    const ticker = sim?.ticker || this.selectedTicker || "—";

    if (!sim) {
      container.innerHTML = `<div class="empty-state">Select a ticker from the gauges or matrix above to see the IRR simulator.</div>`;
      return;
    }

    const basePoint = sim.points[0];
    const currentIRR = basePoint?.irr.toFixed(1) || "—";
    const currentKelly = basePoint?.kelly.toFixed(1) || "—";

    container.innerHTML = `
      <div class="section-header">
        <span class="section-title">Kelly + Marginal IRR Simulator</span>
        <span class="section-sub">— ${ticker}</span>
        <div class="irr-controls">
          <label class="control-label">
            Horizon
            <select id="horizon-select">
              <option value="3" ${this.horizonYears === 3 ? "selected" : ""}>3yr</option>
              <option value="7" ${this.horizonYears === 7 ? "selected" : ""}>7yr</option>
            </select>
          </label>
          <label class="control-label">
            Hurdle rate
            <input type="range" id="hurdle-slider" min="3" max="15" step="0.5" value="${this.hurdleRate}" />
            <span id="hurdle-value">${this.hurdleRate}%</span>
          </label>
          <label class="control-label">
            Add capital
            <input type="range" id="capital-slider" min="0" max="200" step="10" value="${this.capitalSliderValue}" />
            <span id="capital-value">${this.capitalSliderValue}%</span>
          </label>
        </div>
      </div>
      <div class="irr-readout">
        ${renderMetricBadge("marginal_irr", currentIRR)}${renderMetricBadge("kelly_fraction", currentKelly)}
        <span class="readout-detail">Base IRR at current position · Kelly = optimal fraction</span>
      </div>
      <div class="irr-chart-container">
        <canvas id="irr-chart"></canvas>
      </div>
      <div id="irr-zone-readout" class="zone-readout"></div>
    `;

    // Bind controls
    const horizonSelect = this.shadow.getElementById("horizon-select") as HTMLSelectElement;
    const hurdleSlider = this.shadow.getElementById("hurdle-slider") as HTMLInputElement;
    const capitalSlider = this.shadow.getElementById("capital-slider") as HTMLInputElement;

    if (horizonSelect) {
      horizonSelect.addEventListener("change", () => {
        this.horizonYears = parseInt(horizonSelect.value);
        this.loadSimulation(this.selectedTicker!);
      });
    }
    if (hurdleSlider) {
      hurdleSlider.addEventListener("input", () => {
        this.hurdleRate = parseFloat(hurdleSlider.value);
        const valEl = this.shadow.getElementById("hurdle-value");
        if (valEl) valEl.textContent = `${this.hurdleRate}%`;
        this.loadSimulation(this.selectedTicker!);
      });
    }
    if (capitalSlider) {
      capitalSlider.addEventListener("input", () => {
        this.capitalSliderValue = parseInt(capitalSlider.value);
        const valEl = this.shadow.getElementById("capital-value");
        if (valEl) valEl.textContent = `${this.capitalSliderValue}%`;
        this.updateZoneReadout();
        this.updateCapitalIndicator();
      });
    }

    this.renderIRRChart();
    this.updateZoneReadout();
  }

  private renderIRRChart() {
    const canvas = this.shadow.getElementById("irr-chart") as HTMLCanvasElement;
    if (!canvas || !this.simulation) return;

    this.irrChart?.destroy();

    const points = this.simulation.points;
    const hurdleRate = this.hurdleRate;

    // Find crossover point (where IRR drops below hurdle)
    let crossoverIdx = points.findIndex((p) => p.irr <= hurdleRate);
    if (crossoverIdx === -1) crossoverIdx = points.length;

    this.irrChart = new Chart(canvas, {
      type: "line",
      data: {
        labels: points.map((p) => `${p.capital_pct.toFixed(0)}%`),
        datasets: [
          {
            label: "Marginal IRR",
            data: points.map((p) => p.irr),
            borderColor: "#3b82f6",
            backgroundColor: "rgba(59, 130, 246, 0.1)",
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2,
            yAxisID: "y",
          },
          {
            label: "Kelly Fraction",
            data: points.map((p) => p.kelly),
            borderColor: "#a78bfa",
            borderDash: [],
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 1.5,
            yAxisID: "y1",
          },
          {
            label: "Half-Kelly",
            data: points.map((p) => p.half_kelly),
            borderColor: "rgba(167, 139, 250, 0.4)",
            borderDash: [4, 4],
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 1,
            yAxisID: "y1",
          },
          {
            label: "Hurdle Rate",
            data: points.map(() => hurdleRate),
            borderColor: "rgba(239, 68, 68, 0.6)",
            borderDash: [8, 4],
            pointRadius: 0,
            borderWidth: 1.5,
            yAxisID: "y",
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
                if (ctx.datasetIndex === 0) return `IRR: ${p.irr.toFixed(1)}%`;
                if (ctx.datasetIndex === 1) return `Kelly: ${p.kelly.toFixed(1)}%`;
                if (ctx.datasetIndex === 2) return `Half-Kelly: ${p.half_kelly.toFixed(1)}%`;
                return `Hurdle: ${hurdleRate}%`;
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
            title: { display: true, text: "Additional Capital Deployed (% of position)", color: "#94a3b8", font: { size: 10 } },
            grid: { color: "rgba(148, 163, 184, 0.08)" },
            ticks: { color: "#64748b", maxTicksLimit: 10 },
          },
          y: {
            position: "left",
            title: { display: true, text: "Marginal IRR %", color: "#3b82f6", font: { size: 10 } },
            grid: { color: "rgba(148, 163, 184, 0.08)" },
            ticks: { color: "#64748b" },
          },
          y1: {
            position: "right",
            min: 0, max: 30,
            title: { display: true, text: "Kelly Fraction %", color: "#a78bfa", font: { size: 10 } },
            grid: { drawOnChartArea: false },
            ticks: { color: "#64748b" },
          },
        },
      },
      plugins: [
        {
          id: "zoneShading",
          beforeDraw: (chart: any) => {
            const { ctx, chartArea, scales } = chart;
            if (!chartArea || crossoverIdx === 0) return;

            const xStart = scales.x.getPixelForValue(0);
            const xCrossover = crossoverIdx < points.length
              ? scales.x.getPixelForValue(crossoverIdx)
              : scales.x.getPixelForValue(points.length - 1);

            // Zone 1: deploy (green) — from 0 to ~half of crossover
            const xMid = xStart + (xCrossover - xStart) * 0.6;
            ctx.save();
            ctx.fillStyle = "rgba(74, 222, 128, 0.04)";
            ctx.fillRect(xStart, chartArea.top, xMid - xStart, chartArea.bottom - chartArea.top);

            // Zone 2: diminishing (amber)
            ctx.fillStyle = "rgba(251, 191, 36, 0.04)";
            ctx.fillRect(xMid, chartArea.top, xCrossover - xMid, chartArea.bottom - chartArea.top);

            // Zone 3: stop (red) — from crossover to end
            ctx.fillStyle = "rgba(239, 68, 68, 0.04)";
            ctx.fillRect(xCrossover, chartArea.top, chartArea.right - xCrossover, chartArea.bottom - chartArea.top);

            ctx.restore();
          },
        },
        {
          id: "capitalIndicator",
          afterDraw: (chart: any) => {
            if (this.capitalSliderValue === 0) return;
            const { ctx, scales, chartArea } = chart;
            if (!chartArea) return;

            // Find the index closest to capitalSliderValue
            const idx = Math.round((this.capitalSliderValue / 200) * (points.length - 1));
            const x = scales.x.getPixelForValue(idx);

            ctx.save();
            ctx.strokeStyle = "rgba(226, 232, 240, 0.5)";
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(x, chartArea.top);
            ctx.lineTo(x, chartArea.bottom);
            ctx.stroke();
            ctx.restore();
          },
        },
      ],
    });
  }

  private updateZoneReadout() {
    const el = this.shadow.getElementById("irr-zone-readout");
    if (!el || !this.simulation) return;

    const points = this.simulation.points;
    const idx = Math.round((this.capitalSliderValue / 200) * (points.length - 1));
    const p = points[Math.min(idx, points.length - 1)];
    if (!p) return;

    const zoneLabel = p.zone === "deploy" ? "Deploy capital"
      : p.zone === "diminishing" ? "Diminishing returns — half-Kelly discipline"
      : "Stop adding — value trap boundary";

    const zoneColor = p.zone === "deploy" ? "#4ade80"
      : p.zone === "diminishing" ? "#fbbf24"
      : "#ef4444";

    el.innerHTML = `
      <span class="zone-badge" style="color: ${zoneColor}; border-color: ${zoneColor}44; background: ${zoneColor}11;">
        At +${p.capital_pct.toFixed(0)}% capital: IRR ${p.irr.toFixed(1)}%, Kelly ${p.kelly.toFixed(1)}% → ${zoneLabel}
      </span>
    `;
  }

  private updateCapitalIndicator() {
    // Just redraw the chart to update the vertical indicator
    this.irrChart?.update("none");
  }

  private renderInsights() {
    const container = this.shadow.getElementById("insights-container");
    if (!container || this.data.length === 0) return;

    const insights: Insight[] = [];

    // Add aggressively positions
    const addAggressive = this.data.filter((d) => d.action === "add_aggressively");
    if (addAggressive.length > 0) {
      insights.push({
        icon: "🎯",
        text: `${addAggressive.length} position${addAggressive.length > 1 ? "s" : ""} in add-aggressively zone: ${addAggressive.map((d) => d.ticker).slice(0, 5).join(", ")}`,
        type: "positive",
      });
    }

    // Fast velocity with high spread — ideal add zone
    const fastWide = this.data.filter((d) => d.velocity_label === "fast" && d.spread_pct > 50);
    if (fastWide.length > 0) {
      insights.push({
        icon: "⚡",
        text: `${fastWide.length} stock${fastWide.length > 1 ? "s" : ""} with fast velocity + wide spread — ideal add zone (${fastWide.map((d) => d.ticker).slice(0, 4).join(", ")})`,
        type: "positive",
      });
    }

    // Value trap signals: high spread + slow velocity
    const traps = this.data.filter((d) => d.spread_pct > 50 && d.velocity_label === "slow");
    if (traps.length > 0) {
      insights.push({
        icon: "⚠️",
        text: `${traps.length} stock${traps.length > 1 ? "s" : ""} with wide spread but slow velocity — potential value traps (${traps.map((d) => d.ticker).slice(0, 4).join(", ")})`,
        type: "warning",
      });
    }

    // Rotate signals
    const rotate = this.data.filter((d) => d.action === "rotate");
    if (rotate.length > 0) {
      insights.push({
        icon: "🔄",
        text: `${rotate.length} position${rotate.length > 1 ? "s" : ""} in rotate territory: narrow spread + slow velocity`,
        type: "warning",
      });
    }

    // High Kelly positions
    const highKelly = this.data.filter((d) => d.kelly_fraction > 10);
    if (highKelly.length > 0) {
      insights.push({
        icon: "💰",
        text: `${highKelly.length} position${highKelly.length > 1 ? "s" : ""} with Kelly fraction > 10% — math supports significant sizing`,
        type: "positive",
      });
    }

    container.innerHTML = renderInsightsSection(insights.slice(0, 4));

    // Ticker links
    const tickerContainer = this.shadow.getElementById("add-tickers");
    if (tickerContainer && addAggressive.length > 0) {
      tickerContainer.innerHTML = `
        <div class="chart-header">
          <span class="chart-title">Add Aggressively</span>
        </div>
        <div class="ticker-list">
          ${renderTickerBadges(
            addAggressive.map((d) => d.ticker),
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
        .summary-item.positive {
          border-color: rgba(34, 197, 94, 0.2);
        }
        .summary-item.warning {
          border-color: rgba(239, 68, 68, 0.2);
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

        /* VRR Gauge bars */
        .gauges-section {
          padding: 0.75rem 1rem;
          border-bottom: 1px solid rgba(148, 163, 184, 0.1);
        }
        .gauge-row {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.5rem 0;
          border-bottom: 1px solid rgba(148, 163, 184, 0.06);
          cursor: pointer;
          transition: background 0.15s;
        }
        .gauge-row:hover {
          background: rgba(59, 130, 246, 0.05);
        }
        .gauge-row:last-child {
          border-bottom: none;
        }
        .gauge-info {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          min-width: 200px;
        }
        .gauge-ticker {
          font-size: 0.85rem;
          font-weight: 700;
          color: #f1f5f9;
          font-family: ui-monospace, monospace;
          cursor: pointer;
        }
        .gauge-ticker:hover {
          color: #3b82f6;
        }
        .gauge-vrr {
          font-size: 0.85rem;
          font-weight: 600;
          color: #4ade80;
          font-family: ui-monospace, monospace;
        }
        .gauge-spread {
          font-size: 0.7rem;
          color: #64748b;
        }
        .gauge-bar-wrapper {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .gauge-bar {
          flex: 1;
          height: 8px;
          background: rgba(30, 41, 59, 0.8);
          border-radius: 4px;
          overflow: hidden;
        }
        .gauge-fill {
          height: 100%;
          border-radius: 4px;
          transition: width 0.3s ease;
        }
        .velocity-badge {
          font-size: 0.6rem;
          padding: 0.1rem 0.4rem;
          border-radius: 3px;
          font-weight: 600;
          white-space: nowrap;
        }
        .action-label {
          font-size: 0.65rem;
          padding: 0.15rem 0.5rem;
          border-radius: 4px;
          font-weight: 500;
          white-space: nowrap;
        }

        /* Deployment matrix */
        .matrix-section {
          padding: 0.75rem 1rem;
          border-bottom: 1px solid rgba(148, 163, 184, 0.1);
        }
        .matrix-chart-container {
          position: relative;
          height: 280px;
        }

        /* IRR Simulator */
        .irr-section {
          padding: 0.75rem 1rem;
        }
        .irr-controls {
          display: flex;
          gap: 1rem;
          margin-left: auto;
          flex-wrap: wrap;
        }
        .control-label {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          font-size: 0.7rem;
          color: #94a3b8;
        }
        .control-label select,
        .control-label input[type="range"] {
          background: rgba(30, 41, 59, 0.8);
          border: 1px solid rgba(148, 163, 184, 0.2);
          color: #e2e8f0;
          border-radius: 4px;
          font-size: 0.7rem;
          padding: 0.15rem 0.3rem;
        }
        .control-label input[type="range"] {
          width: 80px;
          padding: 0;
          height: 4px;
          -webkit-appearance: none;
          appearance: none;
        }
        .control-label input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
        }
        .irr-readout {
          display: flex;
          gap: 0.75rem;
          align-items: center;
          flex-wrap: wrap;
          margin-bottom: 0.5rem;
        }
        .readout-detail {
          font-size: 0.7rem;
          color: #475569;
        }
        .irr-chart-container {
          position: relative;
          height: 240px;
        }
        .zone-readout {
          margin-top: 0.5rem;
          text-align: center;
        }
        .zone-badge {
          display: inline-block;
          font-size: 0.75rem;
          font-weight: 500;
          padding: 0.3rem 0.75rem;
          border-radius: 6px;
          border: 1px solid;
        }
      </style>

      <div class="container">
        <div class="header">
          <span class="title">VRR Capital Deployment</span>
        </div>

        <div id="summary-bar" class="summary-bar">
          <div class="summary-item"><span class="summary-label">Loading...</span></div>
        </div>

        <div id="gauges-container" class="gauges-section">
          <div class="loading">Loading VRR gauges...</div>
        </div>

        <div class="matrix-section">
          <div class="section-header">
            <span class="section-title">Capital deployment matrix</span>
          </div>
          <div class="matrix-chart-container">
            <canvas id="matrix-chart"></canvas>
          </div>
        </div>

        <div id="irr-simulator" class="irr-section">
          <div class="loading">Loading IRR simulator...</div>
        </div>

        <div id="insights-container" class="insights-section" style="margin: 0.75rem 1rem;"></div>
        <div id="add-tickers" style="padding: 0 1rem 0.75rem;"></div>
      </div>
    `;
  }
}

customElements.define("vrr-capital-view", VRRCapitalView);
