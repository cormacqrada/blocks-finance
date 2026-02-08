/**
 * UniverseInsights - AI-powered insights across the entire universe
 * 
 * This is a dedicated panel that provides holistic analysis across all
 * stocks in the current universe (global or custom).
 */

import { fetchScreenData } from "../api/client";
import { getMetricTooltip, formatMetricName } from "../utils/metricTooltips";

export interface UniverseInsight {
  category: "opportunity" | "risk" | "trend" | "outlier" | "correlation";
  title: string;
  summary: string;
  details: string;
  tickers: string[];
  metrics: string[];
  confidence: number; // 0-100
  actionable: boolean;
}

interface UniverseStats {
  count: number;
  avgPE: number;
  avgROC: number;
  avgEarningsYield: number;
  avgGrossMargin: number;
  highROC: any[];
  highYield: any[];
  lowDebt: any[];
  marginExpanding: any[];
  undervalued: any[];
  topTorque: any[];
}

/**
 * Analyze universe and generate insights
 */
function generateUniverseInsights(data: any[], universe: string[] | null): UniverseInsight[] {
  const insights: UniverseInsight[] = [];
  
  if (data.length === 0) {
    insights.push({
      category: "risk",
      title: "No Data Available",
      summary: "The universe is empty or data could not be loaded.",
      details: "Add stocks to the universe or check the data source.",
      tickers: [],
      metrics: [],
      confidence: 100,
      actionable: true,
    });
    return insights;
  }
  
  // Calculate universe statistics
  const stats = calculateStats(data);
  
  // Generate various insight types
  insights.push(...findOpportunities(data, stats));
  insights.push(...findRisks(data, stats));
  insights.push(...findTrends(data, stats));
  insights.push(...findOutliers(data, stats));
  insights.push(...findCorrelations(data, stats));
  
  // Sort by confidence and actionability
  insights.sort((a, b) => {
    if (a.actionable !== b.actionable) return a.actionable ? -1 : 1;
    return b.confidence - a.confidence;
  });
  
  return insights.slice(0, 10); // Top 10 insights
}

function calculateStats(data: any[]): UniverseStats {
  const validPE = data.filter(d => d.pe_ratio && d.pe_ratio > 0 && d.pe_ratio < 100);
  const validROC = data.filter(d => d.return_on_capital && d.return_on_capital > 0);
  const validYield = data.filter(d => d.earnings_yield && d.earnings_yield > 0);
  const validMargin = data.filter(d => d.gross_margin && d.gross_margin > 0);
  
  return {
    count: data.length,
    avgPE: validPE.length ? validPE.reduce((s, d) => s + d.pe_ratio, 0) / validPE.length : 0,
    avgROC: validROC.length ? validROC.reduce((s, d) => s + d.return_on_capital, 0) / validROC.length : 0,
    avgEarningsYield: validYield.length ? validYield.reduce((s, d) => s + d.earnings_yield, 0) / validYield.length : 0,
    avgGrossMargin: validMargin.length ? validMargin.reduce((s, d) => s + d.gross_margin, 0) / validMargin.length : 0,
    highROC: data.filter(d => d.return_on_capital > 0.25).sort((a, b) => b.return_on_capital - a.return_on_capital),
    highYield: data.filter(d => d.earnings_yield > 0.15).sort((a, b) => b.earnings_yield - a.earnings_yield),
    lowDebt: data.filter(d => d.debt_to_equity && d.debt_to_equity < 0.3 && d.debt_to_equity >= 0),
    marginExpanding: data.filter(d => d.gross_margin > 0.4 && d.operating_margin > 0.15),
    undervalued: data.filter(d => d.pb_ratio && d.pb_ratio < 1.5 && d.pe_ratio && d.pe_ratio < 15),
    topTorque: data.filter(d => d.eps_growth_yoy > 0.2 && d.pe_ratio && d.pe_ratio < 20),
  };
}

