/**
 * chartZoom.ts — centralized zoom/pan for every Chart.js chart.
 *
 * Why central: the dashboard creates Chart.js instances across ~14 Web
 * Components, each in its own Shadow DOM. Instead of wrapping every
 * `new Chart(...)` call, we:
 *   1. register chartjs-plugin-zoom once,
 *   2. set Chart.defaults.plugins.zoom so wheel/pinch zoom + drag pan apply
 *      to ALL charts automatically,
 *   3. register a companion `zoomOverlay` plugin that, on each chart init,
 *      injects a "reset zoom" button + a responsive <style> into the chart's
 *      canvas root (ShadowRoot or document), and
 *   4. wire a global click + dblclick handler (using composedPath so it
 *      crosses Shadow DOM) to reset zoom via Chart.getChart.
 *
 * Call `registerChartZoom()` once at app startup (idempotent).
 */

import { Chart } from "chart.js";
import zoomPlugin from "chartjs-plugin-zoom";

// Styles injected into each chart's canvas root. Lives inside Shadow DOM so
// container queries here are isolated and correct. `.chart-container` is the
// conventional wrapper used across the codebase; we also handle canvases whose
// parent lacks that class by promoting the parent to a positioning context.
export const CHART_ZOOM_CSS = `
  .chart-container {
    position: relative;
    container-type: inline-size;
  }
  /* Give narrow (mobile) chart panels a taller min height so data stays legible */
  @container (max-width: 420px) {
    .chart-container { min-height: 240px; }
  }
  .chart-zoom-reset {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 6px;
    background: rgba(15, 23, 42, 0.7);
    color: #94a3b8;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    opacity: 0.5;
    transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
    z-index: 5;
  }
  .chart-zoom-reset:hover {
    opacity: 1;
    background: rgba(30, 41, 59, 0.9);
    color: #e2e8f0;
  }
  .chart-container.zoomed .chart-zoom-reset {
    opacity: 1;
    color: #60a5fa;
    border-color: rgba(96, 165, 250, 0.5);
  }
  .chart-zoom-hint {
    position: absolute;
    bottom: 4px;
    left: 6px;
    font-size: 0.6rem;
    color: #64748b;
    pointer-events: none;
    opacity: 0.45;
    transition: opacity 0.2s ease;
  }
  .chart-container.zoomed .chart-zoom-hint { opacity: 0; }
  @container (max-width: 420px) {
    .chart-zoom-hint { display: none; }
  }
`;

function markZoomed(chart: Chart) {
  const container = chart.canvas.closest(".chart-container");
  container?.classList.add("zoomed");
}

// Companion plugin: injects the reset button + responsive styles into each
// chart's canvas root once, right after the chart is constructed.
const zoomOverlayPlugin = {
  id: "zoomOverlay",
  afterInit(chart: Chart) {
    const canvas = chart.canvas;
    if (!canvas) return;
    const container =
      canvas.closest(".chart-container") || (canvas.parentElement as HTMLElement | null);
    if (!container) return;

    const root = canvas.getRootNode() as ShadowRoot | Document;

    // Inject the stylesheet once per root (ShadowRoot or document head).
    if (root.nodeType === 11 /* Document.DOCUMENT_FRAGMENT_NODE (ShadowRoot) */) {
      if (!(root as ShadowRoot).querySelector("style[data-chart-zoom]")) {
        const style = document.createElement("style");
        style.setAttribute("data-chart-zoom", "");
        style.textContent = CHART_ZOOM_CSS;
        (root as ShadowRoot).appendChild(style);
      }
    } else {
      if (!document.getElementById("chart-zoom-style")) {
        const style = document.createElement("style");
        style.id = "chart-zoom-style";
        style.textContent = CHART_ZOOM_CSS;
        document.head.appendChild(style);
      }
    }

    // Ensure the container is the positioning context for the button.
    container.classList.add("chart-container");

    if (container.querySelector(".chart-zoom-reset")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chart-zoom-reset";
    btn.title = "Reset zoom";
    btn.setAttribute("aria-label", "Reset zoom");
    btn.textContent = "⤢";

    const hint = document.createElement("span");
    hint.className = "chart-zoom-hint";
    hint.textContent = "scroll/pinch to zoom · drag to pan";

    container.appendChild(btn);
    container.appendChild(hint);
  },
};

let registered = false;

/**
 * Register the zoom plugin, set global pan/zoom defaults, register the overlay
 * plugin, and wire global reset handlers. Safe to call multiple times.
 */
export function registerChartZoom(): void {
  if (registered) return;
  registered = true;

  Chart.register(zoomPlugin);
  Chart.register(zoomOverlayPlugin);

  // Global defaults: wheel + pinch zoom, drag pan, both axes. Drag-to-zoom is
  // left disabled so a mouse drag pans instead of box-selecting.
  const panZoomDefaults = {
    pan: {
      enabled: true,
      mode: "xy" as const,
      onPanComplete: ({ chart }: { chart: Chart }) => markZoomed(chart),
    },
    zoom: {
      wheel: { enabled: true, speed: 0.1 },
      pinch: { enabled: true },
      mode: "xy" as const,
      onZoomComplete: ({ chart }: { chart: Chart }) => markZoomed(chart),
    },
  };
  (Chart.defaults.plugins as unknown as Record<string, unknown>).zoom = panZoomDefaults;

  // Global reset: button click (crosses Shadow DOM via composedPath).
  document.addEventListener(
    "click",
    (e) => {
      const path = e.composedPath();
      const btn = path.find(
        (el): el is HTMLElement =>
          el instanceof HTMLElement && el.classList.contains("chart-zoom-reset")
      );
      if (!btn) return;
      const container = btn.closest(".chart-container");
      const canvas = container?.querySelector("canvas");
      if (!canvas) return;
      const chart = Chart.getChart(canvas);
      if (chart) {
        chart.resetZoom();
        container?.classList.remove("zoomed");
      }
    },
    true
  );

  // Global reset: double-click anywhere on a chart canvas (desktop convenience).
  document.addEventListener(
    "dblclick",
    (e) => {
      const path = e.composedPath();
      const canvas = path.find((el): el is HTMLCanvasElement => el instanceof HTMLCanvasElement);
      if (!canvas) return;
      const chart = Chart.getChart(canvas);
      if (!chart) return;
      const container = canvas.closest(".chart-container");
      chart.resetZoom();
      container?.classList.remove("zoomed");
    },
    true
  );
}
