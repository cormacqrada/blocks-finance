/**
 * ViewInsights - Generate narrative insights from chart/view data
 * 
 * Analyzes the data in a view and produces:
 * - Key observations
 * - Statistical highlights
 * - Actionable takeaways
 * - Risk callouts
 */

import { fetchScreenData } from "../api/client";

export interface Insight {
  type: "observation" | "highlight" | "action" | "risk";
  icon: string;
  text: string;
  importance: "high" | "medium" | "low";
}

export interface InsightsConfig {
  viewType: string;
  data?: any[];
  limit?: number;
}

export class ViewInsights extends HTMLElement {
  private shadow: ShadowRoot;
  private config: InsightsConfig = { viewType: "" };
  private insights: Insight[] = [];
  private isLoading: boolean = true;
  private isExpanded: boolean = false;

  static get observedAttributes() {
    return ["config"];
  }

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.render();
    this.generateInsights();
  }

  attributeChangedCallback(name: string, _old: string, value: string) {
    if (name === "config" && value) {
      try {
        this.config = JSON.parse(value);
        this.generateInsights();
      } catch (e) {
        console.error("Invalid config:", e);
      }
    }
  }

  private async generateInsights() {
    this.isLoading = true;
    this.render();

    try {
      // Fetch data for analysis
      const result = await fetchScreenData({
        filters: [],
        columns: [
          "ticker", "price", "pe_ratio", "eps_growth_yoy", "gross_margin",
          "operating_margin", "fcf_yield", "revenue_growth_yoy", "debt_to_equity"
        ],
        formulas: [],
        rank_by: "eps_growth_yoy",
        rank_order: "DESC",
        limit: this.config.limit || 30,
      });

      this.insights = this.analyzeData(result.rows);
    } catch (e) {
      console.error("Failed to generate insights:", e);
      this.insights = [{
        type: "risk",
        icon: "⚠️",
        text: "Unable to generate insights. Check API connection.",
        importance: "high",
      }];
    }

    this.isLoading = false;
    this.render();
  }

  private analyzeData(rows: any[]): Insight[] {
    const insights: Insight[] = [];
    
    if (rows.length === 0) {
      return [{
        type: "observation",
        icon: "📭",
        text: "No data available for analysis.",
        importance: "low",
      }];
    }

    // Statistical calculations
    const epsGrowthValues = rows.map(r => r.eps_growth_yoy || 0).filter(v => !isNaN(v));
    const peValues = rows.map(r => r.pe_ratio || 0).filter(v => !isNaN(v) && v > 0);
    const marginValues = rows.map(r => r.gross_margin || 0).filter(v => !isNaN(v));
    const fcfYieldValues = rows.map(r => r.fcf_yield || 0).filter(v => !isNaN(v));

    const avgEpsGrowth = epsGrowthValues.reduce((a, b) => a + b, 0) / epsGrowthValues.length;
    const avgPE = peValues.reduce((a, b) => a + b, 0) / peValues.length;
    const avgMargin = marginValues.reduce((a, b) => a + b, 0) / marginValues.length;

    // Find outliers and patterns
    const topGrowers = rows.filter(r => (r.eps_growth_yoy || 0) > 20);
    const cheapStocks = rows.filter(r => (r.pe_ratio || 999) < 15 && (r.pe_ratio || 0) > 0);
    const highMargin = rows.filter(r => (r.gross_margin || 0) > 50);
    const highLeverage = rows.filter(r => (r.debt_to_equity || 0) > 1.5);
    const negativeFCF = rows.filter(r => (r.fcf_yield || 0) < 0);

    // Torque candidates: high EPS growth + low P/E
    const torqueCandidates = rows.filter(r => 
      (r.eps_growth_yoy || 0) > 15 && 
      (r.pe_ratio || 999) < 20 && 
      (r.pe_ratio || 0) > 0
    );

    // 1. Headline observation
    if (avgEpsGrowth > 10) {
      insights.push({
        type: "observation",
        icon: "📈",
        text: `Strong earnings momentum: Universe averaging ${avgEpsGrowth.toFixed(1)}% EPS growth YoY. ${topGrowers.length} stocks above 20% growth.`,
        importance: "high",
      });
    } else if (avgEpsGrowth < 0) {
      insights.push({
        type: "observation",
        icon: "📉",
        text: `Earnings contraction: Universe showing ${avgEpsGrowth.toFixed(1)}% average EPS decline. Defensive positioning may be warranted.`,
        importance: "high",
      });
    }

    // 2. Torque opportunities
    if (torqueCandidates.length > 0) {
      const tickers = torqueCandidates.slice(0, 3).map(r => r.ticker).join(", ");
      insights.push({
        type: "highlight",
        icon: "🎯",
        text: `${torqueCandidates.length} torque candidates identified with EPS growth >15% and P/E <20. Top picks: ${tickers}`,
        importance: "high",
      });
    }

    // 3. Valuation context
    if (avgPE > 0) {
      const valLabel = avgPE > 25 ? "elevated" : avgPE < 15 ? "attractive" : "fair";
      insights.push({
        type: "observation",
        icon: "💰",
        text: `Valuation appears ${valLabel}: Universe P/E averages ${avgPE.toFixed(1)}x. ${cheapStocks.length} stocks trading under 15x earnings.`,
        importance: "medium",
      });
    }

    // 4. Quality assessment
    if (highMargin.length > 0) {
      const pct = Math.round((highMargin.length / rows.length) * 100);
      insights.push({
        type: "highlight",
        icon: "✨",
        text: `${pct}% of universe (${highMargin.length} stocks) have gross margins above 50%, suggesting pricing power and moat characteristics.`,
        importance: "medium",
      });
    }

    // 5. Risk callouts
    if (highLeverage.length > 0) {
      const tickers = highLeverage.slice(0, 3).map(r => r.ticker).join(", ");
      insights.push({
        type: "risk",
        icon: "⚠️",
        text: `${highLeverage.length} stocks have D/E >1.5x: ${tickers}. Review leverage carefully in rising rate environment.`,
        importance: "high",
      });
    }

    if (negativeFCF.length > 0) {
      insights.push({
        type: "risk",
        icon: "🔴",
        text: `${negativeFCF.length} stocks have negative FCF yield. Cash burn may limit shareholder returns and increase dilution risk.`,
        importance: "medium",
      });
    }

    // 6. Actionable insight
    if (torqueCandidates.length > 0 && highMargin.length > 0) {
      const overlap = torqueCandidates.filter(t => 
        highMargin.some(h => h.ticker === t.ticker)
      );
      if (overlap.length > 0) {
        insights.push({
          type: "action",
          icon: "💡",
          text: `${overlap.length} stocks combine torque potential with quality: ${overlap.slice(0, 3).map(r => r.ticker).join(", ")}. These merit deeper analysis.`,
          importance: "high",
        });
      }
    }

    // 7. Sector concentration (simplified)
    const topTicker = rows[0];
    if (topTicker) {
      insights.push({
        type: "observation",
        icon: "🏆",
        text: `Top ranked stock: ${topTicker.ticker} with ${(topTicker.eps_growth_yoy || 0).toFixed(1)}% EPS growth at ${(topTicker.pe_ratio || 0).toFixed(1)}x P/E.`,
        importance: "medium",
      });
    }

    // Sort by importance
    const importanceOrder = { high: 0, medium: 1, low: 2 };
    insights.sort((a, b) => importanceOrder[a.importance] - importanceOrder[b.importance]);

    return insights;
  }

  private toggleExpand() {
    this.isExpanded = !this.isExpanded;
    this.render();
  }

  private render() {
    const visibleInsights = this.isExpanded ? this.insights : this.insights.slice(0, 3);

    this.shadow.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: system-ui, -apple-system, sans-serif;
        }
        
        .insights-panel {
          background: rgba(15, 23, 42, 0.7);
          border: 1px solid rgba(148, 163, 184, 0.25);
          border-radius: 10px;
          overflow: hidden;
        }
        
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.6rem 0.9rem;
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(59, 130, 246, 0.1) 100%);
          border-bottom: 1px solid rgba(148, 163, 184, 0.15);
        }
        
        .header-left {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        
        .header-icon {
          font-size: 1rem;
        }
        
        .header-title {
          font-size: 0.85rem;
          font-weight: 600;
          color: #e2e8f0;
        }
        
        .refresh-btn {
          background: none;
          border: none;
          color: #64748b;
          cursor: pointer;
          font-size: 0.9rem;
          padding: 0.25rem;
          border-radius: 4px;
          transition: all 0.15s ease;
        }
        
        .refresh-btn:hover {
          color: #e2e8f0;
          background: rgba(148, 163, 184, 0.1);
        }
        
        .insights-list {
          padding: 0.5rem;
        }
        
        .insight-card {
          display: flex;
          gap: 0.6rem;
          padding: 0.6rem;
          margin-bottom: 0.35rem;
          background: rgba(30, 41, 59, 0.5);
          border-radius: 6px;
          border-left: 3px solid transparent;
        }
        
        .insight-card:last-child {
          margin-bottom: 0;
        }
        
        .insight-card.high {
          border-left-color: rgba(74, 222, 128, 0.7);
        }
        
        .insight-card.medium {
          border-left-color: rgba(251, 191, 36, 0.6);
        }
        
        .insight-card.low {
          border-left-color: rgba(148, 163, 184, 0.4);
        }
        
        .insight-card.type-risk {
          background: rgba(239, 68, 68, 0.05);
        }
        
        .insight-card.type-action {
          background: rgba(59, 130, 246, 0.05);
        }
        
        .insight-icon {
          font-size: 1rem;
          flex-shrink: 0;
        }
        
        .insight-text {
          font-size: 0.8rem;
          color: #e2e8f0;
          line-height: 1.5;
        }
        
        .insight-text strong {
          color: #93c5fd;
        }
        
        .expand-btn {
          display: block;
          width: 100%;
          padding: 0.5rem;
          background: rgba(30, 41, 59, 0.3);
          border: none;
          border-top: 1px solid rgba(148, 163, 184, 0.1);
          color: #64748b;
          font-size: 0.75rem;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        
        .expand-btn:hover {
          background: rgba(30, 41, 59, 0.5);
          color: #e2e8f0;
        }
        
        .loading {
          padding: 1.5rem;
          text-align: center;
          color: #64748b;
          font-size: 0.85rem;
        }
        
        .loading-spinner {
          display: inline-block;
          width: 18px;
          height: 18px;
          border: 2px solid rgba(148, 163, 184, 0.3);
          border-top-color: #3b82f6;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          margin-right: 0.5rem;
          vertical-align: middle;
        }
        
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      </style>
      
      <div class="insights-panel">
        <div class="header">
          <div class="header-left">
            <span class="header-icon">✨</span>
            <span class="header-title">AI Insights</span>
          </div>
          <button class="refresh-btn" id="refresh-btn" title="Refresh insights">↻</button>
        </div>
        
        ${this.isLoading ? `
          <div class="loading">
            <span class="loading-spinner"></span>
            Analyzing data...
          </div>
        ` : `
          <div class="insights-list">
            ${visibleInsights.map(insight => `
              <div class="insight-card ${insight.importance} type-${insight.type}">
                <span class="insight-icon">${insight.icon}</span>
                <span class="insight-text">${insight.text}</span>
              </div>
            `).join("")}
          </div>
          
          ${this.insights.length > 3 ? `
            <button class="expand-btn" id="expand-btn">
              ${this.isExpanded ? "Show less ▲" : `Show ${this.insights.length - 3} more insights ▼`}
            </button>
          ` : ""}
        `}
      </div>
    `;

    this.shadow.getElementById("refresh-btn")?.addEventListener("click", () => {
      this.generateInsights();
    });

    this.shadow.getElementById("expand-btn")?.addEventListener("click", () => {
      this.toggleExpand();
    });
  }
}

customElements.define("view-insights", ViewInsights);