function findOpportunities(data: any[], stats: UniverseStats): UniverseInsight[] {
  const insights: UniverseInsight[] = [];
  
  // High quality + cheap
  const qualityCheap = data.filter(d => 
    d.return_on_capital > 0.2 && 
    d.earnings_yield > 0.1 &&
    d.debt_to_equity < 0.5
  );
  
  if (qualityCheap.length > 0) {
    insights.push({
      category: "opportunity",
      title: "Quality at Reasonable Price",
      summary: `${qualityCheap.length} companies show high returns with attractive valuations.`,
      details: `These businesses earn >20% ROC, yield >10%, with low leverage. Classic value investing targets.`,
      tickers: qualityCheap.slice(0, 5).map(d => d.ticker),
      metrics: ["return_on_capital", "earnings_yield", "debt_to_equity"],
      confidence: 85,
      actionable: true,
    });
  }
  
  // Torque candidates
  if (stats.topTorque.length > 0) {
    insights.push({
      category: "opportunity",
      title: "Earnings Torque Candidates",
      summary: `${stats.topTorque.length} stocks show accelerating earnings with valuation headroom.`,
      details: `EPS growth >20% YoY combined with P/E <20 suggests potential for multiple expansion.`,
      tickers: stats.topTorque.slice(0, 5).map((d: any) => d.ticker),
      metrics: ["eps_growth_yoy", "pe_ratio"],
      confidence: 75,
      actionable: true,
    });
  }
  
  // Graham value
  if (stats.undervalued.length > 0) {
    insights.push({
      category: "opportunity",
      title: "Graham-Style Deep Value",
      summary: `${stats.undervalued.length} stocks trade below classic value thresholds.`,
      details: `P/B <1.5 and P/E <15 meet Ben Graham's defensive investor criteria.`,
      tickers: stats.undervalued.slice(0, 5).map((d: any) => d.ticker),
      metrics: ["pb_ratio", "pe_ratio"],
      confidence: 80,
      actionable: true,
    });
  }
  
  return insights;
}

function findRisks(data: any[], stats: UniverseStats): UniverseInsight[] {
  const insights: UniverseInsight[] = [];
  
  // High leverage
  const highLeverage = data.filter(d => d.debt_to_equity > 1.5);
  if (highLeverage.length > 0) {
    insights.push({
      category: "risk",
      title: "High Leverage Warning",
      summary: `${highLeverage.length} companies carry excessive debt loads.`,
      details: `Debt/Equity >1.5x increases bankruptcy risk in economic downturns.`,
      tickers: highLeverage.slice(0, 5).map(d => d.ticker),
      metrics: ["debt_to_equity", "interest_coverage"],
      confidence: 90,
      actionable: true,
    });
  }
  
  // Expensive growth
  const expensiveGrowth = data.filter(d => 
    d.pe_ratio > 30 && 
    (!d.eps_growth_yoy || d.eps_growth_yoy < 0.15)
  );
  if (expensiveGrowth.length > 0) {
    insights.push({
      category: "risk",
      title: "Expensive Without Growth",
      summary: `${expensiveGrowth.length} stocks have high multiples without matching growth.`,
      details: `P/E >30 with <15% EPS growth suggests overvaluation risk.`,
      tickers: expensiveGrowth.slice(0, 5).map(d => d.ticker),
      metrics: ["pe_ratio", "eps_growth_yoy"],
      confidence: 85,
      actionable: true,
    });
  }
  
  // Margin compression
  const marginPressure = data.filter(d => 
    d.gross_margin < 0.25 && 
    d.operating_margin < 0.05
  );
  if (marginPressure.length > 0) {
    insights.push({
      category: "risk",
      title: "Margin Pressure",
      summary: `${marginPressure.length} companies show weak profitability.`,
      details: `Low gross and operating margins suggest weak pricing power or cost issues.`,
      tickers: marginPressure.slice(0, 5).map(d => d.ticker),
      metrics: ["gross_margin", "operating_margin"],
      confidence: 80,
      actionable: false,
    });
  }
  
  return insights;
}

