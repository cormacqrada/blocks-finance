/**
 * ViewExplainer - Contextual help that explains what each view is for
 * 
 * Provides:
 * - What the view shows
 * - What to look for
 * - How to interpret signals
 * - Common pitfalls to avoid
 */

export interface ViewExplanation {
  title: string;
  purpose: string;
  lookFor: string[];
  interpretation: string;
  pitfalls: string[];
  relatedViews?: string[];
}

export const VIEW_EXPLANATIONS: Record<string, ViewExplanation> = {
  "torque-scatter": {
    title: "Torque Scatter: Earnings vs Valuation",
    purpose: "Find companies with improving earnings that haven't been re-rated yet. This is your primary torque finder.",
    lookFor: [
      "Top-left quadrant: High EPS growth + Low valuation = Maximum torque potential",
      "Green dots: Improving margins signal sustainable growth",
      "Large dots: High operating leverage amplifies earnings gains",
      "Clusters: Multiple opportunities in similar areas may indicate sector rotation",
    ],
    interpretation: "A company in the torque zone (top-left) with green color and large size has: accelerating earnings, expanding margins, and operating leverage. This combination can lead to significant multiple expansion.",
    pitfalls: [
      "One-time earnings boosts (asset sales, accounting changes) create false positives",
      "Cyclical peaks can look like torque but mean-revert quickly",
      "Verify margin improvement is from pricing power, not cost cuts",
      "Check if low multiple is justified by structural issues",
    ],
    relatedViews: ["torque-ranking", "torque-heatmap"],
  },
  "torque-ranking": {
    title: "Torque Ranking Table",
    purpose: "Systematically rank companies on torque dimensions using percentiles to avoid scale distortion across industries.",
    lookFor: [
      "High composite scores (70+): Strong across multiple dimensions",
      "Consistent percentiles: Not just one outlier metric",
      "EPS acceleration in top quartile: Core torque signal",
      "FCF yield percentile: Validates earnings quality",
    ],
    interpretation: "Percentiles show relative strength vs the universe. A company at 90th percentile for EPS growth is outperforming 90% of peers. The composite score weights: EPS (35%), Margin (25%), Op Leverage (20%), FCF (20%).",
    pitfalls: [
      "Universe composition matters: tech vs banks have different profiles",
      "Recent IPOs may have insufficient history",
      "One metric can't carry a weak overall profile",
      "Percentiles can compress in homogeneous sectors",
    ],
    relatedViews: ["torque-scatter", "torque-heatmap"],
  },
  "torque-heatmap": {
    title: "Torque Heatmap",
    purpose: "Identify companies that light up across multiple torque dimensions. Horizontal green bands = high conviction opportunities.",
    lookFor: [
      "Horizontal green bands: Strong across ALL metrics",
      "Consistent color patterns: Avoid companies with mixed signals",
      "Sector patterns: Vertical columns showing industry-wide trends",
      "Outlier cells: Extreme strength or weakness in specific metrics",
    ],
    interpretation: "Each cell shows percentile strength (0-100%) for that metric. Green = top quintile, Red = bottom quintile. The average column summarizes overall torque strength.",
    pitfalls: [
      "One green metric doesn't make a torque opportunity",
      "Watch for 'checkbox' situations: looks good but lacks conviction",
      "Verify P/E column isn't just sector-adjusted cheap",
      "Cross-reference with scatter to see the full picture",
    ],
    relatedViews: ["torque-scatter", "torque-ranking"],
  },
  "greenblatt": {
    title: "Greenblatt Magic Formula",
    purpose: "Apply Joel Greenblatt's quantitative value strategy: rank by earnings yield and return on capital combined.",
    lookFor: [
      "Low rank numbers: Best combined value + quality score",
      "High earnings yield: Stock is cheap relative to earnings",
      "High ROC: Business generates good returns on invested capital",
      "Diversification across ranks 1-30 for portfolio construction",
    ],
    interpretation: "The magic formula ranks stocks by: (1) earnings yield (EBIT/EV) and (2) return on capital (EBIT/(Net Working Capital + Net Fixed Assets)). Combined rank identifies cheap, high-quality businesses.",
    pitfalls: [
      "Financial stocks often screen artificially well/poorly",
      "Cyclical earnings can distort rankings",
      "Small caps may have liquidity issues",
      "Requires holding period of 1+ year for mean reversion",
    ],
  },
  "screener": {
    title: "Stock Screener",
    purpose: "Filter and rank stocks using custom criteria. Build your own screens for specific investment theses.",
    lookFor: [
      "Consistent patterns in top results",
      "Reasonable filter combinations (not over-constrained)",
      "Ranking metric aligned with your thesis",
      "Sufficient universe remaining after filters",
    ],
    interpretation: "Filters narrow the universe; ranking sorts what remains. Start broad, then add filters incrementally. Test different ranking metrics to see how results shift.",
    pitfalls: [
      "Over-filtering leaves too few results",
      "Data quality varies by metric",
      "Point-in-time lookback may differ from live data",
      "Popular screens get crowded",
    ],
  },
  "value-compression-map": {
    title: "Value Compression Map",
    purpose: "Find stocks where operational stability and valuation compression converge — durable businesses trading at deep discounts with capital being returned and thesis acceleration underway.",
    lookFor: [
      "Top-right target zone: High stability + high compression = ideal convergence",
      "Bright bubbles: High IVRV means the value thesis is actively working",
      "Large bubbles: High shareholder yield means fast capital return",
      "Blue vs amber: S&P 500 vs small/mid cap — compare risk profiles across cap sizes",
    ],
    interpretation: "X-axis measures how boring and survivable the business is (margin durability + balance sheet). Y-axis measures how cheap the stock is (inverted multiples + FCF). The target zone (top-right, dashed green) is where all four signals converge: stable business, compressed valuation, high capital return, and accelerating realization. Stocks outside the target zone may be cheap but unstable (left), stable but expensive (bottom-right), or value traps (high compression + low IVRV).",
    pitfalls: [
      "High compression alone doesn't mean opportunity — low IVRV may indicate a permanent value trap",
      "Stability scores can be misleading for financials and cyclicals (inherantly different margin structures)",
      "Small cap data is noisier — confirm with direct due diligence",
      "Shareholder yield can spike from one-time special dividends",
    ],
    relatedViews: ["torque-scatter", "greenblatt"],
  },
  "vrr-capital-view": {
    title: "VRR Capital Deployment",
    purpose: "See how much of your value thesis has been realized per position, and use Kelly + marginal IRR to decide exactly how much capital to add, hold, or rotate.",
    lookFor: [
      "VRR gauges: High % = thesis captured, low spread left; low % = wide spread remaining",
      "Deployment matrix top-right: Wide spread + fast velocity = add aggressively",
      "IRR curve Zone 1 (green): Above hurdle rate with positive Kelly = deploy capital",
      "IRR curve Zone 3 (red): Below hurdle rate = stop adding, value trap boundary",
    ],
    interpretation: "VRR (Value Realization Rate) measures thesis progress: 50% VRR means half the gap to intrinsic value has closed. The deployment matrix plots velocity (IVRV) vs spread (compression) — top-right is the add zone. The Kelly + IRR simulator is the key capital allocation tool: as you add more capital at current prices, your average cost rises and marginal IRR declines. Kelly fraction shrinks accordingly. The three zones tell you: deploy (IRR > hurdle + Kelly > 0), diminishing returns (half-Kelly discipline), stop (IRR < hurdle). Drag the capital slider to find your exact sizing ceiling.",
    pitfalls: [
      "Kelly assumes fixed odds — but in value investing, edge is a function of price (the IRR curve makes this explicit)",
      "IRR estimates depend on velocity multipliers — slow stocks may never realize their spread",
      "Half-Kelly is usually safer than full Kelly — it gives up ~25% of growth but cuts variance dramatically",
      "Graham intrinsic value estimates are approximate — actual value depends on future cash flows",
    ],
    relatedViews: ["value-compression-map", "greenblatt"],
  },
  "watchlist-momentum": {
    title: "Momentum Watchlist",
    purpose: "Track your personal watchlist with session-by-session momentum ribbons, timeframe-synced % change, volatility scores, and streak-based sort — so you can spot which stocks are building consistent directional momentum vs. one-day spikes.",
    lookFor: [
      "🔥 Streak sort: stocks with ≥3 consecutive up sessions are building momentum — watch for continuation",
      "Ribbon shape: steady green bars = consistent uptrend; alternating = choppy; long red run = distribution",
      "High Vol + High Streak: risky but high-velocity; Low Vol + High Streak: highest quality momentum",
      "Correlation matrix (red pairs): stocks that tend to fall together — reduce concentration risk",
      "% toggle: switch to $ mode to compare absolute dollar impact on a fixed-dollar position",
    ],
    interpretation: "Change the timeframe first — all % changes, ribbons, and streaks resync to that window. 1M is the default: good for swing trade momentum. Use 1Y to find secular leaders. Streaks are counted at the ribbon bar level so a '▲5' in 1D means 5 hourly bars; in 1M it means 5 trading days. Sort by 🔥 Streak to float the true momentum leaders. Click any ribbon bar for the exact date, session return, close price, and cumulative gain.",
    pitfalls: [
      "Simulated data — connect backend /api/price_history for live prices",
      "Streak length alone doesn't predict continuation; confirm with volume and fundamentals",
      "High correlation (red matrix) = undiversified — a market drop will hit all of them simultaneously",
      "Volatility shows historical range, not future risk; a low-vol stock can gap on earnings",
    ],
    relatedViews: ["torque-scatter", "compounding-discount-monitor"],
  },
  "compounding-discount-monitor": {
    title: "Compounding Discount Monitor — Getty Oil Inspired",
    purpose: "Track the disconnect between a company's internal wealth creation (compounding book value) and its market perception (Price-to-Book ratio). Inspired by Getty Oil, which compounded BVPS at 11% CAGR while trading at 0.63x P/B — eventually delivering 17.5% CAGR over 22 years ($18 to $625).",
    lookFor: [
      "Opportunity quadrant (top-left): High BVPS CAGR + low P/B = compounding at a discount — the sweet spot",
      "Getty-type gaps: Stocks compounding ≥10% at P/B < 0.8x — the market is blind to internal value creation",
      "Look-through toggle: Adjusts P/B for subsidiaries, net cash, and hidden assets — reveals true discount depth",
      "Family stake filter: Insider-controlled compounders may stay discounted longer (takeover protection), but alignment is strong",
    ],
    interpretation: "The scatter maps P/B ratio (x-axis) against BVPS CAGR (y-axis). The fair-value line at P/B = 1.0 separates discount from premium. The sweet-spot band (12-20% CAGR) shows ideal compounder territory. When look-through P/B is enabled, positions shift left as hidden assets reduce effective P/B — some stocks move from 'watch' into 'opportunity'. The BVPS trail shows the widening arbitrage gap: book value compounds upward while price stays flat, creating a growing divergence that eventually closes (as it did for Getty Oil).",
    pitfalls: [
      "Low P/B + low CAGR = value trap — the business isn't actually compounding, it's just cheap for a reason",
      "Family-controlled discounts may persist for decades — don't bet on near-term catalyst",
      "Look-through adjustments are estimates — tangible book and net cash may differ from true subsidiary value",
      "CAGR approximated via sustainable growth (ROE × retention) may not match actual 5-year history",
    ],
    relatedViews: ["value-compression-map", "vrr-capital-view"],
  },
};

