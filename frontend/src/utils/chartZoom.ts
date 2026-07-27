/**
 * chartZoom.ts — centralized zoom/pan for every Chart.js chart, mobile-aware.
 *
 * Behavior:
 *  - Desktop: wheel zoom + mouse drag pan (unchanged). Double-click or the
 *    ⤢ button resets.
 *  - Touch (pointer: coarse): page scroll wins by default. Pinch zooms the
 *    chart. A long-press (~500ms hold) toggles "pan mode" for that chart so
 *    the next drag pans freely; tap the chart, tap the indicator, or hit reset
 *    to exit pan mode. (touch-action is fixed at touchstart per gesture, so
 *    long-press arms pan mode for the *next* drag rather than mid-gesture.)
 *
 * Call `registerChartZoom()` once at app startup (idempotent).
 */

import { Chart } from "chart.js";
import zoomPlugin from "chartjs-plugin-zoom";

export const CHART_ZOOM_CSS = `
  .chart-container {
    position: relative;
    container-type: inline-size;
  }
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
  /* Hide the hint on narrow panels, except the touch variant (discoverability). */
  @container (max-width: 420px) {
    .chart-zoom-hint:not(.touch-hint) { display: none; }
    .chart-zoom-hint.touch-hint { opacity: 0.55; }
  }

  /* Long-press "pan mode" indicator (touch only) */
  .chart-pan-indicator {
    position: absolute;
    top: 4px;
    left: 50%;
    transform: translateX(-50%);
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    background: rgba(96, 165, 250, 0.15);
    border: 1px solid rgba(96, 165, 250, 0.5);
    color: #60a5fa;
    font-size: 0.65rem;
    line-height: 1.3;
    display: none;
    z-index: 6;
    cursor: pointer;
    white-space: nowrap;
    user-select: none;
  }
  .chart-container.pan-mode .chart-pan-indicator { display: block; }
  .chart-container.pan-mode {
    outline: 1px solid rgba(96, 165, 250, 0.4);
    outline-offset: -2px;
  }
`;

function isTouchDevice(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

// Per-canvas pan-mode ("armed") state and long-press/auto-dismiss timers.
const armedCanvases = new WeakSet<HTMLCanvasElement>();
const pressTimers = new WeakMap<HTMLCanvasElement, ReturnType<typeof setTimeout>>();
const disarmTimers = new WeakMap<HTMLCanvasElement, ReturnType<typeof setTimeout>>();
const touchStart = new WeakMap<HTMLCanvasElement, { x: number; y: number; t: number }>();

const PAN_PRESS_MS = 500;
const PAN_MOVE_TOLERANCE = 10;
const PAN_AUTO_DISMISS_MS = 12000;

function applyTouchAction(canvas: HTMLCanvasElement): void {
  if (!isTouchDevice()) return;
  // pan-y: browser keeps vertical page scroll; pinch still routes to the
  // plugin (pan-y does not claim pinch). When armed, none: plugin gets full pan.
  canvas.style.touchAction = armedCanvases.has(canvas) ? "none" : "pan-y";
}

function clearPressTimer(canvas: HTMLCanvasElement): void {
  const t = pressTimers.get(canvas);
  if (t) {
    clearTimeout(t);
    pressTimers.delete(canvas);
  }
}

function setPanMode(canvas: HTMLCanvasElement, on: boolean): void {
  const container = canvas.closest(".chart-container");
  if (on) {
    armedCanvases.add(canvas);
    container?.classList.add("pan-mode");
    const existing = disarmTimers.get(canvas);
    if (existing) clearTimeout(existing);
    disarmTimers.set(
      canvas,
      setTimeout(() => setPanMode(canvas, false), PAN_AUTO_DISMISS_MS)
    );
  } else {
    armedCanvases.delete(canvas);
    container?.classList.remove("pan-mode");
    const existing = disarmTimers.get(canvas);
    if (existing) {
      clearTimeout(existing);
      disarmTimers.delete(canvas);
    }
  }
  applyTouchAction(canvas);
}

function resetDisarmTimer(canvas: HTMLCanvasElement): void {
  if (!armedCanvases.has(canvas)) return;
  const existing = disarmTimers.get(canvas);
  if (existing) clearTimeout(existing);
  disarmTimers.set(
    canvas,
    setTimeout(() => setPanMode(canvas, false), PAN_AUTO_DISMISS_MS)
  );
}

function attachTouchPan(canvas: HTMLCanvasElement): void {
  if (!isTouchDevice()) return;

  canvas.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) {
        clearPressTimer(canvas);
        return;
      }
      const t = e.touches[0];
      touchStart.set(canvas, { x: t.clientX, y: t.clientY, t: Date.now() });
      // Only long-press to ARM; if already armed, this gesture may be a tap-to-exit.
      if (!armedCanvases.has(canvas)) {
        clearPressTimer(canvas);
        pressTimers.set(
          canvas,
          setTimeout(() => setPanMode(canvas, true), PAN_PRESS_MS)
        );
      }
    },
    { passive: true }
  );

  canvas.addEventListener(
    "touchmove",
    (e) => {
      const s = touchStart.get(canvas);
      if (!s) return;
      const t = e.touches[0];
      if (
        Math.abs(t.clientX - s.x) > PAN_MOVE_TOLERANCE ||
        Math.abs(t.clientY - s.y) > PAN_MOVE_TOLERANCE
      ) {
        clearPressTimer(canvas);
      }
    },
    { passive: true }
  );

  canvas.addEventListener(
    "touchend",
    (e) => {
      const s = touchStart.get(canvas);
      clearPressTimer(canvas);
      if (s && e.changedTouches.length === 1) {
        const ct = e.changedTouches[0];
        const moved =
          Math.abs(ct.clientX - s.x) > PAN_MOVE_TOLERANCE ||
          Math.abs(ct.clientY - s.y) > PAN_MOVE_TOLERANCE;
        const quick = Date.now() - s.t < 250;
        // Tap on an armed chart exits pan mode.
        if (armedCanvases.has(canvas) && quick && !moved) {
          setPanMode(canvas, false);
        }
      }
      touchStart.delete(canvas);
    },
    { passive: true }
  );

  canvas.addEventListener(
    "touchcancel",
    () => {
      clearPressTimer(canvas);
      touchStart.delete(canvas);
    },
    { passive: true }
  );
}

