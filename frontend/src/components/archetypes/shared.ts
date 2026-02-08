/**
 * Shared utilities for archetype visualization components
 * 
 * Provides:
 * - Common styles (explainer, insights, ticker links, metric tooltips)
 * - Ticker link event handling
 * - AI insight generation helpers
 * - Metric tooltip definitions
 */

// Metric definitions with explanations
export const METRIC_TOOLTIPS: Record<string, { label: string; explain: string }> = {
  pe_ratio: { label: "P/E", explain: "Price to Earnings ratio. Lower = cheaper relative to earnings." },
  pb_ratio: { label: "P/B", explain: "Price to Book ratio. <1 = trading below asset value." },
  ev_to_ebitda: { label: "EV/EBITDA", explain: "Enterprise Value to EBITDA. Lower = cheaper including debt." },
  gross_margin: { label: "Gross Margin", explain: "Revenue minus cost of goods. Higher = better pricing power." },
  operating_margin: { label: "Op Margin", explain: "Profit after operating costs. Shows operational efficiency." },
  net_margin: { label: "Net Margin", explain: "Bottom-line profit. What actually drops to shareholders." },
  fcf_yield: { label: "FCF Yield", explain: "Free cash flow / market cap. Higher = more cash per $ invested." },
  roic: { label: "ROIC", explain: "Return on Invested Capital. How well capital is deployed." },
  debt_to_equity: { label: "D/E", explain: "Debt to Equity ratio. Lower = less leveraged, safer." },
  eps_growth_yoy: { label: "EPS Growth", explain: "Year-over-year earnings growth. Positive = improving." },
  revenue_growth_yoy: { label: "Rev Growth", explain: "Year-over-year revenue growth. Shows demand." },
  payout_ratio: { label: "Payout", explain: "% of earnings paid as dividends. Lower = more reinvestment." },
};

// Common CSS for all archetype views
export const SHARED_STYLES = `
  :host {
    display: block;
    height: 100%;
    overflow: auto;
  }
  .container {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  
  /* Header section */
  .header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .header h2 {
    margin: 0;
    font-size: 1.1rem;
    color: #f1f5f9;
  }
  .signal {
    font-size: 0.8rem;
    color: #94a3b8;
    font-style: italic;
    background: var(--signal-bg, rgba(74, 222, 128, 0.1));
    padding: 0.25rem 0.75rem;
    border-radius: 4px;
    border-left: 3px solid var(--signal-color, #22c55e);
  }
  
  /* Chart sections */
  .chart-section {
    background: rgba(30, 41, 59, 0.6);
    border-radius: 8px;
    padding: 1rem;
    border: 1px solid rgba(148, 163, 184, 0.1);
  }
  .chart-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }
  .chart-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: #e2e8f0;
  }
  .chart-explainer {
    font-size: 0.72rem;
    color: #64748b;
    line-height: 1.4;
    max-width: 65%;
  }
  .chart-explainer strong {
    color: #94a3b8;
  }
  .chart-container {
    position: relative;
    height: 260px;
  }
  
  /* Ticker badges - clickable */
  .ticker-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.75rem;
  }
  .ticker-badge {
    background: var(--badge-bg, rgba(74, 222, 128, 0.15));
    color: var(--badge-color, #4ade80);
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    font-size: 0.72rem;
    font-weight: 600;
    font-family: ui-monospace, monospace;
    cursor: pointer;
    transition: all 0.15s ease;
    border: 1px solid transparent;
  }
  .ticker-badge:hover {
    background: var(--badge-hover-bg, rgba(74, 222, 128, 0.25));
    border-color: var(--badge-color, #4ade80);
    transform: translateY(-1px);
  }
  
  /* Metric badges with tooltips */
  .metric-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.15rem 0.4rem;
    background: rgba(148, 163, 184, 0.1);
    border-radius: 3px;
    font-size: 0.65rem;
    color: #94a3b8;
    cursor: help;
    position: relative;
  }
  .metric-badge:hover {
    background: rgba(148, 163, 184, 0.2);
    color: #e2e8f0;
  }
  .metric-badge .metric-tooltip {
    display: none;
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(15, 23, 42, 0.95);
    border: 1px solid rgba(148, 163, 184, 0.3);
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    font-size: 0.7rem;
    color: #cbd5e1;
    white-space: nowrap;
    max-width: 200px;
    white-space: normal;
    z-index: 100;
    margin-bottom: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }
  .metric-badge:hover .metric-tooltip {
    display: block;
  }
  
  /* AI Insights section */
  .insights-section {
    background: rgba(139, 92, 246, 0.08);
    border: 1px solid rgba(139, 92, 246, 0.2);
    border-radius: 8px;
    padding: 0.75rem 1rem;
  }
  .insights-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .insights-header span {
    font-size: 0.8rem;
    font-weight: 600;
    color: #a78bfa;
  }
  .insights-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .insight-item {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    font-size: 0.75rem;
    color: #cbd5e1;
    line-height: 1.4;
  }
  .insight-icon {
    flex-shrink: 0;
    font-size: 0.85rem;
  }
  .insight-highlight {
    color: #4ade80;
    font-weight: 500;
  }
  .insight-warning {
    color: #fbbf24;
    font-weight: 500;
  }
  .insight-neutral {
    color: #94a3b8;
  }
  
  /* Loading state */
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 200px;
    color: #64748b;
  }
  
  /* Empty state */
  .empty-state {
    text-align: center;
    padding: 2rem;
    color: #64748b;
    font-size: 0.85rem;
  }
`;

