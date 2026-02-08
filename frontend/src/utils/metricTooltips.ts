/**
 * Metric Tooltips - Definitions and explanations for all financial metrics
 * 
 * Used across the app to provide consistent tooltips on hover.
 */

export interface MetricDefinition {
  name: string;
  description: string;
  interpretation: string;
  goodRange?: string;
  formula?: string;
}

export const METRIC_DEFINITIONS: Record<string, MetricDefinition> = {
  // Core identifiers
  ticker: {
    name: "Ticker Symbol",
    description: "Unique stock identifier on the exchange",
    interpretation: "The short code used to trade the security",
  },
  as_of: {
    name: "As Of Date",
    description: "Date when the data was recorded",
    interpretation: "Indicates the reporting period for the metrics",
  },
  
  // Greenblatt metrics
  ebit: {
    name: "EBIT",
    description: "Earnings Before Interest and Taxes",
    interpretation: "Operating profit before financing costs and taxes. Shows core business profitability.",
    formula: "Revenue - Operating Expenses",
  },
  enterprise_value: {
    name: "Enterprise Value (EV)",
    description: "Total company value including debt",
    interpretation: "Market cap + debt - cash. What it would cost to acquire the entire business.",
    formula: "Market Cap + Total Debt - Cash",
  },
  net_working_capital: {
    name: "Net Working Capital",
    description: "Current assets minus current liabilities",
    interpretation: "Measures short-term liquidity. Positive means company can cover near-term obligations.",
    formula: "Current Assets - Current Liabilities",
  },
  earnings_yield: {
    name: "Earnings Yield",
    description: "EBIT divided by Enterprise Value",
    interpretation: "Higher = cheaper stock. Inverse of EV/EBIT multiple. Used in Greenblatt's Magic Formula.",
    formula: "EBIT / Enterprise Value",
    goodRange: ">10% is attractive",
  },
  return_on_capital: {
    name: "Return on Capital (ROC)",
    description: "EBIT divided by tangible capital employed",
    interpretation: "Measures how efficiently the business converts capital into profits. Higher = better quality business.",
    formula: "EBIT / (Net Working Capital + Net Fixed Assets)",
    goodRange: ">15% indicates competitive advantage",
  },
  
  // Revenue & Growth
  revenue: {
    name: "Revenue",
    description: "Total sales or income from business operations",
    interpretation: "Top-line growth driver. Compare year-over-year to assess business momentum.",
  },
  revenue_growth_yoy: {
    name: "Revenue Growth YoY",
    description: "Year-over-year change in revenue",
    interpretation: "Positive growth indicates expanding business. Double-digit growth is strong.",
    goodRange: ">10% is strong growth",
  },
  
  // Margins
  gross_margin: {
    name: "Gross Margin",
    description: "Revenue minus cost of goods sold, as percentage of revenue",
    interpretation: "Higher margins = stronger pricing power and competitive moat. Stable/expanding margins are bullish.",
    formula: "(Revenue - COGS) / Revenue",
    goodRange: ">40% suggests pricing power",
  },
  operating_margin: {
    name: "Operating Margin",
    description: "Operating income as percentage of revenue",
    interpretation: "Shows profitability after all operating costs. Indicates operating efficiency and scale.",
    formula: "Operating Income / Revenue",
    goodRange: ">15% is healthy",
  },
  net_margin: {
    name: "Net Margin",
    description: "Net income as percentage of revenue",
    interpretation: "Bottom-line profitability. Lower than operating margin due to interest and taxes.",
    formula: "Net Income / Revenue",
    goodRange: ">10% is solid",
  },
  
  // Cash Flow
  free_cash_flow: {
    name: "Free Cash Flow (FCF)",
    description: "Cash from operations minus capital expenditures",
    interpretation: "Cash available for dividends, buybacks, or reinvestment. More reliable than earnings.",
    formula: "Operating Cash Flow - CapEx",
  },
  fcf_yield: {
    name: "FCF Yield",
    description: "Free cash flow divided by market cap",
    interpretation: "Cash return on your investment. Higher = more cash generation relative to price.",
    formula: "Free Cash Flow / Market Cap",
    goodRange: ">5% is attractive",
  },
  
  // Leverage
  total_debt: {
    name: "Total Debt",
    description: "Sum of short-term and long-term debt",
    interpretation: "Higher debt increases risk, especially in rising rate environments.",
  },
  total_equity: {
    name: "Total Equity",
    description: "Assets minus liabilities (book value)",
    interpretation: "Shareholders' stake in the company after all debts paid.",
  },
  debt_to_equity: {
    name: "Debt-to-Equity Ratio",
    description: "Total debt divided by shareholders' equity",
    interpretation: "Measures financial leverage. Higher = more leveraged and risky.",
    formula: "Total Debt / Total Equity",
    goodRange: "<0.5 is conservative, >1.5 is high leverage",
  },
  interest_coverage: {
    name: "Interest Coverage",
    description: "EBIT divided by interest expense",
    interpretation: "Ability to service debt. Below 2x is concerning.",
    formula: "EBIT / Interest Expense",
    goodRange: ">3x is safe",
  },
  
  // Book Value
  book_value: {
    name: "Book Value",
    description: "Total assets minus total liabilities",
    interpretation: "Accounting value of shareholder equity. Compare to market cap for P/B ratio.",
  },
  tangible_book_value: {
    name: "Tangible Book Value",
    description: "Book value minus intangible assets",
    interpretation: "More conservative measure excluding goodwill and other intangibles.",
  },
  book_value_per_share: {
    name: "Book Value Per Share",
    description: "Book value divided by shares outstanding",
    interpretation: "Useful for value investing. Graham's intrinsic value calculations use this.",
    formula: "Book Value / Shares Outstanding",
  },
  
  // Market Data
  market_cap: {
    name: "Market Capitalization",
    description: "Total market value of outstanding shares",
    interpretation: "Company size. Large cap (>$10B), mid cap ($2-10B), small cap (<$2B).",
    formula: "Price × Shares Outstanding",
  },
  price: {
    name: "Stock Price",
    description: "Current trading price per share",
    interpretation: "What you pay. Compare to intrinsic value estimates.",
  },
  shares_outstanding: {
    name: "Shares Outstanding",
    description: "Total number of shares issued",
    interpretation: "Watch for dilution (increasing shares). Buybacks reduce this.",
  },
  
  // Valuation Ratios
  pe_ratio: {
    name: "P/E Ratio",
    description: "Price divided by earnings per share",
    interpretation: "How much you pay per dollar of earnings. Lower = cheaper, but consider growth.",
    formula: "Price / EPS",
    goodRange: "<15 is value territory, >25 is growth premium",
  },
  pb_ratio: {
    name: "P/B Ratio",
    description: "Price divided by book value per share",
    interpretation: "Below 1.0 means trading below liquidation value. Used by value investors.",
    formula: "Price / Book Value Per Share",
    goodRange: "<1.5 per Graham",
  },
  ps_ratio: {
    name: "P/S Ratio",
    description: "Price divided by revenue per share",
    interpretation: "Useful for unprofitable companies. Lower = cheaper relative to sales.",
    formula: "Market Cap / Revenue",
    goodRange: "<2 is reasonable for most industries",
  },
  ev_to_ebitda: {
    name: "EV/EBITDA",
    description: "Enterprise value divided by EBITDA",
    interpretation: "Valuation multiple accounting for debt. Useful for comparing leveraged companies.",
    formula: "Enterprise Value / EBITDA",
    goodRange: "<10 is reasonable, <6 is cheap",
  },
  
  // Dividends
  dividend_yield: {
    name: "Dividend Yield",
    description: "Annual dividend per share divided by price",
    interpretation: "Cash return from dividends. High yield may indicate value or risk.",
    formula: "Annual Dividend / Price",
    goodRange: "2-4% is typical for dividend stocks",
  },
  payout_ratio: {
    name: "Payout Ratio",
    description: "Dividends as percentage of earnings",
    interpretation: "Sustainability of dividend. >100% means paying more than earning.",
    formula: "Dividends / Net Income",
    goodRange: "<60% is sustainable",
  },
  
  // Earnings
  eps: {
    name: "Earnings Per Share (EPS)",
    description: "Net income divided by shares outstanding",
    interpretation: "Profit attributable to each share. Basis for P/E ratio.",
    formula: "Net Income / Shares Outstanding",
  },
  eps_growth_yoy: {
    name: "EPS Growth YoY",
    description: "Year-over-year change in EPS",
    interpretation: "Earnings acceleration is a key torque signal. Watch for consistency.",
    goodRange: ">15% is strong, >25% is exceptional",
  },
  
  // Composite/Calculated
  rank: {
    name: "Rank",
    description: "Position in sorted list",
    interpretation: "Lower rank = better based on the sorting criteria.",
  },
  composite_score: {
    name: "Composite Score",
    description: "Weighted average of multiple percentile rankings",
    interpretation: "Higher = stronger across multiple dimensions. Look for consistent high scores.",
    goodRange: ">70 is strong",
  },
  
  // Formula-based
  graham_number: {
    name: "Graham Number",
    description: "Ben Graham's intrinsic value estimate",
    interpretation: "Theoretical fair value based on earnings and book value. Buy below this.",
    formula: "√(22.5 × EPS × Book Value Per Share)",
  },
  margin_of_safety: {
    name: "Margin of Safety",
    description: "Discount to Graham Number",
    interpretation: "How much below intrinsic value. >30% provides cushion for errors.",
    formula: "(Graham Number - Price) / Graham Number",
    goodRange: ">30% is ideal",
  },
  quality_score: {
    name: "Quality Score",
    description: "Composite of margin stability and leverage",
    interpretation: "Higher = more durable business. Combines margin and balance sheet strength.",
  },
  roic: {
    name: "ROIC",
    description: "Return on Invested Capital",
    interpretation: "Profit relative to all capital invested. Best measure of capital efficiency.",
    formula: "NOPAT / Invested Capital",
    goodRange: ">15% indicates competitive advantage",
  },
  torque_score: {
    name: "Torque Score",
    description: "Earnings acceleration potential",
    interpretation: "Combines EPS growth, margin expansion, and valuation headroom.",
    goodRange: ">70 is high torque potential",
  },
  pricing_power_score: {
    name: "Pricing Power Score",
    description: "Ability to raise prices",
    interpretation: "Based on margin stability and revenue growth. Higher = stronger moat.",
  },
  peg_ratio: {
    name: "PEG Ratio",
    description: "P/E divided by EPS growth rate",
    interpretation: "Valuation adjusted for growth. <1 is potentially undervalued.",
    formula: "P/E Ratio / EPS Growth Rate",
    goodRange: "<1 is attractive, <0.5 is very cheap",
  },
};

/**
 * Get tooltip HTML for a metric
 */
export function getMetricTooltip(metricKey: string): string {
  const def = METRIC_DEFINITIONS[metricKey.toLowerCase()];
  if (!def) {
    return `<strong>${metricKey}</strong>`;
  }
  
  let html = `
    <div class="metric-tooltip">
      <div class="metric-tooltip-name">${def.name}</div>
      <div class="metric-tooltip-desc">${def.description}</div>
      <div class="metric-tooltip-interp">${def.interpretation}</div>
  `;
  
  if (def.formula) {
    html += `<div class="metric-tooltip-formula">Formula: ${def.formula}</div>`;
  }
  
  if (def.goodRange) {
    html += `<div class="metric-tooltip-range">Benchmark: ${def.goodRange}</div>`;
  }
  
  html += `</div>`;
  return html;
}

/**
 * Format metric key to display name
 */
export function formatMetricName(key: string): string {
  const def = METRIC_DEFINITIONS[key.toLowerCase()];
  return def?.name || key.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}