function markZoomed(chart: Chart): void {
  const container = chart.canvas.closest(".chart-container");
  container?.classList.add("zoomed");
}

// Companion plugin: injects reset button + hint + pan indicator into each
// chart's canvas root, asserts touch-action, and wires touch long-press pan.
const zoomOverlayPlugin = {
  id: "zoomOverlay",
  afterInit(chart: Chart) {
    const canvas = chart.canvas;
    if (!canvas) return;
    const container =
      canvas.closest(".chart-container") || (canvas.parentElement as HTMLElement | null);
    if (!container) return;

    const root = canvas.getRootNode() as ShadowRoot | Document;
    if (root.nodeType === 11 /* ShadowRoot */) {
      if (!(root as ShadowRoot).querySelector("style[data-chart-zoom]")) {
        const style = document.createElement("style");
        style.setAttribute("data-chart-zoom", "");
        style.textContent = CHART_ZOOM_CSS;
        (root as ShadowRoot).appendChild(style);
      }
    } else if (!document.getElementById("chart-zoom-style")) {
      const style = document.createElement("style");
      style.id = "chart-zoom-style";
      style.textContent = CHART_ZOOM_CSS;
      document.head.appendChild(style);
    }

    container.classList.add("chart-container");

    if (!container.querySelector(".chart-zoom-reset")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chart-zoom-reset";
      btn.title = "Reset zoom";
      btn.setAttribute("aria-label", "Reset zoom");
      btn.textContent = "⤢";
      container.appendChild(btn);
    }

    if (!container.querySelector(".chart-zoom-hint")) {
      const hint = document.createElement("span");
      hint.className = "chart-zoom-hint";
      if (isTouchDevice()) {
        hint.classList.add("touch-hint");
        hint.textContent = "pinch to zoom · hold to pan";
      } else {
        hint.textContent = "scroll to zoom · drag to pan";
      }
      container.appendChild(hint);
    }

    if (!container.querySelector(".chart-pan-indicator")) {
      const ind = document.createElement("span");
      ind.className = "chart-pan-indicator";
      ind.textContent = "✋ Pan mode — drag to pan · tap to exit";
      ind.addEventListener("click", () => setPanMode(canvas, false));
      container.appendChild(ind);
    }

    attachTouchPan(canvas);
    applyTouchAction(canvas);
  },
  afterUpdate(chart: Chart) {
    // Re-assert touch-action in case hammerjs reset it on options/resize.
    applyTouchAction(chart.canvas);
  },
};

let registered = false;

export function registerChartZoom(): void {
  if (registered) return;
  registered = true;

  Chart.register(zoomPlugin);
  Chart.register(zoomOverlayPlugin);

  const panZoomDefaults = {
    pan: {
      enabled: true,
      mode: "xy" as const,
      onPanStart: (ctx: { chart: Chart; event: { pointerType?: string } }) => {
        // On touch, defer to page scroll unless the chart is in pan mode.
        if (
          isTouchDevice() &&
          (ctx as any).event?.pointerType === "touch" &&
          !armedCanvases.has(ctx.chart.canvas)
        ) {
          return false;
        }
        return undefined;
      },
      onPanComplete: ({ chart }: { chart: Chart }) => {
        markZoomed(chart);
        resetDisarmTimer(chart.canvas);
      },
    },
    zoom: {
      wheel: { enabled: true, speed: 0.1 },
      pinch: { enabled: true },
      mode: "xy" as const,
      onZoomComplete: ({ chart }: { chart: Chart }) => markZoomed(chart),
    },
  };
  (Chart.defaults.plugins as unknown as Record<string, unknown>).zoom = panZoomDefaults;

  // Reset zoom (and exit pan mode) via the overlay button. composedPath crosses
  // Shadow DOM so this works for charts inside web components.
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
      setPanMode(canvas as HTMLCanvasElement, false);
    },
    true
  );

  // Double-click on a canvas resets zoom + exits pan mode (desktop convenience).
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
      setPanMode(canvas, false);
    },
    true
  );
}