// Generate clickable ticker badges HTML
export function renderTickerBadges(
  tickers: string[],
  maxShow: number = 10,
  badgeBg?: string,
  badgeColor?: string
): string {
  const shown = tickers.slice(0, maxShow);
  const remaining = tickers.length - maxShow;
  
  let html = shown
    .map(t => `<span class="ticker-badge" data-ticker="${t}">${t}</span>`)
    .join("");
    
  if (remaining > 0) {
    html += `<span class="ticker-badge" style="background: rgba(148,163,184,0.1); color: #64748b; cursor: default;">+${remaining} more</span>`;
  }
  
  return html;
}

// Generate metric badge with tooltip
export function renderMetricBadge(metric: string, value: number | string, decimals: number = 1): string {
  const def = METRIC_TOOLTIPS[metric];
  const label = def?.label || metric;
  const explain = def?.explain || "";
  const formatted = typeof value === "number" ? value.toFixed(decimals) : value;
  
  return `
    <span class="metric-badge">
      ${label}: ${formatted}
      ${explain ? `<span class="metric-tooltip">${explain}</span>` : ""}
    </span>
  `;
}

// AI insight generator for archetypes
export interface InsightData {
  fundamentals: any[];
  archetype: string;
}

export interface Insight {
  icon: string;
  text: string;
  type: "positive" | "warning" | "neutral";
}

