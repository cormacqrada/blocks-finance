/**
 * DashboardPanel - Wrapper component for dashboard panels with edit functionality.
 * 
 * Each panel can contain different view types (screener, chart, table, etc.)
 * and has its own configuration that can be edited inline.
 */

import { fetchFormulas, runScreen, fetchGreenblattScores, type Formula, type ScreenFilter, FIELD_CATEGORIES } from "../api/client";
import { getMetricTooltip, formatMetricName } from "../utils/metricTooltips";

const ALL_FIELDS = Object.values(FIELD_CATEGORIES).flat();

export type PanelType = "screener" | "chart" | "table" | "greenblatt" | "torque-scatter" | "torque-ranking" | "torque-heatmap" | "universe-insights";

export interface PanelConfig {
  id: string;
  title: string;
  type: PanelType;
  // Grid layout (saved automatically)
  gridW?: number;  // width in grid columns (1-12)
  gridH?: number;  // height in grid rows
  gridX?: number;  // x position
  gridY?: number;  // y position
  // Screener config
  filters?: ScreenFilter[];
  columns?: string[];
  formulas?: string[];
  rank_by?: string;
  rank_order?: "ASC" | "DESC";
  // Common config
  universe?: string[];
  limit?: number;
  // Chart config
  metric?: string;
  chartType?: "bar" | "line" | "radar";
}

export class DashboardPanel extends HTMLElement {
  private shadow: ShadowRoot;
  private config: PanelConfig;
  private isEditing: boolean = false;
  private isLoading: boolean = false;
  private results: any[] = [];
  private availableFormulas: Formula[] = [];