function findTrends(data: any[], stats: UniverseStats): UniverseInsight[] {
  const insights: UniverseInsight[] = [];
  
  // Universe valuation level
  if (stats.avgPE > 0) {
    const level = stats.avgPE < 15 ? "attractively valued" : stats.avgPE > 25 ? "richly valued" : "fairly valued";
    insights.push({
      category: "trend",
      title: "Universe Valuation Level",
      summary: `The ${stats.count}-stock universe appears ${level} at ${stats.avgPE.toFixed(1)}x P/E.`,
      details: `Historical S&P 500 average is ~16x. Current level suggests ${
        stats.avgPE < 15 ? "potential opportunity" : stats.avgPE > 25 ? "caution warranted" : "normal conditions"
      }.`,
      tickers: [],
      metrics: ["pe_ratio"],
      confidence: 70,
      actionable: false,
    });
  }
  
  // Quality concentration
  if (stats.highROC.length > 0) {
    const pctHighQuality = (stats.highROC.length / stats.count * 100).toFixed(0);
    insights.push({
      category: "trend",
      title: "Quality Distribution",
      summary: `${pctHighQuality}% of the universe (${stats.highROC.length} stocks) earn >25% ROC.`,
      details: `High quality businesses with durable competitive advantages.`,
      tickers: stats.highROC.slice(0, 5).map((d: any) => d.ticker),
      metrics: ["return_on_capital"],
      confidence: 75,
      actionable: false,
    });
  }
  
  return insights;
}

function findOutliers(data: any[], stats: UniverseStats): UniverseInsight[] {
  const insights: UniverseInsight[] = [];
  
  // Extreme ROC
  const extremeROC = data.filter(d => d.return_on_capital > 0.5);
  if (extremeROC.length > 0) {
    insights.push({
      category: "outlier",
      title: "Exceptional Capital Efficiency",
      summary: `${extremeROC.length} companies earn >50% return on capital.`,
      details: `These rare businesses likely have strong moats. Worth investigating competitive advantages.`,
      tickers: extremeROC.map(d => d.ticker),
      metrics: ["return_on_capital"],
      confidence: 90,
      actionable: true,
    });
  }
  
  // Negative enterprise value
  const negativeEV = data.filter(d => d.enterprise_value && d.enterprise_value < 0);
  if (negativeEV.length > 0) {
    insights.push({
      category: "outlier",
      title: "Net Cash Position",
      summary: `${negativeEV.length} companies have cash exceeding market cap + debt.`,
      details: `Negative EV can signal deep value or potential issues. Requires investigation.`,
      tickers: negativeEV.map(d => d.ticker),
      metrics: ["enterprise_value", "market_cap"],
      confidence: 85,
      actionable: true,
    });
  }
  
  return insights;
}

function findCorrelations(data: any[], stats: UniverseStats): UniverseInsight[] {
  const insights: UniverseInsight[] = [];
  
  // Margin-valuation relationship
  const highMarginCheap = data.filter(d => 
    d.gross_margin > 0.5 && 
    d.pe_ratio && d.pe_ratio < 20
  );
  if (highMarginCheap.length > 0) {
    insights.push({
      category: "correlation",
      title: "Pricing Power + Value",
      summary: `${highMarginCheap.length} high-margin businesses trade at reasonable multiples.`,
      details: `>50% gross margin with <20 P/E suggests quality not fully priced in.`,
      tickers: highMarginCheap.slice(0, 5).map(d => d.ticker),
      metrics: ["gross_margin", "pe_ratio"],
      confidence: 80,
      actionable: true,
    });
  }
  
  return insights;
}

/**
 * Render Universe Insights panel
 */