export function generateArchetypeInsights(data: InsightData): Insight[] {
  const insights: Insight[] = [];
  const { fundamentals, archetype } = data;
  
  if (fundamentals.length === 0) {
    return [{ icon: "📊", text: "No data available. Run data ingestion to populate.", type: "neutral" }];
  }
  
  // Common metrics analysis
  const avgPE = fundamentals.reduce((sum, r) => sum + (r.pe_ratio || 0), 0) / fundamentals.length;
  const avgMargin = fundamentals.reduce((sum, r) => sum + (r.gross_margin || 0), 0) / fundamentals.length;
  const highGrowth = fundamentals.filter(r => (r.eps_growth_yoy || 0) > 15).length;
  const undervalued = fundamentals.filter(r => (r.pe_ratio || 0) < 15 && (r.pe_ratio || 0) > 0).length;
  
  // Archetype-specific insights
  switch (archetype) {
    case "compounders":
      if (avgMargin > 40) {
        insights.push({ icon: "💪", text: `Strong pricing power: avg gross margin ${avgMargin.toFixed(1)}% suggests durable competitive advantage`, type: "positive" });
      }
      const steadyGrowers = fundamentals.filter(r => (r.eps_growth_yoy || 0) > 5 && (r.eps_growth_yoy || 0) < 25).length;
      if (steadyGrowers > fundamentals.length * 0.4) {
        insights.push({ icon: "📈", text: `${steadyGrowers} companies show steady 5-25% growth — classic compounder territory`, type: "positive" });
      }
      break;
      
    case "qarp":
      if (undervalued > fundamentals.length * 0.3) {
        insights.push({ icon: "💎", text: `${undervalued} stocks trading at P/E < 15 with quality metrics — potential QARP candidates`, type: "positive" });
      }
      const pegBelow1 = fundamentals.filter(r => r.eps_growth_yoy > r.pe_ratio).length;
      if (pegBelow1 > 0) {
        insights.push({ icon: "🎯", text: `${pegBelow1} stocks have growth > P/E (implied PEG < 1) — watch these closely`, type: "positive" });
      }
      break;
      
    case "turnarounds":
      const debtConcern = fundamentals.filter(r => (r.debt_to_equity || 0) > 1.5).length;
      if (debtConcern > 0) {
        insights.push({ icon: "⚠️", text: `${debtConcern} companies have D/E > 1.5 — monitor debt reduction progress`, type: "warning" });
      }
      const marginRecovery = fundamentals.filter(r => (r.operating_margin || 0) > 0 && (r.operating_margin || 0) < 10).length;
      if (marginRecovery > 0) {
        insights.push({ icon: "🔄", text: `${marginRecovery} companies showing early margin recovery (0-10% operating)`, type: "positive" });
      }
      break;
      
    case "rerating":
      if (avgPE < 20 && highGrowth > fundamentals.length * 0.3) {
        insights.push({ icon: "📈", text: `Avg P/E ${avgPE.toFixed(1)}x with ${highGrowth} high-growth names — multiple expansion potential`, type: "positive" });
      }
      break;
      
    case "capital-allocators":
      const buybackCandidates = fundamentals.filter(r => (r.fcf_yield || 0) > 5 && (r.pe_ratio || 0) < 20).length;
      if (buybackCandidates > 0) {
        insights.push({ icon: "💰", text: `${buybackCandidates} stocks with FCF yield > 5% and low multiples — efficient buyback zone`, type: "positive" });
      }
      break;
      
    case "structural-winners":
      if (highGrowth > fundamentals.length * 0.4) {
        insights.push({ icon: "🚀", text: `${highGrowth} companies showing >15% growth — check if industry-driven or share gains`, type: "positive" });
      }
      break;
      
    case "antifragile":
      const lowDebt = fundamentals.filter(r => (r.debt_to_equity || 0) < 0.5).length;
      if (lowDebt > fundamentals.length * 0.3) {
        insights.push({ icon: "🛡️", text: `${lowDebt} companies with D/E < 0.5 — fortress balance sheets for downturns`, type: "positive" });
      }
      const stableMargins = fundamentals.filter(r => (r.gross_margin || 0) > 35).length;
      if (stableMargins > 0) {
        insights.push({ icon: "📊", text: `${stableMargins} stocks with gross margins > 35% — pricing power during stress`, type: "positive" });
      }
      break;
  }
  
  // General insights if we don't have enough archetype-specific ones
  if (insights.length < 2) {
    if (fundamentals.length < 10) {
      insights.push({ icon: "📊", text: `Small sample (${fundamentals.length} stocks) — consider broadening filters`, type: "neutral" });
    }
    if (avgPE > 0 && avgPE < 25) {
      insights.push({ icon: "💵", text: `Universe avg P/E: ${avgPE.toFixed(1)}x — ${avgPE < 15 ? "value territory" : "fair valuations"}`, type: avgPE < 15 ? "positive" : "neutral" });
    }
  }
  
  return insights.slice(0, 4); // Max 4 insights
}

// Render insights section HTML
export function renderInsightsSection(insights: Insight[]): string {
  if (insights.length === 0) return "";
  
  return `
    <div class="insights-section">
      <div class="insights-header">
        <span>🧠 AI Insights</span>
      </div>
      <div class="insights-list">
        ${insights.map(i => `
          <div class="insight-item">
            <span class="insight-icon">${i.icon}</span>
            <span class="${i.type === 'positive' ? 'insight-highlight' : i.type === 'warning' ? 'insight-warning' : 'insight-neutral'}">${i.text}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

// Setup ticker click handlers (call in connectedCallback)
export function setupTickerLinks(shadowRoot: ShadowRoot) {
  shadowRoot.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("ticker-badge") && target.dataset.ticker) {
      const ticker = target.dataset.ticker;
      // Dispatch navigate event
      shadowRoot.host.dispatchEvent(new CustomEvent("navigate-stock", {
        detail: { ticker },
        bubbles: true,
        composed: true,
      }));
    }
  });
}
