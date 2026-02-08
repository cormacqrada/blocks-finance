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