export async function renderUniverseInsights(
  container: HTMLElement,
  universe: string[] | null
): Promise<void> {
  container.innerHTML = `
    <div class="universe-insights-loading">
      <div class="loading-spinner"></div>
      <p>Analyzing universe...</p>
    </div>
  `;
  
  try {
    // Fetch data for the universe
    const result = await fetchScreenData({
      filters: universe ? [{ field: "ticker", op: "IN" as const, value: universe }] : [],
      columns: [
        "ticker", "pe_ratio", "pb_ratio", "ps_ratio",
        "return_on_capital", "earnings_yield", "gross_margin", "operating_margin",
        "debt_to_equity", "interest_coverage", "eps_growth_yoy", "revenue_growth_yoy",
        "enterprise_value", "market_cap", "free_cash_flow", "fcf_yield"
      ],
      rank_by: "return_on_capital",
      limit: 100,
    });
    
    const data = result.rows || [];
    const insights = generateUniverseInsights(data, universe);
    
    container.innerHTML = `
      <div class="universe-insights">
        <div class="insights-header">
          <h3>🧠 Universe AI Insights</h3>
          <span class="universe-badge">${universe ? universe.length + " stocks" : "All stocks"}</span>
        </div>
        <div class="insights-list">
          ${insights.map(insight => renderInsightCard(insight)).join("")}
        </div>
        <div class="insights-footer">
          <small>Analysis based on latest available fundamentals</small>
        </div>
      </div>
    `;
    
    // Add tooltip listeners for metric badges
    container.querySelectorAll(".metric-badge").forEach(badge => {
      const metric = badge.getAttribute("data-metric");
      if (metric) {
        badge.setAttribute("title", "");
        (badge as HTMLElement).addEventListener("mouseenter", (e) => {
          showTooltip(e as MouseEvent, metric);
        });
        (badge as HTMLElement).addEventListener("mouseleave", hideTooltip);
      }
    });
    
  } catch (error) {
    container.innerHTML = `
      <div class="universe-insights-error">
        <p>⚠️ Failed to analyze universe</p>
        <small>${error instanceof Error ? error.message : "Unknown error"}</small>
      </div>
    `;
  }
}

function renderInsightCard(insight: UniverseInsight): string {
  const categoryIcons: Record<string, string> = {
    opportunity: "🎯",
    risk: "⚠️",
    trend: "📈",
    outlier: "🔍",
    correlation: "🔗",
  };
  
  const categoryColors: Record<string, string> = {
    opportunity: "#22c55e",
    risk: "#ef4444",
    trend: "#3b82f6",
    outlier: "#f59e0b",
    correlation: "#8b5cf6",
  };
  
  return `
    <div class="insight-card insight-${insight.category}">
      <div class="insight-header">
        <span class="insight-icon">${categoryIcons[insight.category]}</span>
        <span class="insight-title">${insight.title}</span>
        ${insight.actionable ? '<span class="actionable-badge">Actionable</span>' : ''}
      </div>
      <div class="insight-summary">${insight.summary}</div>
      <div class="insight-details">${insight.details}</div>
      ${insight.tickers.length > 0 ? `
        <div class="insight-tickers">
          <strong>Tickers:</strong> ${insight.tickers.map(t => `<span class="ticker-tag">${t}</span>`).join(" ")}
        </div>
      ` : ""}
      <div class="insight-metrics">
        ${insight.metrics.map(m => `<span class="metric-badge" data-metric="${m}">${formatMetricName(m)}</span>`).join(" ")}
      </div>
      <div class="insight-confidence">
        <div class="confidence-bar" style="width: ${insight.confidence}%; background: ${categoryColors[insight.category]}"></div>
        <span>${insight.confidence}% confidence</span>
      </div>
    </div>
  `;
}

// Global tooltip element
let tooltipEl: HTMLElement | null = null;

function showTooltip(event: MouseEvent, metric: string) {
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.className = "metric-tooltip-popup";
    document.body.appendChild(tooltipEl);
  }
  
  tooltipEl.innerHTML = getMetricTooltip(metric);
  tooltipEl.style.display = "block";
  
  const rect = (event.target as HTMLElement).getBoundingClientRect();
  tooltipEl.style.left = `${rect.left}px`;
  tooltipEl.style.top = `${rect.bottom + 8}px`;
}

function hideTooltip() {
  if (tooltipEl) {
    tooltipEl.style.display = "none";
  }
}
