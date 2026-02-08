/**
 * blocks-finance - Unified Dashboard
 * 
 * Single dashboard page where each panel is independently configurable.
 * Panels can be screeners, charts, tables, etc.
 * 
 * Features:
 * - Gridstack for drag/resize/reorder
 * - Global universe control
 * - Saved dashboard views
 * - Metric tooltips
 */

import "./components/DashboardPanel";
import "./components/TorqueScatter";
import "./components/TorqueRankingTable";
import "./components/TorqueHeatmap";
import "./components/ViewExplainer";
import "./components/VisualizationAssistant";
import "./components/ViewInsights";
import "./components/UniverseInsights";
import "./components/SearchCombobox";
import "./components/StockDetailView";
import "./components/archetypes";
import "./components/WhaleTrackerPanel";
import "./components/MacroOverviewPanel";
import "./components/InsiderActivityPanel";
import "./components/CompanyNewsPanel";
import { type PanelConfig } from "./components/DashboardPanel";
import { FINANCE_RECIPES_REGISTRY } from "./recipes/financeRecipes";
import { renderUniverseInsights } from "./components/UniverseInsights";
import { GridStack } from "gridstack";
import "gridstack/dist/gridstack.css";

// Default panels to show on load
const DEFAULT_PANELS: PanelConfig[] = [
  {
    id: "panel:torque-scatter",
    title: "Torque Scatter: Earnings vs Valuation",
    type: "torque-scatter" as any,
    limit: 30,
  },
  {
    id: "panel:torque-heatmap",
    title: "Torque Heatmap",
    type: "torque-heatmap" as any,
    limit: 20,
  },
];

// State
let panels: PanelConfig[] = [...DEFAULT_PANELS];
let globalUniverse: string[] | null = null;
let savedUniverses: Array<{ name: string; tickers: string[] }> = [];
let savedDashboards: Array<{ name: string; panels: PanelConfig[]; universe: string[] | null }> = [];
let grid: GridStack | null = null;
let currentView: "dashboard" | "stock-detail" = "dashboard";
let selectedTicker: string | null = null;
let editMode: boolean = false;

// Load from localStorage
const savedPanels = localStorage.getItem("blocks-finance-panels");
if (savedPanels) {
  try {
    panels = JSON.parse(savedPanels);
  } catch (e) {
    console.warn("Failed to load saved panels:", e);
  }
}

const savedUniversesStr = localStorage.getItem("blocks-finance-universes");
if (savedUniversesStr) {
  try {
    savedUniverses = JSON.parse(savedUniversesStr);
  } catch (e) {
    console.warn("Failed to load saved universes:", e);
  }
}

const savedGlobalUniverse = localStorage.getItem("blocks-finance-global-universe");
if (savedGlobalUniverse) {
  try {
    globalUniverse = JSON.parse(savedGlobalUniverse);
  } catch (e) {
    console.warn("Failed to load global universe:", e);
  }
}

const savedDashboardsStr = localStorage.getItem("blocks-finance-dashboards");
if (savedDashboardsStr) {
  try {
    savedDashboards = JSON.parse(savedDashboardsStr);
  } catch (e) {
    console.warn("Failed to load saved dashboards:", e);
  }
}

const savedEditMode = localStorage.getItem("blocks-finance-edit-mode");
if (savedEditMode) {
  try {
    editMode = JSON.parse(savedEditMode);
  } catch (e) {
    console.warn("Failed to load edit mode:", e);
  }
}

// Save functions
function savePanels() {
  localStorage.setItem("blocks-finance-panels", JSON.stringify(panels));
}

function saveUniverses() {
  localStorage.setItem("blocks-finance-universes", JSON.stringify(savedUniverses));
}

function saveGlobalUniverse() {
  if (globalUniverse) {
    localStorage.setItem("blocks-finance-global-universe", JSON.stringify(globalUniverse));
  } else {
    localStorage.removeItem("blocks-finance-global-universe");
  }
}