export class ViewExplainer extends HTMLElement {
  private shadow: ShadowRoot;
  private viewType: string = "";
  private isExpanded: boolean = false;

  static get observedAttributes() {
    return ["view-type", "expanded"];
  }

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback(name: string, _old: string, value: string) {
    if (name === "view-type") {
      this.viewType = value;
      this.render();
    }
    if (name === "expanded") {
      this.isExpanded = value === "true";
      this.render();
    }
  }

  private toggle() {
    this.isExpanded = !this.isExpanded;
    this.render();
  }

  private render() {
    const explanation = VIEW_EXPLANATIONS[this.viewType];
    
    if (!explanation) {
      this.shadow.innerHTML = "";
      return;
    }

    this.shadow.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: system-ui, -apple-system, sans-serif;
        }
        
        .explainer {
          background: rgba(30, 41, 59, 0.6);
          border: 1px solid rgba(148, 163, 184, 0.2);
          border-radius: 8px;
          overflow: hidden;
        }
        
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.5rem 0.75rem;
          cursor: pointer;
          user-select: none;
        }
        
        .header:hover {
          background: rgba(59, 130, 246, 0.05);
        }
        
        .header-left {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        
        .icon {
          font-size: 1rem;
        }
        
        .header-title {
          font-size: 0.75rem;
          font-weight: 500;
          color: #94a3b8;
        }
        
        .toggle {
          font-size: 0.8rem;
          color: #64748b;
          transition: transform 0.2s ease;
        }
        
        .toggle.expanded {
          transform: rotate(180deg);
        }
        
        .content {
          padding: 0.75rem;
          border-top: 1px solid rgba(148, 163, 184, 0.1);
          display: ${this.isExpanded ? "block" : "none"};
        }
        
        .section {
          margin-bottom: 0.75rem;
        }
        
        .section:last-child {
          margin-bottom: 0;
        }
        
        .section-title {
          font-size: 0.7rem;
          font-weight: 600;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          margin-bottom: 0.35rem;
        }
        
        .purpose {
          font-size: 0.8rem;
          color: #e2e8f0;
          line-height: 1.5;
        }
        
        .list {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        
        .list li {
          font-size: 0.75rem;
          color: #94a3b8;
          padding-left: 1rem;
          position: relative;
          line-height: 1.6;
        }
        
        .list li::before {
          content: "→";
          position: absolute;
          left: 0;
          color: #4ade80;
        }
        
        .list.pitfalls li::before {
          content: "⚠";
          color: #fbbf24;
        }
        
        .interpretation {
          font-size: 0.75rem;
          color: #94a3b8;
          line-height: 1.6;
          font-style: italic;
          padding: 0.5rem;
          background: rgba(15, 23, 42, 0.4);
          border-radius: 4px;
          border-left: 2px solid rgba(59, 130, 246, 0.5);
        }
        
        .related {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }
        
        .related-tag {
          font-size: 0.65rem;
          padding: 0.15rem 0.4rem;
          background: rgba(59, 130, 246, 0.15);
          border: 1px solid rgba(59, 130, 246, 0.3);
          border-radius: 4px;
          color: #93c5fd;
        }
      </style>
      
      <div class="explainer">
        <div class="header" id="toggle-btn">
          <div class="header-left">
            <span class="icon">💡</span>
            <span class="header-title">What is this view for?</span>
          </div>
          <span class="toggle ${this.isExpanded ? "expanded" : ""}">▼</span>
        </div>
        
        <div class="content">
          <div class="section">
            <div class="section-title">Purpose</div>
            <p class="purpose">${explanation.purpose}</p>
          </div>
          
          <div class="section">
            <div class="section-title">What to Look For</div>
            <ul class="list">
              ${explanation.lookFor.map(item => `<li>${item}</li>`).join("")}
            </ul>
          </div>
          
          <div class="section">
            <div class="section-title">How to Interpret</div>
            <p class="interpretation">${explanation.interpretation}</p>
          </div>
          
          <div class="section">
            <div class="section-title">Common Pitfalls</div>
            <ul class="list pitfalls">
              ${explanation.pitfalls.map(item => `<li>${item}</li>`).join("")}
            </ul>
          </div>
          
          ${explanation.relatedViews ? `
            <div class="section">
              <div class="section-title">Related Views</div>
              <div class="related">
                ${explanation.relatedViews.map(v => `<span class="related-tag">${v}</span>`).join("")}
              </div>
            </div>
          ` : ""}
        </div>
      </div>
    `;

    this.shadow.getElementById("toggle-btn")?.addEventListener("click", () => this.toggle());
  }
}

customElements.define("view-explainer", ViewExplainer);
