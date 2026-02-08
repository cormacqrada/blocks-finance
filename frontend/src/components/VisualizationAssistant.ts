/**
 * VisualizationAssistant - Helps users build chart views from natural language
 * 
 * Features:
 * - Describes what you want to see
 * - Get recipe suggestions based on description
 * - Quick-apply suggested configurations
 */

import type { PanelConfig, PanelType } from "./DashboardPanel";

export interface VisualizationSuggestion {
  title: string;
  description: string;
  config: Partial<PanelConfig>;
  confidence: number; // 0-1
  reasoning: string;
}

// Pattern matching for natural language to visualization mapping
const VISUALIZATION_PATTERNS: Array<{
  patterns: RegExp[];
  suggestions: () => VisualizationSuggestion[];
}> = [
  {
    patterns: [/torque/i, /earnings.*accel/i, /upside/i, /snap.*through/i],
    suggestions: () => [
      {
        title: "Torque Scatter",
        description: "Find earnings acceleration with valuation headroom",
        config: { type: "torque-scatter" as PanelType, limit: 30 },
        confidence: 0.95,
        reasoning: "Torque scatter plots EPS acceleration vs valuation - ideal for finding torque opportunities",
      },
      {
        title: "Torque Heatmap",
        description: "Cross-reference torque signals",
        config: { type: "torque-heatmap" as PanelType, limit: 25 },
        confidence: 0.85,
        reasoning: "Heatmap shows multiple torque dimensions at once for comprehensive analysis",
      },
    ],
  },
  {
    patterns: [/cheap/i, /undervalued/i, /low.*p\/?e/i, /value/i, /margin.*safety/i],
    suggestions: () => [
      {
        title: "Margin of Safety Screen",
        description: "Find undervalued stocks with Graham Number analysis",
        config: {
          type: "screener" as PanelType,
          filters: [
            { field: "pe_ratio", op: "<", value: 15 },
            { field: "pb_ratio", op: "<", value: 1.5 },
          ],
          columns: ["ticker", "price", "pe_ratio", "pb_ratio", "eps", "book_value_per_share"],
          formulas: ["formula:graham_number", "formula:margin_of_safety"],
          rank_by: "pe_ratio",
          rank_order: "ASC",
          limit: 20,
        },
        confidence: 0.9,
        reasoning: "Classic value screen using P/E, P/B filters and Graham Number formula",
      },
      {
        title: "Greenblatt Magic Formula",
        description: "Quantitative value: cheap + quality combined",
        config: { type: "greenblatt" as PanelType, limit: 30 },
        confidence: 0.85,
        reasoning: "Magic formula ranks by earnings yield + return on capital",
      },
    ],
  },
  {
    patterns: [/quality/i, /moat/i, /margin/i, /pricing.*power/i],
    suggestions: () => [
      {
        title: "Quality + Value Screen",
        description: "High margin businesses at reasonable prices",
        config: {
          type: "screener" as PanelType,
          filters: [
            { field: "gross_margin", op: ">", value: 40 },
            { field: "debt_to_equity", op: "<", value: 0.5 },
          ],
          columns: ["ticker", "price", "pe_ratio", "gross_margin", "operating_margin", "debt_to_equity"],
          formulas: ["formula:quality_score", "formula:roic"],
          rank_by: "gross_margin",
          rank_order: "DESC",
          limit: 20,
        },
        confidence: 0.9,
        reasoning: "Quality screen focuses on high margins and low leverage",
      },
      {
        title: "Pricing Power Screen",
        description: "Companies with revenue growth and margin expansion",
        config: {
          type: "screener" as PanelType,
          filters: [
            { field: "revenue_growth_yoy", op: ">", value: 5 },
            { field: "gross_margin", op: ">", value: 35 },
          ],
          columns: ["ticker", "price", "revenue", "revenue_growth_yoy", "gross_margin", "operating_margin"],
          rank_by: "gross_margin",
          rank_order: "DESC",
          limit: 20,
        },
        confidence: 0.85,
        reasoning: "Pricing power shows up as revenue growth with stable/expanding margins",
      },
    ],
  },
  {
    patterns: [/dividend/i, /income/i, /yield/i, /payout/i],
    suggestions: () => [
      {
        title: "Dividend Value Screen",
        description: "High yield with sustainable payout ratios",
        config: {
          type: "screener" as PanelType,
          filters: [
            { field: "dividend_yield", op: ">", value: 2 },
            { field: "payout_ratio", op: "<", value: 75 },
            { field: "debt_to_equity", op: "<", value: 1 },
          ],
          columns: ["ticker", "price", "dividend_yield", "payout_ratio", "pe_ratio", "debt_to_equity"],
          rank_by: "dividend_yield",
          rank_order: "DESC",
          limit: 20,
        },
        confidence: 0.9,
        reasoning: "Dividend screen filters for yield sustainability",
      },
    ],
  },
  {
    patterns: [/cash.*flow/i, /fcf/i, /free.*cash/i],
    suggestions: () => [
      {
        title: "FCF Yield Screen",
        description: "Companies generating strong free cash flow relative to price",
        config: {
          type: "screener" as PanelType,
          filters: [
            { field: "fcf_yield", op: ">", value: 5 },
            { field: "debt_to_equity", op: "<", value: 1 },
          ],
          columns: ["ticker", "price", "market_cap", "free_cash_flow", "fcf_yield", "debt_to_equity"],
          formulas: ["formula:fcf_yield"],
          rank_by: "fcf_yield",
          rank_order: "DESC",
          limit: 20,
        },
        confidence: 0.9,
        reasoning: "FCF yield is a cleaner measure of value than earnings-based ratios",
      },
    ],
  },
  {
    patterns: [/growth/i, /fast.*growing/i, /high.*growth/i],
    suggestions: () => [
      {
        title: "Growth Screen",
        description: "Companies with strong revenue and earnings growth",
        config: {
          type: "screener" as PanelType,
          filters: [
            { field: "revenue_growth_yoy", op: ">", value: 15 },
            { field: "eps_growth_yoy", op: ">", value: 10 },
          ],
          columns: ["ticker", "price", "revenue_growth_yoy", "eps_growth_yoy", "pe_ratio", "gross_margin"],
          rank_by: "revenue_growth_yoy",
          rank_order: "DESC",
          limit: 20,
        },
        confidence: 0.85,
        reasoning: "Growth screen emphasizes revenue and earnings acceleration",
      },
    ],
  },
  {
    patterns: [/compare/i, /rank/i, /percentile/i, /relative/i],
    suggestions: () => [
      {
        title: "Torque Ranking Table",
        description: "Percentile-based comparison across torque metrics",
        config: { type: "torque-ranking" as PanelType, limit: 30 },
        confidence: 0.9,
        reasoning: "Ranking table shows percentile scores for fair cross-company comparison",
      },
    ],
  },
  {
    patterns: [/heatmap/i, /matrix/i, /overview/i, /all.*metrics/i],
    suggestions: () => [
      {
        title: "Torque Heatmap",
        description: "Visual matrix of all companies × metrics",
        config: { type: "torque-heatmap" as PanelType, limit: 30 },
        confidence: 0.95,
        reasoning: "Heatmap provides at-a-glance overview of all metrics across companies",
      },
    ],
  },
];