function saveDashboards() {
  localStorage.setItem("blocks-finance-dashboards", JSON.stringify(savedDashboards));
}

// Default heights by panel type (in grid rows, where cellHeight=80px)
const defaultHeights: Record<string, number> = {
  // Data panels - compact
  "greenblatt": 5,
  "screener": 6,
  "table": 5,
  // Torque visualizations - medium
  "torque-scatter": 6,
  "torque-ranking": 6,
  "torque-heatmap": 7,
  // AI insights - tall
  "universe-insights": 8,
  // Archetypes - tall (3 charts each)
  "compounders": 12,
  "qarp": 11,
  "turnarounds": 11,
  "rerating": 11,
  "capital-allocators": 11,
  "structural-winners": 11,
  "antifragile": 11,
  // Alternative data panels
  "whale-tracker": 8,
  "macro-overview": 7,
  "insider-activity": 6,
  "company-news": 6,
};

// Render all panels with GridStack integration
function renderDashboard() {
  const gridEl = document.getElementById("dashboard-grid");
  if (!gridEl) return;

  // Destroy existing grid
  if (grid) {
    grid.destroy(false);
    grid = null;
  }

  gridEl.innerHTML = "";
  gridEl.classList.add("grid-stack");

  // Show empty state if no panels
  if (panels.length === 0) {
    gridEl.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: #64748b;">
        <p style="font-size: 1rem; margin-bottom: 1rem;">No panels yet</p>
        <p style="font-size: 0.85rem;">Click "+ Add Panel" to get started</p>
      </div>
    `;
    updateUniverseUI();
    updateDashboardUI();
    return;
  }

  // Create panel elements
  for (let i = 0; i < panels.length; i++) {
    const panelConfig = panels[i];
    
    // Apply global universe if set
    const effectiveConfig = globalUniverse 
      ? { ...panelConfig, universe: globalUniverse }
      : panelConfig;
    
    // Use saved dimensions or defaults
    const gridW = panelConfig.gridW || 6;
    const gridH = panelConfig.gridH || defaultHeights[panelConfig.type as string] || 5;
    const gridX = panelConfig.gridX;
    const gridY = panelConfig.gridY;
    
    // Create grid item wrapper
    const gridItem = document.createElement("div");
    gridItem.className = "grid-stack-item";
    gridItem.setAttribute("gs-w", String(gridW));
    gridItem.setAttribute("gs-h", String(gridH));
    if (gridX !== undefined) gridItem.setAttribute("gs-x", String(gridX));
    if (gridY !== undefined) gridItem.setAttribute("gs-y", String(gridY));
    gridItem.setAttribute("gs-min-w", "3");
    gridItem.setAttribute("gs-min-h", "2");
    gridItem.setAttribute("data-panel-id", panelConfig.id);
    
    const gridContent = document.createElement("div");
    gridContent.className = "grid-stack-item-content";
    
    // Special handling for universe-insights panel type
    if ((panelConfig.type as string) === "universe-insights") {
      const container = document.createElement("div");
      container.className = "universe-insights-panel";
      container.innerHTML = `<div class="panel-loading">Loading insights...</div>`;
      gridContent.appendChild(container);
      gridItem.appendChild(gridContent);
      gridEl.appendChild(gridItem);
      // Render async
      renderUniverseInsights(container, globalUniverse);
      continue;
    }
    
    // Special handling for archetype panel types
    const archetypeMap: Record<string, string> = {
      "compounders": "compounders-view",
      "qarp": "qarp-view",
      "turnarounds": "turnarounds-view",
      "rerating": "rerating-view",
      "capital-allocators": "capital-allocators-view",
      "structural-winners": "structural-winners-view",
      "antifragile": "antifragile-view",
    };
    if (archetypeMap[panelConfig.type as string]) {
      const archetypeEl = document.createElement(archetypeMap[panelConfig.type as string]);
      gridContent.appendChild(archetypeEl);
      gridItem.appendChild(gridContent);
      gridEl.appendChild(gridItem);
      continue;
    }
    
    // Special handling for alternative data panels
    const altDataMap: Record<string, string> = {
      "whale-tracker": "whale-tracker-panel",
      "macro-overview": "macro-overview-panel",
      "insider-activity": "insider-activity-panel",
      "company-news": "company-news-panel",
    };
    if (altDataMap[panelConfig.type as string]) {
      const altEl = document.createElement(altDataMap[panelConfig.type as string]);
      // Pass ticker for ticker-specific panels
      if (panelConfig.universe && panelConfig.universe.length === 1) {
        altEl.setAttribute("ticker", panelConfig.universe[0]);
      } else if (globalUniverse && globalUniverse.length === 1) {
        altEl.setAttribute("ticker", globalUniverse[0]);
      }
      gridContent.appendChild(altEl);
      gridItem.appendChild(gridContent);
      gridEl.appendChild(gridItem);
      continue;
    }
    
    const panelEl = document.createElement("dashboard-panel") as any;
    panelEl.setAttribute("config", JSON.stringify(effectiveConfig));
    
    // Listen for config changes
    panelEl.addEventListener("config-change", (e: CustomEvent) => {
      const idx = panels.findIndex(p => p.id === e.detail.id);
      if (idx >= 0) {
        panels[idx] = e.detail;
        savePanels();
      }
    });

    // Listen for panel removal
    panelEl.addEventListener("panel-remove", (e: CustomEvent) => {
      panels = panels.filter(p => p.id !== e.detail.id);
      savePanels();
      renderDashboard();
    });

    gridContent.appendChild(panelEl);
    gridItem.appendChild(gridContent);
    gridEl.appendChild(gridItem);
  }
  
  // Initialize GridStack
  grid = GridStack.init({
    column: 12,
    cellHeight: 80,
    margin: 8,
    float: true,
    animate: true,
    disableDrag: !editMode,
    disableResize: !editMode,
    draggable: {
      handle: ".panel-header, .gs-drag-handle",
    },
    resizable: {
      handles: "e, se, s, sw, w",
    },
  }, gridEl);
  
  // Save position and dimension changes automatically
  grid.on("change", (_event: any, items: any[]) => {
    // Update dimensions for changed items
    if (items && items.length > 0) {
      items.forEach((item: any) => {
        const panelId = item.el?.getAttribute("data-panel-id");
        if (panelId) {
          const panel = panels.find(p => p.id === panelId);
          if (panel) {
            panel.gridW = item.w;
            panel.gridH = item.h;
            panel.gridX = item.x;
            panel.gridY = item.y;
          }
        }
      });
    }
    
    // Reorder panels based on grid positions
    const allItems = grid!.getGridItems();
    const newOrder: PanelConfig[] = [];
    allItems.forEach(el => {
      const panelId = el.getAttribute("data-panel-id");
      const panel = panels.find(p => p.id === panelId);
      if (panel) newOrder.push(panel);
    });
    if (newOrder.length === panels.length) {
      panels = newOrder;
    }
    
    // Always save (dimensions are now included)
    savePanels();
  });
  
  // Update universe and dashboard button states
  updateUniverseUI();
  updateDashboardUI();
  updateEditModeUI();
}

// Universe control
function updateUniverseUI() {
  const btn = document.getElementById("universe-btn");
  const icon = document.getElementById("universe-icon");
  const label = document.getElementById("universe-label");
  const input = document.getElementById("universe-input") as HTMLInputElement;
  
  if (globalUniverse && globalUniverse.length > 0) {
    btn?.classList.add("active");
    if (icon) icon.textContent = "🎯";
    if (label) label.textContent = `${globalUniverse.length} stocks`;
    if (input) input.value = globalUniverse.join(", ");
  } else {
    btn?.classList.remove("active");
    if (icon) icon.textContent = "🌐";
    if (label) label.textContent = "All Stocks";
    if (input) input.value = "";
  }
  
  renderSavedUniverses();
}

function renderSavedUniverses() {
  const container = document.getElementById("universe-saved");
  if (!container) return;
  
  if (savedUniverses.length === 0) {
    container.innerHTML = `
      <div class="universe-saved-header">Saved Universes</div>
      <div style="font-size: 0.7rem; color: #64748b; padding: 0.5rem 0;">No saved universes yet</div>
    `;
    return;
  }
  
  container.innerHTML = `
    <div class="universe-saved-header">Saved Universes</div>
    ${savedUniverses.map((u, i) => `
      <div class="universe-saved-item" data-idx="${i}">
        <span>${u.name} (${u.tickers.length})</span>
        <button class="delete-btn" data-delete="${i}">×</button>
      </div>
    `).join("")}
  `;
  
  // Click to apply
  container.querySelectorAll(".universe-saved-item").forEach(item => {
    item.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("delete-btn")) return;
      const idx = parseInt(item.getAttribute("data-idx") || "0");
      globalUniverse = savedUniverses[idx].tickers;
      saveGlobalUniverse();
      renderDashboard();
      toggleUniverseDropdown(false);
    });
  });
  
  // Delete button
  container.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute("data-delete") || "0");
      savedUniverses.splice(idx, 1);
      saveUniverses();
      renderSavedUniverses();
    });
  });
}

function toggleUniverseDropdown(show?: boolean) {
  const dropdown = document.getElementById("universe-dropdown");
  if (dropdown) {
    dropdown.hidden = show === undefined ? !dropdown.hidden : !show;
  }
}

function applyUniverse() {
  const input = document.getElementById("universe-input") as HTMLInputElement;
  const val = input?.value.trim() || "";
  
  if (!val) {
    globalUniverse = null;
  } else {
    globalUniverse = val.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
    
    // Prompt to save if it's a new universe
    if (globalUniverse.length > 0) {
      const existing = savedUniverses.find(u => 
        u.tickers.length === globalUniverse!.length && 
        u.tickers.every(t => globalUniverse!.includes(t))
      );
      if (!existing) {
        const name = prompt("Save this universe? Enter a name (or cancel to skip):");
        if (name) {
          savedUniverses.push({ name, tickers: globalUniverse });
          saveUniverses();
        }
      }
    }
  }
  
  saveGlobalUniverse();
  renderDashboard();
  toggleUniverseDropdown(false);
}

function clearUniverse() {
  globalUniverse = null;
  saveGlobalUniverse();
  renderDashboard();
  toggleUniverseDropdown(false);
}

// Dashboard view controls
function updateDashboardUI() {
  renderSavedDashboards();
}

function toggleDashboardDropdown(show?: boolean) {
  const dropdown = document.getElementById("dashboard-dropdown");
  if (dropdown) {
    dropdown.hidden = show === undefined ? !dropdown.hidden : !show;
  }
}

function renderSavedDashboards() {
  const container = document.getElementById("dashboard-saved");
  if (!container) return;
  
  if (savedDashboards.length === 0) {
    container.innerHTML = `
      <div class="dashboard-saved-header">Saved Dashboards</div>
      <div style="font-size: 0.7rem; color: #64748b; padding: 0.5rem 0;">No saved dashboards yet</div>
    `;
    return;
  }
  
  container.innerHTML = `
    <div class="dashboard-saved-header">Saved Dashboards</div>
    ${savedDashboards.map((d, i) => `
      <div class="dashboard-saved-item" data-idx="${i}">
        <span>${d.name} (${d.panels.length} panels)</span>
        <button class="delete-btn" data-delete="${i}">×</button>
      </div>
    `).join("")}
  `;
  
  // Click to load
  container.querySelectorAll(".dashboard-saved-item").forEach(item => {
    item.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("delete-btn")) return;
      const idx = parseInt(item.getAttribute("data-idx") || "0");
      loadDashboardView(idx);
    });
  });
  
  // Delete button
  container.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute("data-delete") || "0");
      savedDashboards.splice(idx, 1);
      saveDashboards();
      renderSavedDashboards();
    });
  });
}

function saveDashboardView() {
  const name = prompt("Enter a name for this dashboard view:");
  if (!name) return;
  
  savedDashboards.push({
    name,
    panels: JSON.parse(JSON.stringify(panels)), // Deep copy
    universe: globalUniverse ? [...globalUniverse] : null,
  });
  
  saveDashboards();
  renderSavedDashboards();
  toggleDashboardDropdown(false);
}

function loadDashboardView(idx: number) {
  const dashboard = savedDashboards[idx];
  if (!dashboard) return;
  
  panels = JSON.parse(JSON.stringify(dashboard.panels));
  globalUniverse = dashboard.universe ? [...dashboard.universe] : null;
  
  savePanels();
  saveGlobalUniverse();
  renderDashboard();
  toggleDashboardDropdown(false);
}

function resetDashboard() {
  if (!confirm("Reset to default dashboard? This will clear current panels.")) return;
  
  panels = [...DEFAULT_PANELS];
  globalUniverse = null;
  
  savePanels();
  saveGlobalUniverse();
  renderDashboard();
  toggleDashboardDropdown(false);
}

// Edit mode controls
function toggleEditMode() {
  editMode = !editMode;
  
  if (grid) {
    if (editMode) {
      grid.enableMove(true);
      grid.enableResize(true);
    } else {
      grid.enableMove(false);
      grid.enableResize(false);
    }
  }
  
  updateEditModeUI();
  
  // Save preference
  localStorage.setItem("blocks-finance-edit-mode", JSON.stringify(editMode));
}

function updateEditModeUI() {
  const btn = document.getElementById("edit-mode-btn");
  const icon = document.getElementById("edit-mode-icon");
  const label = document.getElementById("edit-mode-label");
  const grid = document.getElementById("dashboard-grid");
  
  if (editMode) {
    btn?.classList.add("active");
    if (icon) icon.textContent = "✏️";
    if (label) label.textContent = "Editing";
    grid?.classList.add("edit-mode");
    grid?.classList.remove("view-mode");
  } else {
    btn?.classList.remove("active");
    if (icon) icon.textContent = "👁️";
    if (label) label.textContent = "View";
    grid?.classList.remove("edit-mode");
    grid?.classList.add("view-mode");
  }
}

// Render recipe picker in modal
function renderRecipePicker() {
  const picker = document.getElementById("recipe-picker");
  if (!picker) return;

  // Built-in panel types
  const builtInTypes = [
    { id: "greenblatt", title: "Greenblatt Scores", description: "Magic formula ranking", category: "data" },
    { id: "screener", title: "Stock Screener", description: "Custom filters and rankings", category: "data" },
    { id: "table", title: "Data Table", description: "Raw fundamentals data", category: "data" },
  ];
  
  // Torque visualization types
  const torqueTypes = [
    { id: "torque-scatter", title: "Torque Scatter", description: "EPS acceleration vs valuation quadrant", category: "torque" },
    { id: "torque-ranking", title: "Torque Ranking", description: "Percentile-based composite scoring", category: "torque" },
    { id: "torque-heatmap", title: "Torque Heatmap", description: "Companies × metrics cross-reference", category: "torque" },
  ];
  
  // AI/Insights panel types
  const aiTypes = [
    { id: "universe-insights", title: "🧠 Universe AI Insights", description: "AI analysis across your entire universe", category: "ai" },
  ];
  
  // Alternative Data panel types (from SEC EDGAR, Finnhub, FRED)
  const altDataTypes = [
    { id: "whale-tracker", title: "🐋 Whale Tracker", description: "Institutional 13F holdings changes (quarterly)", category: "alt" },
    { id: "macro-overview", title: "📉 Macro Overview", description: "Fed rates, yield curve, VIX, unemployment", category: "alt" },
    { id: "insider-activity", title: "👔 Insider Activity", description: "SEC Form 4 insider buys/sells", category: "alt" },
    { id: "company-news", title: "📰 Company News", description: "Recent news headlines from Finnhub", category: "alt" },
  ];
  
  // Investment Archetype panel types
  const archetypeTypes = [
    { id: "compounders", title: "🏔️ Compounders", description: "Steady growth, high ROIC, reinvestment works", category: "archetype" },
    { id: "qarp", title: "💎 QARP", description: "Quality at Reasonable Price", category: "archetype" },
    { id: "turnarounds", title: "🔄 Turnarounds", description: "Bad business getting less bad", category: "archetype" },
    { id: "rerating", title: "📈 Re-Rating", description: "Multiple expansion plays", category: "archetype" },
    { id: "capital-allocators", title: "💰 Capital Allocators", description: "Buybacks, M&A done well", category: "archetype" },
    { id: "structural-winners", title: "🚀 Structural Winners", description: "Industry tailwinds, market share gains", category: "archetype" },
    { id: "antifragile", title: "🛡️ Anti-Fragile", description: "Resilient through cycles", category: "archetype" },
  ];
  
  const allTypes = [...builtInTypes, ...torqueTypes, ...aiTypes, ...archetypeTypes, ...altDataTypes];

  picker.innerHTML = `
    <div style="margin-bottom: 1.25rem;">
      <div style="font-size: 0.8rem; font-weight: 600; color: #8b5cf6; margin-bottom: 0.5rem; text-transform: uppercase;">🧠 AI Insights</div>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.5rem;">
        ${aiTypes.map(t => `
          <div class="recipe-card" data-type="${t.id}" style="cursor: pointer; border-color: rgba(139, 92, 246, 0.4);">
            <span class="recipe-card-title">${t.title}</span>
            <span style="font-size: 0.75rem; color: #64748b;">${t.description}</span>
          </div>
        `).join("")}
      </div>
    </div>
    
    <div style="margin-bottom: 1.25rem;">
      <div style="font-size: 0.8rem; font-weight: 600; color: #06b6d4; margin-bottom: 0.5rem; text-transform: uppercase;">📊 Alternative Data</div>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.5rem;">
        ${altDataTypes.map(t => `
          <div class="recipe-card" data-type="${t.id}" style="cursor: pointer; border-color: rgba(6, 182, 212, 0.3);">
            <span class="recipe-card-title">${t.title}</span>
            <span style="font-size: 0.75rem; color: #64748b;">${t.description}</span>
          </div>
        `).join("")}
      </div>
    </div>
    
    <div style="margin-bottom: 1.25rem;">
      <div style="font-size: 0.8rem; font-weight: 600; color: #4ade80; margin-bottom: 0.5rem; text-transform: uppercase;">🎯 Torque Visualizations</div>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.5rem;">
        ${torqueTypes.map(t => `
          <div class="recipe-card" data-type="${t.id}" style="cursor: pointer; border-color: rgba(74, 222, 128, 0.3);">
            <span class="recipe-card-title">${t.title}</span>
            <span style="font-size: 0.75rem; color: #64748b;">${t.description}</span>
          </div>
        `).join("")}
      </div>
    </div>
    
    <div style="margin-bottom: 1.25rem;">
      <div style="font-size: 0.8rem; font-weight: 600; color: #f59e0b; margin-bottom: 0.5rem; text-transform: uppercase;">🎭 Investment Archetypes</div>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.5rem;">
        ${archetypeTypes.map(t => `
          <div class="recipe-card" data-type="${t.id}" style="cursor: pointer; border-color: rgba(245, 158, 11, 0.3);">
            <span class="recipe-card-title">${t.title}</span>
            <span style="font-size: 0.75rem; color: #64748b;">${t.description}</span>
          </div>
        `).join("")}
      </div>
    </div>
    
    <div style="margin-bottom: 1rem;">
      <div style="font-size: 0.8rem; font-weight: 600; color: #94a3b8; margin-bottom: 0.5rem; text-transform: uppercase;">Data Panels</div>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.5rem;">
        ${builtInTypes.map(t => `
          <div class="recipe-card" data-type="${t.id}" style="cursor: pointer;">
            <span class="recipe-card-title">${t.title}</span>
            <span style="font-size: 0.75rem; color: #64748b;">${t.description}</span>
          </div>
        `).join("")}
      </div>
    </div>
    
    <div>
      <div style="font-size: 0.8rem; font-weight: 600; color: #94a3b8; margin-bottom: 0.5rem; text-transform: uppercase;">Pre-built Recipes</div>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.5rem;">
        ${FINANCE_RECIPES_REGISTRY.entries.map(r => `
          <div class="recipe-card" data-recipe="${r.id}" style="cursor: pointer;">
            <span class="recipe-card-title">${r.name}</span>
            <span class="recipe-card-kind">${r.kind}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;

  // Add click handlers
  picker.querySelectorAll("[data-type]").forEach(card => {
    card.addEventListener("click", () => {
      const type = card.getAttribute("data-type") as any;
      const typeInfo = allTypes.find(t => t.id === type);
      addPanel({
        id: `panel:${type}-${Date.now()}`,
        title: typeInfo?.title || "New Panel",
        type,
        limit: type.startsWith("torque") ? 30 : 20,
      });
      // Flash feedback
      card.classList.add("added-flash");
      setTimeout(() => card.classList.remove("added-flash"), 400);
    });
  });

  picker.querySelectorAll("[data-recipe]").forEach(card => {
    card.addEventListener("click", () => {
      const recipeId = card.getAttribute("data-recipe")!;
      const recipe = FINANCE_RECIPES_REGISTRY.entries.find(r => r.id === recipeId);
      if (recipe) {
        const params = recipe.logic.parameters || {};
        addPanel({
          id: `panel:${recipeId.replace("recipe:", "")}-${Date.now()}`,
          title: recipe.name,
          type: recipe.kind === "screener" ? "screener" : "greenblatt",
          filters: params.filters,
          columns: params.columns,
          formulas: params.formulas,
          rank_by: params.rank_by,
          rank_order: params.rank_order,
          limit: params.limit || 20,
        });
        // Flash feedback
        card.classList.add("added-flash");
        setTimeout(() => card.classList.remove("added-flash"), 400);
      }
    });
  });
}

function addPanel(config: PanelConfig) {
  // Set default height if not specified
  if (!config.gridH) {
    config.gridH = defaultHeights[config.type as string] || 5;
  }
  panels.push(config);
  savePanels();
  renderDashboard();
}

function openModal() {
  const modal = document.getElementById("add-panel-modal");
  if (modal) {
    modal.hidden = false;
    renderRecipePicker();
  }
}

function closeModal() {
  const modal = document.getElementById("add-panel-modal");
  if (modal) {
    modal.hidden = true;
  }
}

// Modal tabs
function switchTab(tabName: string) {
  document.querySelectorAll(".modal-tab").forEach(tab => {
    tab.classList.toggle("active", tab.getAttribute("data-tab") === tabName);
  });
  document.querySelectorAll(".tab-content").forEach(content => {
    (content as HTMLElement).hidden = content.id !== `tab-${tabName}`;
  });
}

// Navigation functions
function navigateToStock(ticker: string) {
  selectedTicker = ticker;
  currentView = "stock-detail";
  renderCurrentView();
  // Update URL without reload
  history.pushState({ view: "stock", ticker }, "", `#/stock/${ticker}`);
}

function navigateToDashboard() {
  selectedTicker = null;
  currentView = "dashboard";
  renderCurrentView();
  history.pushState({ view: "dashboard" }, "", "#/");
}

function renderCurrentView() {
  const dashboardGrid = document.getElementById("dashboard-grid");
  const stockDetailContainer = document.getElementById("stock-detail-container");
  
  if (currentView === "stock-detail" && selectedTicker) {
    dashboardGrid?.classList.add("hidden");
    stockDetailContainer?.classList.remove("hidden");
    
    // Render or update stock detail view
    if (stockDetailContainer) {
      stockDetailContainer.innerHTML = `<stock-detail-view ticker="${selectedTicker}"></stock-detail-view>`;
    }
  } else {
    dashboardGrid?.classList.remove("hidden");
    stockDetailContainer?.classList.add("hidden");
    renderDashboard();
  }
}

// Handle browser back/forward
window.addEventListener("popstate", (e) => {
  if (e.state?.view === "stock" && e.state.ticker) {
    selectedTicker = e.state.ticker;
    currentView = "stock-detail";
  } else {
    selectedTicker = null;
    currentView = "dashboard";
  }
  renderCurrentView();
});

// Parse initial URL
function parseInitialRoute() {
  const hash = window.location.hash;
  const stockMatch = hash.match(/^#\/stock\/([A-Za-z]+)$/);
  if (stockMatch) {
    selectedTicker = stockMatch[1].toUpperCase();
    currentView = "stock-detail";
  }
}

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  parseInitialRoute();
  renderCurrentView();
  renderRecipePicker();

  // Add panel button
  document.getElementById("add-panel-btn")?.addEventListener("click", openModal);
  
  // Close drawer
  document.getElementById("add-panel-close")?.addEventListener("click", closeModal);

  // Modal tabs
  document.querySelectorAll(".modal-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      switchTab(tab.getAttribute("data-tab") || "assistant");
    });
  });

  // Visualization Assistant: create panel from suggestion
  document.getElementById("viz-assistant")?.addEventListener("create-panel", ((e: CustomEvent) => {
    addPanel(e.detail as PanelConfig);
    // Keep drawer open so user can add more
  }) as EventListener);

  // Universe control
  document.getElementById("universe-btn")?.addEventListener("click", () => {
    toggleUniverseDropdown();
  });
  
  document.getElementById("universe-apply")?.addEventListener("click", applyUniverse);
  document.getElementById("universe-clear")?.addEventListener("click", clearUniverse);
  
  // Close dropdown on outside click
  document.addEventListener("click", (e) => {
    const control = document.querySelector(".universe-control");
    if (control && !control.contains(e.target as Node)) {
      toggleUniverseDropdown(false);
    }
  });
  
  // Enter key in universe input
  document.getElementById("universe-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      applyUniverse();
    }
  });
  
  // Saved dashboard controls
  document.getElementById("dashboard-btn")?.addEventListener("click", () => {
    toggleDashboardDropdown();
  });
  
  document.getElementById("dashboard-save")?.addEventListener("click", saveDashboardView);
  document.getElementById("dashboard-reset")?.addEventListener("click", resetDashboard);
  
  // Edit mode toggle
  document.getElementById("edit-mode-btn")?.addEventListener("click", toggleEditMode);
  
  // Close dashboard dropdown on outside click
  document.addEventListener("click", (e) => {
    const control = document.querySelector(".dashboard-control");
    if (control && !control.contains(e.target as Node)) {
      toggleDashboardDropdown(false);
    }
  });
  
  // Search combobox navigation
  document.querySelector("search-combobox")?.addEventListener("navigate-stock", ((e: CustomEvent) => {
    navigateToStock(e.detail.ticker);
  }) as EventListener);
  
  // Close stock detail view
  document.addEventListener("close-detail", () => {
    navigateToDashboard();
  });
  
  // Global ticker click handler (for all ticker links)
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("ticker-link") || target.closest(".ticker-link")) {
      e.preventDefault();
      const ticker = target.getAttribute("data-ticker") || target.closest(".ticker-link")?.getAttribute("data-ticker");
      if (ticker) {
        navigateToStock(ticker);
      }
    }
  });
  
  // Navigate-stock events from shadow DOM components
  document.addEventListener("navigate-stock", ((e: CustomEvent) => {
    if (e.detail?.ticker) {
      navigateToStock(e.detail.ticker);
    }
  }) as EventListener);
});