  static get observedAttributes() {
    return ["config"];
  }

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
    this.config = {
      id: `panel-${Date.now()}`,
      title: "New Panel",
      type: "greenblatt",
      limit: 20,
    };
  }

  connectedCallback() {
    this.loadFormulas().then(() => {
      this.render();
      this.fetchData();
    });
  }

  attributeChangedCallback(name: string, _old: string, value: string) {
    if (name === "config" && value) {
      try {
        this.config = JSON.parse(value);
        this.render();
        this.fetchData();
      } catch (e) {
        console.error("Invalid config:", e);
      }
    }
  }

  setConfig(config: Partial<PanelConfig>) {
    this.config = { ...this.config, ...config };
    this.render();
    this.fetchData();
  }

  getConfig(): PanelConfig {
    return this.config;
  }

  private async loadFormulas() {
    try {
      const { formulas } = await fetchFormulas();
      this.availableFormulas = formulas;
    } catch (e) {
      console.error("Failed to load formulas:", e);
    }
  }

  private async fetchData() {
    // Torque visualizations handle their own data fetching
    if (this.config.type.startsWith("torque-")) {
      this.isLoading = false;
      this.renderBody();
      return;
    }

    this.isLoading = true;
    this.renderBody();

    try {
      if (this.config.type === "greenblatt") {
        const { rows } = await fetchGreenblattScores({
          universe: this.config.universe,
          limit: this.config.limit || 20,
        });
        this.results = rows;
      } else if (this.config.type === "screener" || this.config.type === "table") {
        const result = await runScreen({
          filters: this.config.filters || [],
          rank_by: this.config.rank_by || "pe_ratio",
          rank_order: this.config.rank_order || "ASC",
          columns: this.config.columns || ["ticker", "price", "pe_ratio", "gross_margin"],
          formulas: this.config.formulas || [],
          limit: this.config.limit || 20,
        });
        this.results = result.rows;
      }
    } catch (e) {
      console.error("Fetch failed:", e);
      this.results = [];
    }

    this.isLoading = false;
    this.renderBody();
  }

  private toggleEdit() {
    this.isEditing = !this.isEditing;
    this.render();
  }

  private applyConfig() {
    // Read values from form
    const titleInput = this.shadow.getElementById("edit-title") as HTMLInputElement;
    const typeSelect = this.shadow.getElementById("edit-type") as HTMLSelectElement;
    const universeInput = this.shadow.getElementById("edit-universe") as HTMLInputElement;
    const limitInput = this.shadow.getElementById("edit-limit") as HTMLInputElement;
    const rankBySelect = this.shadow.getElementById("edit-rank-by") as HTMLSelectElement;
    const rankOrderSelect = this.shadow.getElementById("edit-rank-order") as HTMLSelectElement;

    if (titleInput) this.config.title = titleInput.value;
    if (typeSelect) this.config.type = typeSelect.value as PanelType;
    if (limitInput) this.config.limit = parseInt(limitInput.value) || 20;
    if (rankBySelect) this.config.rank_by = rankBySelect.value;
    if (rankOrderSelect) this.config.rank_order = rankOrderSelect.value as "ASC" | "DESC";
    
    if (universeInput) {
      const val = universeInput.value.trim();
      this.config.universe = val ? val.split(",").map(s => s.trim()).filter(Boolean) : undefined;
    }

    // Read selected columns
    const columnCheckboxes = this.shadow.querySelectorAll(".column-checkbox:checked") as NodeListOf<HTMLInputElement>;
    this.config.columns = Array.from(columnCheckboxes).map(cb => cb.value);

    // Read selected formulas
    const formulaCheckboxes = this.shadow.querySelectorAll(".formula-checkbox:checked") as NodeListOf<HTMLInputElement>;
    this.config.formulas = Array.from(formulaCheckboxes).map(cb => cb.value);

    this.isEditing = false;
    this.render();
    this.fetchData();

    // Dispatch event
    this.dispatchEvent(new CustomEvent("config-change", {
      detail: this.config,
      bubbles: true,
    }));
  }

  private removePanel() {
    this.dispatchEvent(new CustomEvent("panel-remove", {
      detail: { id: this.config.id },
      bubbles: true,
    }));
  }

  private formatValue(value: any, field: string): string {
    if (value === null || value === undefined) return "—";
    if (typeof value === "number") {
      if (field.includes("margin") || field.includes("yield") || field.includes("growth") || field === "earnings_yield" || field === "return_on_capital") {
        return `${(value * (field.includes("earnings") || field.includes("return") ? 100 : 1)).toFixed(2)}${field.includes("earnings") || field.includes("return") ? "%" : "%"}`;
      }
      if (field === "price" || field.includes("cap") || field.includes("value")) {
        return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
      }
      return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return String(value);
  }

  private render() {
    const defaultColumns = this.config.columns || ["ticker", "price", "pe_ratio", "gross_margin", "debt_to_equity"];
    
    this.shadow.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: system-ui, -apple-system, sans-serif;
        }
        
        .panel {
          background: rgba(15, 23, 42, 0.7);
          border: 1px solid rgba(148, 163, 184, 0.25);
          border-radius: 10px;
          overflow: hidden;
        }
        
        .panel.editing {
          border-color: rgba(59, 130, 246, 0.5);
        }
        
        .panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.6rem 0.9rem;
          background: rgba(15, 23, 42, 0.5);
          border-bottom: 1px solid rgba(148, 163, 184, 0.15);
        }
        
        .panel-title {
          font-size: 0.85rem;
          font-weight: 600;
          color: #e2e8f0;
        }
        
        .panel-actions {
          display: flex;
          gap: 0.35rem;
        }
        
        .btn-icon {
          background: none;
          border: none;
          color: #64748b;
          cursor: pointer;
          padding: 0.2rem;
          border-radius: 4px;
          font-size: 0.85rem;
          transition: all 0.15s ease;
        }
        
        .btn-icon:hover {
          color: #e2e8f0;
          background: rgba(148, 163, 184, 0.1);
        }
        
        .panel-body {
          padding: 0.75rem;
          max-height: 400px;
          overflow-y: auto;
        }
        
        .edit-form {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        
        .form-row {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
        }
        
        .form-group {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }
        
        .form-group label {
          font-size: 0.7rem;
          font-weight: 500;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }
        
        .form-group input,
        .form-group select {
          padding: 0.4rem 0.5rem;
          border: 1px solid rgba(148, 163, 184, 0.3);
          border-radius: 5px;
          background: rgba(30, 41, 59, 0.6);
          color: #e2e8f0;
          font-size: 0.8rem;
        }
        
        .form-group input:focus,
        .form-group select:focus {
          outline: none;
          border-color: rgba(59, 130, 246, 0.5);
        }
        
        .checkbox-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 0.25rem 0.5rem;
          max-height: 100px;
          overflow-y: auto;
          padding: 0.5rem;
          background: rgba(30, 41, 59, 0.4);
          border-radius: 5px;
        }
        
        .checkbox-item {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          font-size: 0.75rem;
          color: #94a3b8;
        }
        
        .checkbox-item input {
          accent-color: #3b82f6;
        }
        
        .form-actions {
          display: flex;
          gap: 0.5rem;
          justify-content: flex-end;
          padding-top: 0.5rem;
          border-top: 1px solid rgba(148, 163, 184, 0.15);
        }
        
        .btn {
          padding: 0.4rem 0.75rem;
          border-radius: 5px;
          font-size: 0.75rem;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        
        .btn-primary {
          background: rgba(59, 130, 246, 0.2);
          border: 1px solid rgba(59, 130, 246, 0.5);
          color: #93c5fd;
        }
        
        .btn-primary:hover {
          background: rgba(59, 130, 246, 0.3);
        }
        
        .btn-ghost {
          background: transparent;
          border: 1px solid rgba(148, 163, 184, 0.3);
          color: #94a3b8;
        }
        
        .btn-ghost:hover {
          border-color: rgba(148, 163, 184, 0.5);
          color: #e2e8f0;
        }
        
        .btn-danger {
          background: transparent;
          border: 1px solid rgba(239, 68, 68, 0.4);
          color: #fca5a5;
        }
        
        .btn-danger:hover {
          background: rgba(239, 68, 68, 0.1);
        }
        
        /* Results table */
        .results-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.8rem;
        }
        
        .results-table th,
        .results-table td {
          padding: 0.35rem 0.5rem;
          text-align: left;
          border-bottom: 1px solid rgba(148, 163, 184, 0.1);
        }
        
        .results-table th {
          font-weight: 600;
          color: #64748b;
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.02em;
          position: sticky;
          top: 0;
          background: rgba(15, 23, 42, 0.95);
          cursor: help;
        }
        
        .results-table th:hover {
          color: #94a3b8;
        }
        
        /* Tooltip in shadow DOM */
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
        
        .results-table tbody tr:hover {
          background: rgba(59, 130, 246, 0.05);
        }
        
        .results-table td {
          color: #e2e8f0;
        }
        
        .results-table td.number {
          text-align: right;
          font-family: 'SF Mono', 'Fira Code', monospace;
          font-size: 0.75rem;
        }
        
        .results-table td.positive { color: #4ade80; }
        .results-table td.negative { color: #f87171; }
        
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
        
        .loading, .empty {
          text-align: center;
          padding: 2rem;
          color: #64748b;
          font-size: 0.85rem;
        }
        
        .panel-id {
          font-size: 0.65rem;
          color: #475569;
          font-family: monospace;
        }
        
        .panel-footer {
          padding: 0.5rem 0.75rem;
          border-top: 1px solid rgba(148, 163, 184, 0.1);
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
      </style>
      
      <div class="metric-tooltip-host" id="tooltip-host"></div>
      
      <div class="panel ${this.isEditing ? 'editing' : ''}">
        <div class="panel-header gs-drag-handle">
          <div>
            <span class="panel-title">${this.config.title}</span>
            <span class="panel-id">${this.config.id}</span>
          </div>
          <div class="panel-actions">
            <button class="btn-icon" id="edit-btn" title="Edit">\u270e</button>
            <button class="btn-icon" id="refresh-btn" title="Refresh">\u21bb</button>
            <button class="btn-icon" id="remove-btn" title="Remove">\u2715</button>
          </div>
        </div>
        
        <div class="panel-body" id="panel-body">
          ${this.isEditing ? this.renderEditForm() : ""}
        </div>
        
        <div class="panel-footer">
          <view-explainer view-type="${this.config.type}"></view-explainer>
          <view-insights config='{"viewType": "${this.config.type}", "limit": ${this.config.limit || 30}}'></view-insights>
        </div>
      </div>
    `;

    this.setupEventListeners();
    if (!this.isEditing) {
      this.renderBody();
    }
  }

  private renderEditForm(): string {
    const defaultColumns = this.config.columns || ["ticker", "price", "pe_ratio", "gross_margin"];
    const defaultFormulas = this.config.formulas || [];

    return `
      <div class="edit-form">
        <div class="form-row">
          <div class="form-group" style="flex: 1;">
            <label>Title</label>
            <input type="text" id="edit-title" value="${this.config.title}" />
          </div>
          <div class="form-group">
            <label>Type</label>
            <select id="edit-type">
              <option value="greenblatt" ${this.config.type === "greenblatt" ? "selected" : ""}>Greenblatt Scores</option>
              <option value="screener" ${this.config.type === "screener" ? "selected" : ""}>Stock Screener</option>
              <option value="table" ${this.config.type === "table" ? "selected" : ""}>Data Table</option>
              <option value="torque-scatter" ${this.config.type === "torque-scatter" ? "selected" : ""}>Torque Scatter</option>
              <option value="torque-ranking" ${this.config.type === "torque-ranking" ? "selected" : ""}>Torque Ranking</option>
              <option value="torque-heatmap" ${this.config.type === "torque-heatmap" ? "selected" : ""}>Torque Heatmap</option>
            </select>
          </div>
        </div>
        
        <div class="form-row">
          <div class="form-group" style="flex: 1;">
            <label>Universe (tickers, comma-separated)</label>
            <input type="text" id="edit-universe" value="${(this.config.universe || []).join(", ")}" placeholder="Leave empty for all" />
          </div>
          <div class="form-group">
            <label>Limit</label>
            <input type="number" id="edit-limit" value="${this.config.limit || 20}" min="1" max="100" style="width: 70px;" />
          </div>
        </div>
        
        <div class="form-row">
          <div class="form-group">
            <label>Sort By</label>
            <select id="edit-rank-by">
              ${ALL_FIELDS.map(f => `<option value="${f}" ${this.config.rank_by === f ? "selected" : ""}>${f}</option>`).join("")}
            </select>
          </div>
          <div class="form-group">
            <label>Order</label>
            <select id="edit-rank-order">
              <option value="ASC" ${this.config.rank_order === "ASC" ? "selected" : ""}>Ascending</option>
              <option value="DESC" ${this.config.rank_order === "DESC" ? "selected" : ""}>Descending</option>
            </select>
          </div>
        </div>
        
        <div class="form-group">
          <label>Columns</label>
          <div class="checkbox-grid">
            ${ALL_FIELDS.map(f => `
              <label class="checkbox-item">
                <input type="checkbox" class="column-checkbox" value="${f}" ${defaultColumns.includes(f) ? "checked" : ""} />
                ${f}
              </label>
            `).join("")}
          </div>
        </div>
        
        <div class="form-group">
          <label>Formula Columns</label>
          <div class="checkbox-grid">
            ${this.availableFormulas.map(f => `
              <label class="checkbox-item">
                <input type="checkbox" class="formula-checkbox" value="${f.id}" ${defaultFormulas.includes(f.id) ? "checked" : ""} />
                ${f.name}
              </label>
            `).join("")}
          </div>
        </div>
        
        <div class="form-actions">
          <button class="btn btn-danger" id="delete-btn">Delete Panel</button>
          <button class="btn btn-ghost" id="cancel-btn">Cancel</button>
          <button class="btn btn-primary" id="apply-btn">Apply</button>
        </div>
      </div>
    `;
  }

  private renderBody() {
    const body = this.shadow.getElementById("panel-body");
    if (!body || this.isEditing) return;

    // Render torque visualization components
    if (this.config.type === "torque-scatter") {
      body.innerHTML = `<torque-scatter config='${JSON.stringify({ limit: this.config.limit || 30 })}'></torque-scatter>`;
      return;
    }
    if (this.config.type === "torque-ranking") {
      body.innerHTML = `<torque-ranking-table config='${JSON.stringify({ limit: this.config.limit || 30 })}'></torque-ranking-table>`;
      return;
    }
    if (this.config.type === "torque-heatmap") {
      body.innerHTML = `<torque-heatmap config='${JSON.stringify({ limit: this.config.limit || 30 })}'></torque-heatmap>`;
      return;
    }

    if (this.isLoading) {
      body.innerHTML = `<div class="loading">Loading...</div>`;
      return;
    }

    if (this.results.length === 0) {
      body.innerHTML = `<div class="empty">No data</div>`;
      return;
    }

    // Determine columns based on type
    let columns: string[];
    if (this.config.type === "greenblatt") {
      columns = ["ticker", "as_of", "earnings_yield", "return_on_capital", "rank"];
    } else {
      columns = this.config.columns || ["ticker", "price", "pe_ratio"];
    }

    // Add formula columns
    const formulaNames = this.availableFormulas
      .filter(f => (this.config.formulas || []).includes(f.id))
      .map(f => f.name);

    body.innerHTML = `
      <table class="results-table">
        <thead>
          <tr>
            ${columns.map(c => `<th data-metric="${c}">${formatMetricName(c)}</th>`).join("")}
            ${formulaNames.map(n => `<th data-metric="${n}">${n}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${this.results.map(row => `
            <tr>
              ${columns.map(c => {
                const val = row[c];
                const isNum = typeof val === "number";
                const isPositive = isNum && val > 0 && (c.includes("margin") || c.includes("yield") || c.includes("growth"));
                const isNegative = isNum && val < 0;
                const isTicker = c === "ticker";
                const content = isTicker 
                  ? `<span class="ticker-link" data-ticker="${val}">${val}</span>`
                  : this.formatValue(val, c);
                return `<td class="${isNum ? "number" : ""} ${isPositive ? "positive" : ""} ${isNegative ? "negative" : ""}">${content}</td>`;
              }).join("")}
              ${formulaNames.map(n => {
                const val = row[n];
                return `<td class="number">${this.formatValue(val, n)}</td>`;
              }).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  private setupEventListeners() {
    this.shadow.getElementById("edit-btn")?.addEventListener("click", () => this.toggleEdit());
    this.shadow.getElementById("refresh-btn")?.addEventListener("click", () => this.fetchData());
    this.shadow.getElementById("remove-btn")?.addEventListener("click", () => this.removePanel());
    this.shadow.getElementById("apply-btn")?.addEventListener("click", () => this.applyConfig());
    this.shadow.getElementById("cancel-btn")?.addEventListener("click", () => this.toggleEdit());
    this.shadow.getElementById("delete-btn")?.addEventListener("click", () => this.removePanel());
    
    // Setup tooltip listeners for table headers
    this.setupTooltips();
  }
  
  private setupTooltips() {
    const tooltipHost = this.shadow.getElementById("tooltip-host");
    if (!tooltipHost) return;
    
    this.shadow.querySelectorAll("th[data-metric]").forEach(th => {
      const metric = th.getAttribute("data-metric");
      if (!metric) return;
      
      th.addEventListener("mouseenter", (e) => {
        tooltipHost.innerHTML = getMetricTooltip(metric);
        tooltipHost.classList.add("visible");
        
        const rect = (e.target as HTMLElement).getBoundingClientRect();
        tooltipHost.style.left = `${rect.left}px`;
        tooltipHost.style.top = `${rect.bottom + 8}px`;
      });
      
      th.addEventListener("mouseleave", () => {
        tooltipHost.classList.remove("visible");
      });
    });
    
    // Ticker link click handlers
    this.shadow.querySelectorAll(".ticker-link").forEach(link => {
      link.addEventListener("click", (e) => {
        const ticker = (e.target as HTMLElement).getAttribute("data-ticker");
        if (ticker) {
          // Dispatch event to navigate to stock detail
          this.dispatchEvent(new CustomEvent("navigate-stock", {
            detail: { ticker },
            bubbles: true,
            composed: true, // Cross shadow DOM boundary
          }));
        }
      });
    });
  }
}

customElements.define("dashboard-panel", DashboardPanel);