// Quick suggestions for common use cases
const QUICK_SUGGESTIONS = [
  { label: "Find torque opportunities", query: "show me stocks with earnings acceleration and low valuation" },
  { label: "Value with margin of safety", query: "find undervalued stocks with margin of safety" },
  { label: "Quality businesses", query: "high quality companies with pricing power" },
  { label: "Dividend income", query: "sustainable dividend yield stocks" },
  { label: "Compare all metrics", query: "heatmap comparing all stocks across metrics" },
];

export class VisualizationAssistant extends HTMLElement {
  private shadow: ShadowRoot;
  private query: string = "";
  private suggestions: VisualizationSuggestion[] = [];
  private isLoading: boolean = false;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.render();
  }

  private processQuery(query: string) {
    this.query = query;
    this.suggestions = [];

    if (!query.trim()) {
      this.render();
      return;
    }

    // Match patterns and collect suggestions
    const matched = new Set<string>();
    for (const pattern of VISUALIZATION_PATTERNS) {
      for (const regex of pattern.patterns) {
        if (regex.test(query)) {
          for (const suggestion of pattern.suggestions()) {
            if (!matched.has(suggestion.title)) {
              matched.add(suggestion.title);
              this.suggestions.push(suggestion);
            }
          }
          break;
        }
      }
    }

    // Sort by confidence
    this.suggestions.sort((a, b) => b.confidence - a.confidence);

    // Limit to top 4
    this.suggestions = this.suggestions.slice(0, 4);

    this.render();
  }

  private selectSuggestion(suggestion: VisualizationSuggestion) {
    this.dispatchEvent(new CustomEvent("create-panel", {
      detail: {
        ...suggestion.config,
        id: `panel:assistant-${Date.now()}`,
        title: suggestion.title,
      },
      bubbles: true,
    }));
  }

  private render() {
    this.shadow.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: system-ui, -apple-system, sans-serif;
        }
        
        .assistant {
          background: rgba(15, 23, 42, 0.8);
          border: 1px solid rgba(148, 163, 184, 0.25);
          border-radius: 12px;
          overflow: hidden;
        }
        
        .header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 1rem;
          background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%);
          border-bottom: 1px solid rgba(148, 163, 184, 0.15);
        }
        
        .header-icon {
          font-size: 1.5rem;
        }
        
        .header-text h3 {
          margin: 0;
          font-size: 0.95rem;
          font-weight: 600;
          color: #e2e8f0;
        }
        
        .header-text p {
          margin: 0.2rem 0 0;
          font-size: 0.75rem;
          color: #94a3b8;
        }
        
        .input-section {
          padding: 1rem;
        }
        
        .input-wrapper {
          display: flex;
          gap: 0.5rem;
        }
        
        input {
          flex: 1;
          padding: 0.6rem 0.8rem;
          border: 1px solid rgba(148, 163, 184, 0.3);
          border-radius: 8px;
          background: rgba(30, 41, 59, 0.6);
          color: #e2e8f0;
          font-size: 0.85rem;
        }
        
        input:focus {
          outline: none;
          border-color: rgba(59, 130, 246, 0.5);
        }
        
        input::placeholder {
          color: #64748b;
        }
        
        .quick-suggestions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
          margin-top: 0.75rem;
        }
        
        .quick-btn {
          padding: 0.3rem 0.6rem;
          border: 1px solid rgba(148, 163, 184, 0.2);
          border-radius: 999px;
          background: rgba(30, 41, 59, 0.4);
          color: #94a3b8;
          font-size: 0.7rem;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        
        .quick-btn:hover {
          border-color: rgba(59, 130, 246, 0.4);
          color: #e2e8f0;
          background: rgba(59, 130, 246, 0.1);
        }
        
        .results {
          padding: 0 1rem 1rem;
        }
        
        .results-header {
          font-size: 0.7rem;
          font-weight: 600;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          margin-bottom: 0.5rem;
        }
        
        .suggestion-card {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
          padding: 0.75rem;
          margin-bottom: 0.5rem;
          background: rgba(30, 41, 59, 0.5);
          border: 1px solid rgba(148, 163, 184, 0.15);
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        
        .suggestion-card:hover {
          border-color: rgba(59, 130, 246, 0.4);
          background: rgba(59, 130, 246, 0.05);
        }
        
        .suggestion-card:last-child {
          margin-bottom: 0;
        }
        
        .confidence-ring {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.7rem;
          font-weight: 700;
          flex-shrink: 0;
        }
        
        .confidence-high {
          background: rgba(74, 222, 128, 0.2);
          color: #4ade80;
          border: 2px solid rgba(74, 222, 128, 0.5);
        }
        
        .confidence-medium {
          background: rgba(251, 191, 36, 0.2);
          color: #fbbf24;
          border: 2px solid rgba(251, 191, 36, 0.5);
        }
        
        .suggestion-content {
          flex: 1;
          min-width: 0;
        }
        
        .suggestion-title {
          font-size: 0.85rem;
          font-weight: 600;
          color: #e2e8f0;
          margin-bottom: 0.15rem;
        }
        
        .suggestion-desc {
          font-size: 0.75rem;
          color: #94a3b8;
          margin-bottom: 0.35rem;
        }
        
        .suggestion-reasoning {
          font-size: 0.7rem;
          color: #64748b;
          font-style: italic;
        }
        
        .add-icon {
          font-size: 1.1rem;
          color: #4ade80;
          opacity: 0;
          transition: opacity 0.15s ease;
        }
        
        .suggestion-card:hover .add-icon {
          opacity: 1;
        }
        
        .no-results {
          text-align: center;
          padding: 1.5rem;
          color: #64748b;
          font-size: 0.85rem;
        }
      </style>
      
      <div class="assistant">
        <div class="header">
          <span class="header-icon">🤖</span>
          <div class="header-text">
            <h3>Visualization Assistant</h3>
            <p>Describe what you want to analyze and I'll suggest views</p>
          </div>
        </div>
        
        <div class="input-section">
          <div class="input-wrapper">
            <input 
              type="text" 
              id="query-input"
              placeholder="e.g., Find stocks with earnings acceleration and low valuation..."
              value="${this.query}"
            />
          </div>
          
          <div class="quick-suggestions">
            ${QUICK_SUGGESTIONS.map(s => `
              <button class="quick-btn" data-query="${s.query}">${s.label}</button>
            `).join("")}
          </div>
        </div>
        
        ${this.suggestions.length > 0 ? `
          <div class="results">
            <div class="results-header">Suggested Visualizations</div>
            ${this.suggestions.map((s, i) => `
              <div class="suggestion-card" data-suggestion-idx="${i}">
                <div class="confidence-ring ${s.confidence >= 0.85 ? "confidence-high" : "confidence-medium"}">
                  ${Math.round(s.confidence * 100)}%
                </div>
                <div class="suggestion-content">
                  <div class="suggestion-title">${s.title}</div>
                  <div class="suggestion-desc">${s.description}</div>
                  <div class="suggestion-reasoning">${s.reasoning}</div>
                </div>
                <span class="add-icon">+</span>
              </div>
            `).join("")}
          </div>
        ` : this.query ? `
          <div class="no-results">
            No matching visualizations found. Try a different description or use the quick suggestions above.
          </div>
        ` : ""}
      </div>
    `;

    // Event listeners
    const input = this.shadow.getElementById("query-input") as HTMLInputElement;
    input?.addEventListener("input", (e) => {
      this.processQuery((e.target as HTMLInputElement).value);
    });

    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && this.suggestions.length > 0) {
        this.selectSuggestion(this.suggestions[0]);
      }
    });

    this.shadow.querySelectorAll(".quick-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const query = btn.getAttribute("data-query") || "";
        input.value = query;
        this.processQuery(query);
      });
    });

    this.shadow.querySelectorAll(".suggestion-card").forEach(card => {
      card.addEventListener("click", () => {
        const idx = parseInt(card.getAttribute("data-suggestion-idx") || "0");
        this.selectSuggestion(this.suggestions[idx]);
      });
    });
  }
}

customElements.define("visualization-assistant", VisualizationAssistant);
