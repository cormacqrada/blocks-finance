/**
 * ScreenerPanel - Configurable stock screener with filters, rankings, and formula columns.
 * 
 * Features:
 * - Add/remove filters with various operators
 * - Sort by any field or formula
 * - Custom column selection
 * - Formula columns for computed metrics
 * - Save/load screen configurations
 */

import { runScreen, fetchFormulas, type ScreenFilter, type Formula, FIELD_CATEGORIES } from "../api/client";

const ALL_FIELDS = Object.values(FIELD_CATEGORIES).flat();

export interface ScreenerConfig {
  filters: ScreenFilter[];
  rank_by: string;
  rank_order: "ASC" | "DESC";
  columns: string[];
  formulas: string[];
  limit: number;
}

export class ScreenerPanel extends HTMLElement {
  private shadow: ShadowRoot;
  private config: ScreenerConfig = {
    filters: [],
    rank_by: "pe_ratio",
    rank_order: "ASC",
    columns: ["ticker", "price", "pe_ratio", "gross_margin", "debt_to_equity"],
    formulas: [],
    limit: 20,
  };
  private results: Record<string, any>[] = [];
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

  setConfig(config: Partial<ScreenerConfig>) {
    this.config = { ...this.config, ...config };
    this.render();
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

  private async runScreener() {
    this.isLoading = true;
    this.render();
    
    try {
      const result = await runScreen({
        filters: this.config.filters,
        rank_by: this.config.rank_by,
        rank_order: this.config.rank_order,
        columns: this.config.columns,
        formulas: this.config.formulas,
        limit: this.config.limit,
      });
      this.results = result.rows;
    } catch (e) {
      console.error("Screen failed:", e);
      this.results = [];
    }
    
    this.isLoading = false;
    this.render();
    
    this.dispatchEvent(new CustomEvent("screen-run", {
      detail: { results: this.results },
      bubbles: true,
    }));
  }

  private addFilter() {
    this.config.filters.push({
      field: "pe_ratio",
      op: "<",
      value: 20,
    });
    this.render();
  }

  private removeFilter(index: number) {
    this.config.filters.splice(index, 1);
    this.render();
  }

  private updateFilter(index: number, updates: Partial<ScreenFilter>) {
    this.config.filters[index] = { ...this.config.filters[index], ...updates };
    this.render();
  }

  private toggleFormula(formulaId: string) {
    const idx = this.config.formulas.indexOf(formulaId);
    if (idx >= 0) {
      this.config.formulas.splice(idx, 1);
    } else {
      this.config.formulas.push(formulaId);
    }
    this.render();
  }

  private formatValue(value: any, field: string): string {
    if (value === null || value === undefined) return "—";
    if (typeof value === "number") {
      if (field.includes("margin") || field.includes("yield") || field.includes("growth")) {
        return `${value.toFixed(1)}%`;
      }
      if (field === "price" || field.includes("cap") || field.includes("value")) {
        return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }
      return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return String(value);
  }

  private render() {
    const operatorOptions = ["<", "<=", "=", ">=", ">", "!=", "BETWEEN", "IN"];
    
    this.shadow.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: system-ui, -apple-system, sans-serif;
          color: #e2e8f0;
        }
        
        .screener {
          background: rgba(15, 23, 42, 0.6);
          border-radius: 8px;
          border: 1px solid rgba(148, 163, 184, 0.2);
        }
        
        .section {
          padding: 0.75rem 1rem;
          border-bottom: 1px solid rgba(148, 163, 184, 0.15);
        }
        
        .section:last-child {
          border-bottom: none;
        }
        
        .section-title {
          font-size: 0.7rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #94a3b8;
          margin-bottom: 0.5rem;
        }
        
        .filters {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        
        .filter-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
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
        
        .filter-field { flex: 1; min-width: 120px; }
        .filter-op { width: 70px; }
        .filter-value { width: 80px; }
        
        .btn {
          padding: 0.35rem 0.75rem;
          border: 1px solid rgba(148, 163, 184, 0.4);
          border-radius: 4px;
          background: transparent;
          color: #e2e8f0;
          font-size: 0.75rem;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        
        .btn:hover {
          background: rgba(59, 130, 246, 0.1);
          border-color: rgba(59, 130, 246, 0.5);
        }
        
        .btn-primary {
          background: rgba(59, 130, 246, 0.2);
          border-color: rgba(59, 130, 246, 0.5);
          color: #93c5fd;
        }
        
        .btn-primary:hover {
          background: rgba(59, 130, 246, 0.3);
        }
        
        .btn-sm {
          padding: 0.2rem 0.4rem;
          font-size: 0.7rem;
        }
        
        .btn-danger {
          color: #fca5a5;
          border-color: rgba(239, 68, 68, 0.4);
        }
        
        .btn-danger:hover {
          background: rgba(239, 68, 68, 0.1);
        }
        
        .formula-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
        }
        
        .formula-chip {
          padding: 0.25rem 0.5rem;
          border-radius: 999px;
          font-size: 0.7rem;
          cursor: pointer;
          transition: all 0.15s ease;
          border: 1px solid rgba(148, 163, 184, 0.3);
          background: transparent;
          color: #94a3b8;
        }
        
        .formula-chip:hover {
          border-color: rgba(59, 130, 246, 0.5);
          color: #e2e8f0;
        }
        
        .formula-chip.selected {
          background: rgba(59, 130, 246, 0.2);
          border-color: rgba(59, 130, 246, 0.5);
          color: #93c5fd;
        }
        
        .sort-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        
        .results-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.8rem;
        }
        
        .results-table th,
        .results-table td {
          padding: 0.4rem 0.6rem;
          text-align: left;
          border-bottom: 1px solid rgba(148, 163, 184, 0.15);
        }
        
        .results-table th {
          font-weight: 600;
          color: #94a3b8;
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }
        
        .results-table tr:hover {
          background: rgba(59, 130, 246, 0.05);
        }
        
        .results-table td.number {
          text-align: right;
          font-family: 'SF Mono', 'Fira Code', monospace;
        }
        
        .results-table td.positive { color: #4ade80; }
        .results-table td.negative { color: #f87171; }
        
        .loading {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem;
          color: #64748b;
        }
        
        .empty {
          text-align: center;
          padding: 2rem;
          color: #64748b;
        }
        
        .toolbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 0.5rem;
        }
        
        .limit-select {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          font-size: 0.75rem;
          color: #94a3b8;
        }
      </style>
      
      <div class="screener">
        <!-- Filters Section -->
        <div class="section">
          <div class="section-title">Filters</div>
          <div class="filters">
            ${this.config.filters.map((f, i) => `
              <div class="filter-row">
                <select class="filter-field" data-idx="${i}" data-prop="field">
                  ${ALL_FIELDS.map(field => `
                    <option value="${field}" ${f.field === field ? 'selected' : ''}>${field}</option>
                  `).join('')}
                </select>
                <select class="filter-op" data-idx="${i}" data-prop="op">
                  ${operatorOptions.map(op => `
                    <option value="${op}" ${f.op === op ? 'selected' : ''}>${op}</option>
                  `).join('')}
                </select>
                <input class="filter-value" type="text" value="${f.value}" data-idx="${i}" data-prop="value" />
                <button class="btn btn-sm btn-danger" data-remove="${i}">&times;</button>
              </div>
            `).join('')}
            <button class="btn btn-sm" id="add-filter">+ Add Filter</button>
          </div>
        </div>
        
        <!-- Formulas Section -->
        <div class="section">
          <div class="section-title">Formula Columns</div>
          <div class="formula-chips">
            ${this.availableFormulas.map(f => `
              <span class="formula-chip ${this.config.formulas.includes(f.id) ? 'selected' : ''}" data-formula="${f.id}">
                ${f.name}
              </span>
            `).join('')}
          </div>
        </div>
        
        <!-- Sort Section -->
        <div class="section">
          <div class="section-title">Sort By</div>
          <div class="sort-row">
            <select id="rank-by">
              ${ALL_FIELDS.map(field => `
                <option value="${field}" ${this.config.rank_by === field ? 'selected' : ''}>${field}</option>
              `).join('')}
            </select>
            <select id="rank-order">
              <option value="ASC" ${this.config.rank_order === 'ASC' ? 'selected' : ''}>Ascending</option>
              <option value="DESC" ${this.config.rank_order === 'DESC' ? 'selected' : ''}>Descending</option>
            </select>
          </div>
        </div>
        
        <!-- Run Button -->
        <div class="section">
          <div class="toolbar">
            <button class="btn btn-primary" id="run-screen">Run Screen</button>
            <div class="limit-select">
              <span>Show</span>
              <select id="limit">
                <option value="10" ${this.config.limit === 10 ? 'selected' : ''}>10</option>
                <option value="20" ${this.config.limit === 20 ? 'selected' : ''}>20</option>
                <option value="50" ${this.config.limit === 50 ? 'selected' : ''}>50</option>
                <option value="100" ${this.config.limit === 100 ? 'selected' : ''}>100</option>
              </select>
              <span>results</span>
            </div>
          </div>
        </div>
        
        <!-- Results Section -->
        <div class="section">
          ${this.isLoading ? `
            <div class="loading">Loading...</div>
          ` : this.results.length === 0 ? `
            <div class="empty">Run a screen to see results</div>
          ` : `
            <table class="results-table">
              <thead>
                <tr>
                  ${this.config.columns.map(col => `<th>${col}</th>`).join('')}
                  ${this.availableFormulas.filter(f => this.config.formulas.includes(f.id)).map(f => `<th>${f.name}</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${this.results.map(row => `
                  <tr>
                    ${this.config.columns.map(col => {
                      const val = row[col];
                      const isNumber = typeof val === 'number';
                      const isPositive = isNumber && val > 0 && (col.includes('margin') || col.includes('growth') || col.includes('yield'));
                      const isNegative = isNumber && val < 0;
                      return `<td class="${isNumber ? 'number' : ''} ${isPositive ? 'positive' : ''} ${isNegative ? 'negative' : ''}">${this.formatValue(val, col)}</td>`;
                    }).join('')}
                    ${this.availableFormulas.filter(f => this.config.formulas.includes(f.id)).map(f => {
                      const val = row[f.name];
                      const isNumber = typeof val === 'number';
                      return `<td class="number">${this.formatValue(val, f.name)}</td>`;
                    }).join('')}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `}
        </div>
      </div>
    `;

    this.setupEventListeners();
  }

  private setupEventListeners() {
    // Add filter
    this.shadow.getElementById("add-filter")?.addEventListener("click", () => this.addFilter());
    
    // Remove filter
    this.shadow.querySelectorAll("[data-remove]").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const idx = parseInt((e.target as HTMLElement).getAttribute("data-remove")!);
        this.removeFilter(idx);
      });
    });
    
    // Update filter
    this.shadow.querySelectorAll(".filter-field, .filter-op, .filter-value").forEach(el => {
      el.addEventListener("change", (e) => {
        const target = e.target as HTMLElement;
        const idx = parseInt(target.getAttribute("data-idx")!);
        const prop = target.getAttribute("data-prop") as keyof ScreenFilter;
        let value: any = (target as HTMLInputElement | HTMLSelectElement).value;
        
        if (prop === "value") {
          // Try to parse as number
          const num = parseFloat(value);
          if (!isNaN(num)) value = num;
        }
        
        this.updateFilter(idx, { [prop]: value });
      });
    });
    
    // Formula chips
    this.shadow.querySelectorAll(".formula-chip").forEach(chip => {
      chip.addEventListener("click", (e) => {
        const formulaId = (e.target as HTMLElement).getAttribute("data-formula")!;
        this.toggleFormula(formulaId);
      });
    });
    
    // Sort by
    this.shadow.getElementById("rank-by")?.addEventListener("change", (e) => {
      this.config.rank_by = (e.target as HTMLSelectElement).value;
    });
    
    this.shadow.getElementById("rank-order")?.addEventListener("change", (e) => {
      this.config.rank_order = (e.target as HTMLSelectElement).value as "ASC" | "DESC";
    });
    
    // Limit
    this.shadow.getElementById("limit")?.addEventListener("change", (e) => {
      this.config.limit = parseInt((e.target as HTMLSelectElement).value);
    });
    
    // Run screen
    this.shadow.getElementById("run-screen")?.addEventListener("click", () => this.runScreener());
  }
}

customElements.define("screener-panel", ScreenerPanel);
