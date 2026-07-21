/**
 * ViewInsights - Generate narrative insights from chart/view data
 * 
 * Analyzes the data in a view and produces:
 * - Key observations
 * - Statistical highlights
 * - Actionable takeaways
 * - Risk callouts
 * 
 * Each view type gets view-specific data fetching AND analysis logic
 * so insights are always relevant to the paired visualization.
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
      const viewType = this.config.viewType || "screener";
      const viewConfig = this.getViewFetchConfig(viewType);

      // Fetch data tailored to this view type
      const result = await fetchScreenData({
        filters: viewConfig.filters,
        columns: viewConfig.columns,
        formulas: viewConfig.formulas || [],
        rank_by: viewConfig.rank_by,
        rank_order: viewConfig.rank_order || "DESC",
        limit: this.config.limit || 30,
      });

      this.insights = this.analyzeDataForView(result.rows, viewType);
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

  /** Return view-specific fetch configuration so insights are relevant to the paired visualization. */
  private getViewFetchConfig(viewType: string): {
    filters: any[]; columns: string[]; formulas?: string[]; rank_by: string; rank_order: "ASC" | "DESC";
  } {
    switch (viewType) {
      case "greenblatt":
        return {
          filters: [],
          columns: ["ticker", "price", "pe_ratio", "ev_to_fcf", "eps_growth_yoy", "gross_margin",
            "operating_margin", "fcf_yield", "revenue_growth_yoy", "debt_to_equity",
            "ebit", "enterprise_value", "net_working_capital"],
          rank_by: "fcf_yield",
          rank_order: "DESC",
        };
      case "torque":
        return {
          filters: [{ field: "eps_growth_yoy", op: ">", value: 5 }],
          columns: ["ticker", "price", "pe_ratio", "ev_to_fcf", "eps_growth_yoy", "revenue_growth_yoy",
            "gross_margin", "fcf_yield", "debt_to_equity"],
          rank_by: "eps_growth_yoy",
          rank_order: "DESC",
        };
      case "value_compression":
        return {
          filters: [{ field: "gross_margin", op: ">", value: 20 }],
          columns: ["ticker", "price", "pe_ratio", "ev_to_fcf", "pb_ratio", "fcf_yield",
            "gross_margin", "operating_margin", "debt_to_equity", "dividend_yield"],
          rank_by: "fcf_yield",
          rank_order: "DESC",
        };
      case "vrr":
        return {
          filters: [{ field: "fcf_yield", op: ">", value: 1 }],
          columns: ["ticker", "price", "pe_ratio", "pb_ratio", "fcf_yield",
            "debt_to_equity", "interest_coverage", "eps_growth_yoy", "dividend_yield"],
          rank_by: "fcf_yield",
          rank_order: "DESC",
        };
      case "compounding_discount":
        return {
          filters: [{ field: "pb_ratio", op: ">", value: 0 }, { field: "pb_ratio", op: "<", value: 3 }],
          columns: ["ticker", "price", "pb_ratio", "pe_ratio", "ev_to_fcf", "eps_growth_yoy",
            "book_value_per_share", "payout_ratio", "dividend_yield"],
          rank_by: "eps_growth_yoy",
          rank_order: "DESC",
        };
      case "compounders":
        return {
          filters: [{ field: "gross_margin", op: ">", value: 30 }],
          columns: ["ticker", "price", "pe_ratio", "ev_to_fcf", "gross_margin", "operating_margin",
            "revenue_growth_yoy", "eps_growth_yoy", "fcf_yield", "debt_to_equity"],
          rank_by: "gross_margin",
          rank_order: "DESC",
        };
      case "qarp":
        return {
          filters: [
            { field: "gross_margin", op: ">", value: 35 },
            { field: "pe_ratio", op: "<", value: 30 },
            { field: "pe_ratio", op: ">", value: 5 },
          ],
          columns: ["ticker", "price", "pe_ratio", "ev_to_fcf", "gross_margin", "operating_margin",
            "fcf_yield", "debt_to_equity", "eps_growth_yoy"],
          rank_by: "fcf_yield",
          rank_order: "DESC",
        };
      case "turnarounds":
        return {
          filters: [],
          columns: ["ticker", "price", "pe_ratio", "ev_to_fcf", "eps_growth_yoy", "revenue_growth_yoy",
            "gross_margin", "fcf_yield", "debt_to_equity"],
          rank_by: "eps_growth_yoy",
          rank_order: "DESC",
        };
      case "rerating":
        return {
          filters: [{ field: "pe_ratio", op: ">", value: 0 }, { field: "pe_ratio", op: "<", value: 50 }],
          columns: ["ticker", "price", "pe_ratio", "ev_to_fcf", "gross_margin", "operating_margin",
            "revenue_growth_yoy", "eps_growth_yoy", "fcf_yield"],
          rank_by: "gross_margin",
          rank_order: "DESC",
        };
      case "antifragile":
        return {
          filters: [{ field: "debt_to_equity", op: "<", value: 1 }, { field: "free_cash_flow", op: ">", value: 0 }],
          columns: ["ticker", "price", "pe_ratio", "ev_to_fcf", "debt_to_equity", "free_cash_flow",
            "interest_coverage", "fcf_yield", "gross_margin", "operating_margin"],
          rank_by: "interest_coverage",
          rank_order: "DESC",
        };
      case "structural_winners":
        return {
          filters: [{ field: "revenue_growth_yoy", op: ">", value: 5 }],
          columns: ["ticker", "price", "pe_ratio", "ev_to_fcf", "revenue_growth_yoy", "eps_growth_yoy",
            "gross_margin", "fcf_yield", "debt_to_equity"],
          rank_by: "revenue_growth_yoy",
          rank_order: "DESC",
        };
      case "capital_allocators":
        return {
          filters: [{ field: "free_cash_flow", op: ">", value: 0 }],
          columns: ["ticker", "price", "pe_ratio", "ev_to_fcf", "fcf_yield", "free_cash_flow",
            "dividend_yield", "payout_ratio", "debt_to_equity"],
          rank_by: "fcf_yield",
          rank_order: "DESC",
        };
      // Default: generic screener
      default:
        return {
          filters: [],
          columns: [
            "ticker", "price", "pe_ratio", "ev_to_fcf", "eps_growth_yoy", "gross_margin",
            "operating_margin", "fcf_yield", "revenue_growth_yoy", "debt_to_equity"
          ],
          rank_by: "eps_growth_yoy",
          rank_order: "DESC",
        };
    }
  }

  /** Analyze data with view-specific logic. Falls through to generic analysis for unknown view types. */
  private analyzeDataForView(rows: any[], viewType: string): Insight[] {
    switch (viewType) {
      case "greenblatt":
        return this.analyzeGreenblatt(rows);
      case "torque":
        return this.analyzeTorque(rows);
      case "value_compression":
        return this.analyzeValueCompression(rows);
      case "vrr":
        return this.analyzeVRR(rows);
      case "compounding_discount":
        return this.analyzeCompoundingDiscount(rows);
      case "compounders":
        return this.analyzeCompounders(rows);
      case "qarp":
        return this.analyzeQARP(rows);
      case "turnarounds":
        return this.analyzeTurnarounds(rows);
      case "rerating":
        return this.analyzeRerating(rows);
      case "antifragile":
        return this.analyzeAntifragile(rows);
      case "structural_winners":
        return this.analyzeStructuralWinners(rows);
      case "capital_allocators":
        return this.analyzeCapitalAllocators(rows);
      default:
        return this.analyzeData(rows);
    }
  }

  // ── View-specific analysis methods ──────────────────────────────────────

  /** Greenblatt view: focus on earnings yield and return on capital. */
  private analyzeGreenblatt(rows: any[]): Insight[] {
    const insights: Insight[] = [];
    if (!rows.length) return this.noDataInsight();

    const eyValues = rows.map(r => r.enterprise_value > 0 && r.ebit ? r.ebit / r.enterprise_value : null).filter(v => v !== null) as number[];
    const avgEY = eyValues.length ? eyValues.reduce((a, b) => a + b, 0) / eyValues.length : 0;
    const highEY = rows.filter(r => r.enterprise_value > 0 && r.ebit && (r.ebit / r.enterprise_value) > 0.08);
    const cheapFcf = rows.filter(r => (r.fcf_yield || 0) > 5);
    const profitable = rows.filter(r => (r.operating_margin || 0) > 15);

    if (avgEY > 0) {
      insights.push({ type: "observation", icon: "📊", text: `Average earnings yield across ranked stocks: ${(avgEY * 100).toFixed(1)}%. ${highEY.length} stocks yield above 8% — strong value signal.`, importance: "high" });
    }
    if (cheapFcf.length > 0) {
      const tickers = cheapFcf.slice(0, 3).map(r => r.ticker).join(", ");
      insights.push({ type: "highlight", icon: "💰", text: `${cheapFcf.length} stocks with FCF yield >5%: ${tickers}. These generate cash above their cost of capital.`, importance: "high" });
    }
    if (profitable.length > 0) {
      insights.push({ type: "observation", icon: "✨", text: `${profitable.length} stocks have operating margins >15%, indicating durable competitive advantages.`, importance: "medium" });
    }
    if (highEY.length > 0 && profitable.length > 0) {
      const overlap = highEY.filter(h => profitable.some(p => p.ticker === h.ticker));
      if (overlap.length > 0) {
        insights.push({ type: "action", icon: "💡", text: `${overlap.length} stocks combine high earnings yield with strong margins: ${overlap.slice(0, 3).map(r => r.ticker).join(", ")}. Best Greenblatt candidates.`, importance: "high" });
      }
    }
    return insights;
  }

  /** Torque view: focus on growth vs. valuation. */
  private analyzeTorque(rows: any[]): Insight[] {
    const insights: Insight[] = [];
    if (!rows.length) return this.noDataInsight();

    const avgGrowth = this.avg(rows, "eps_growth_yoy");
    const avgPE = this.avgFiltered(rows, "pe_ratio", v => v > 0);
    const torqueCandidates = rows.filter(r => (r.eps_growth_yoy || 0) > 15 && (r.pe_ratio || 999) < 25 && (r.pe_ratio || 0) > 0);
    const highRevGrowth = rows.filter(r => (r.revenue_growth_yoy || 0) > 10);

    if (avgGrowth > 10) {
      insights.push({ type: "observation", icon: "📈", text: `Strong earnings momentum: average EPS growth ${avgGrowth.toFixed(1)}%. ${rows.filter(r => (r.eps_growth_yoy || 0) > 20).length} stocks above 20% growth.`, importance: "high" });
    }
    if (torqueCandidates.length > 0) {
      const tickers = torqueCandidates.slice(0, 3).map(r => r.ticker).join(", ");
      insights.push({ type: "highlight", icon: "🎯", text: `${torqueCandidates.length} torque candidates (EPS growth >15%, P/E <25): ${tickers}. Growth at reasonable price.`, importance: "high" });
    }
    if (avgPE > 0) {
      insights.push({ type: "observation", icon: "💰", text: `Average P/E for growth universe: ${avgPE.toFixed(1)}x. ${rows.filter(r => (r.pe_ratio || 999) < 20 && (r.pe_ratio || 0) > 0).length} stocks under 20x.`, importance: "medium" });
    }
    if (highRevGrowth.length > 0) {
      insights.push({ type: "highlight", icon: "🚀", text: `${highRevGrowth.length} stocks with revenue growth >10%, confirming top-line momentum behind earnings.`, importance: "medium" });
    }
    return insights;
  }

  /** Value Compression view: focus on stability and valuation discounts. */
  private analyzeValueCompression(rows: any[]): Insight[] {
    const insights: Insight[] = [];
    if (!rows.length) return this.noDataInsight();

    const stable = rows.filter(r => (r.gross_margin || 0) > 40 && (r.operating_margin || 0) > 15);
    const cheapPE = rows.filter(r => (r.pe_ratio || 999) < 15 && (r.pe_ratio || 0) > 0);
    const cheapPB = rows.filter(r => (r.pb_ratio || 999) < 1.5 && (r.pb_ratio || 0) > 0);
    const fcfPositive = rows.filter(r => (r.fcf_yield || 0) > 2);

    if (stable.length > 0) {
      insights.push({ type: "observation", icon: "🛡️", text: `${stable.length} stocks show operational stability (gross margin >40%, operating margin >15%). These form the quality backbone.`, importance: "high" });
    }
    if (cheapPE.length > 0 && cheapPB.length > 0) {
      const overlap = cheapPE.filter(p => cheapPB.some(b => b.ticker === p.ticker));
      insights.push({ type: "highlight", icon: "💎", text: `${overlap.length || cheapPE.length + cheapPB.length} stocks trade at compressed valuations (low P/E or P/B). Deep value territory.`, importance: "high" });
    }
    if (fcfPositive.length > 0) {
      insights.push({ type: "highlight", icon: "💰", text: `${fcfPositive.length} stocks generate FCF yield >2%, providing shareholder return capacity.`, importance: "medium" });
    }
    if (stable.length > 0 && fcfPositive.length > 0) {
      const overlap = stable.filter(s => fcfPositive.some(f => f.ticker === s.ticker));
      if (overlap.length > 0) {
        insights.push({ type: "action", icon: "💡", text: `${overlap.length} stocks in the target zone (stable + cash-generating): ${overlap.slice(0, 3).map(r => r.ticker).join(", ")}. These merit immediate analysis.`, importance: "high" });
      }
    }
    return insights;
  }

  /** VRR view: focus on value realization velocity and action recommendations. */
  private analyzeVRR(rows: any[]): Insight[] {
    const insights: Insight[] = [];
    if (!rows.length) return this.noDataInsight();

    const safeBalance = rows.filter(r => (r.debt_to_equity || 0) < 1 && (r.interest_coverage || 0) > 5);
    const cashCows = rows.filter(r => (r.fcf_yield || 0) > 4);
    const growing = rows.filter(r => (r.eps_growth_yoy || 0) > 5);
    const dividendPayers = rows.filter(r => (r.dividend_yield || 0) > 1.5);

    if (safeBalance.length > 0) {
      insights.push({ type: "observation", icon: "🛡️", text: `${safeBalance.length} stocks have D/E <1x and interest coverage >5x. Balance sheets can withstand stress.`, importance: "high" });
    }
    if (cashCows.length > 0) {
      insights.push({ type: "highlight", icon: "💰", text: `${cashCows.length} stocks with FCF yield >4%. Cash generation supports dividends, buybacks, and deleveraging.`, importance: "high" });
    }
    if (growing.length > 0) {
      insights.push({ type: "observation", icon: "📈", text: `${growing.length} stocks growing EPS >5% YoY. Thesis velocity is positive.`, importance: "medium" });
    }
    if (cashCows.length > 0 && growing.length > 0) {
      const overlap = cashCows.filter(c => growing.some(g => g.ticker === c.ticker));
      if (overlap.length > 0) {
        insights.push({ type: "action", icon: "💡", text: `${overlap.length} stocks combine cash generation with growth (add candidates): ${overlap.slice(0, 3).map(r => r.ticker).join(", ")}.`, importance: "high" });
      }
    }
    if (dividendPayers.length > 0) {
      insights.push({ type: "highlight", icon: "💵", text: `${dividendPayers.length} stocks yield >1.5%, providing income while the value thesis plays out.`, importance: "medium" });
    }
    return insights;
  }

  /** Compounding Discount view: focus on BVPS growth vs P/B discount. */
  private analyzeCompoundingDiscount(rows: any[]): Insight[] {
    const insights: Insight[] = [];
    if (!rows.length) return this.noDataInsight();

    const lowPB = rows.filter(r => (r.pb_ratio || 0) > 0 && (r.pb_ratio || 0) < 1.5);
    const growing = rows.filter(r => (r.eps_growth_yoy || 0) > 8);
    const dividendGrowers = rows.filter(r => (r.dividend_yield || 0) > 1 && (r.payout_ratio || 100) < 70);

    if (lowPB.length > 0) {
      insights.push({ type: "observation", icon: "📉", text: `${lowPB.length} stocks trade below 1.5x book value. Potential Getty Oil-type discounts where BVPS compounds faster than price.`, importance: "high" });
    }
    if (growing.length > 0) {
      insights.push({ type: "highlight", icon: "📈", text: `${growing.length} stocks compounding EPS >8% annually. Book value should follow earnings upward.`, importance: "high" });
    }
    if (lowPB.length > 0 && growing.length > 0) {
      const overlap = lowPB.filter(l => growing.some(g => g.ticker === l.ticker));
      if (overlap.length > 0) {
        insights.push({ type: "action", icon: "💡", text: `${overlap.length} opportunity zone stocks (compounding + discounted): ${overlap.slice(0, 3).map(r => r.ticker).join(", ")}. Highest conviction longs.`, importance: "high" });
      }
    }
    if (dividendGrowers.length > 0) {
      insights.push({ type: "highlight", icon: "💵", text: `${dividendGrowers.length} stocks yield >1% with <70% payout — reinvesting majority of earnings for compounding.`, importance: "medium" });
    }
    return insights;
  }

  /** Compounders archetype: high-margin moat businesses. */
  private analyzeCompounders(rows: any[]): Insight[] {
    const insights: Insight[] = [];
    if (!rows.length) return this.noDataInsight();

    const wideMoat = rows.filter(r => (r.gross_margin || 0) > 60);
    const consistent = rows.filter(r => (r.operating_margin || 0) > 25 && (r.revenue_growth_yoy || 0) > 5);
    const cashRich = rows.filter(r => (r.fcf_yield || 0) > 3 && (r.debt_to_equity || 0) < 0.5);

    insights.push({ type: "observation", icon: "🏰", text: `Screened for gross margin >30%. ${rows.length} compounders identified with durable pricing power.`, importance: "high" });
    if (wideMoat.length > 0) {
      insights.push({ type: "highlight", icon: "✨", text: `${wideMoat.length} stocks with gross margin >60% — wide moat territory: ${wideMoat.slice(0, 3).map(r => r.ticker).join(", ")}.`, importance: "high" });
    }
    if (consistent.length > 0) {
      insights.push({ type: "highlight", icon: "📈", text: `${consistent.length} stocks combine high operating margins (>25%) with steady revenue growth (>5%).`, importance: "medium" });
    }
    if (cashRich.length > 0) {
      insights.push({ type: "observation", icon: "💰", text: `${cashRich.length} stocks generate FCF yield >3% with low leverage — self-funding growth engines.`, importance: "medium" });
    }
    return insights;
  }

  /** QARP archetype: quality at a reasonable price. */
  private analyzeQARP(rows: any[]): Insight[] {
    const insights: Insight[] = [];
    if (!rows.length) return this.noDataInsight();

    const qualityCheap = rows.filter(r => (r.gross_margin || 0) > 50 && (r.pe_ratio || 999) < 15 && (r.pe_ratio || 0) > 0);
    const fcfYielders = rows.filter(r => (r.fcf_yield || 0) > 4);
    const lowDebt = rows.filter(r => (r.debt_to_equity || 0) < 0.7);

    insights.push({ type: "observation", icon: "⚖️", text: `Screened for margin >35%, P/E 5–30x. ${rows.length} QARP candidates balancing quality and value.`, importance: "high" });
    if (qualityCheap.length > 0) {
      insights.push({ type: "highlight", icon: "💎", text: `${qualityCheap.length} stocks with margin >50% and P/E <15: ${qualityCheap.slice(0, 3).map(r => r.ticker).join(", ")}. Best quality-value overlap.`, importance: "high" });
    }
    if (fcfYielders.length > 0) {
      insights.push({ type: "highlight", icon: "💰", text: `${fcfYielders.length} stocks generate FCF yield >4%, adding cash flow discipline to quality screens.`, importance: "medium" });
    }
    if (lowDebt.length > 0) {
      insights.push({ type: "observation", icon: "🛡️", text: `${lowDebt.length} stocks carry D/E <0.7x — balance sheet quality matches earnings quality.`, importance: "medium" });
    }
    return insights;
  }

  /** Turnarounds archetype: highest EPS growth potential. */
  private analyzeTurnarounds(rows: any[]): Insight[] {
    const insights: Insight[] = [];
    if (!rows.length) return this.noDataInsight();

    const exploding = rows.filter(r => (r.eps_growth_yoy || 0) > 50);
    const recovering = rows.filter(r => (r.eps_growth_yoy || 0) > 15 && (r.eps_growth_yoy || 0) <= 50);
    const marginImproving = rows.filter(r => (r.gross_margin || 0) > 20 && (r.operating_margin || 0) > 5);

    if (exploding.length > 0) {
      insights.push({ type: "highlight", icon: "🚀", text: `${exploding.length} stocks with EPS growth >50%: ${exploding.slice(0, 3).map(r => r.ticker).join(", ")}. Potential inflection points.`, importance: "high" });
    }
    if (recovering.length > 0) {
      insights.push({ type: "observation", icon: "📈", text: `${recovering.length} stocks growing EPS 15–50%. These may be early-stage turnarounds with more room to run.`, importance: "high" });
    }
    if (marginImproving.length > 0) {
      insights.push({ type: "highlight", icon: "✨", text: `${marginImproving.length} stocks show margin recovery (gross >20%, operating >5%), confirming operational turnaround.`, importance: "medium" });
    }
    const highDebt = rows.filter(r => (r.debt_to_equity || 0) > 2);
    if (highDebt.length > 0) {
      insights.push({ type: "risk", icon: "⚠️", text: `${highDebt.length} turnaround candidates carry D/E >2x. Earnings recovery must service debt — verify cash flow sustainability.`, importance: "high" });
    }
    return insights;
  }

  /** Re-Rating archetype: margin expansion catalysts. */
  private analyzeRerating(rows: any[]): Insight[] {
    const insights: Insight[] = [];
    if (!rows.length) return this.noDataInsight();

    const highMargin = rows.filter(r => (r.gross_margin || 0) > 50);
    const growing = rows.filter(r => (r.revenue_growth_yoy || 0) > 8);
    const reasonablePE = rows.filter(r => (r.pe_ratio || 0) > 0 && (r.pe_ratio || 999) < 25);

    insights.push({ type: "observation", icon: "📊", text: `Screened for P/E 0–50x, ranked by gross margin. ${rows.length} re-rating candidates where margin expansion could unlock multiple expansion.`, importance: "high" });
    if (highMargin.length > 0) {
      insights.push({ type: "highlight", icon: "✨", text: `${highMargin.length} stocks with gross margin >50%: ${highMargin.slice(0, 3).map(r => r.ticker).join(", ")}. High margins attract re-rating as market recognizes durability.`, importance: "high" });
    }
    if (growing.length > 0) {
      insights.push({ type: "highlight", icon: "📈", text: `${growing.length} stocks growing revenue >8%. Top-line growth validates margin expansion narrative.`, importance: "medium" });
    }
    if (reasonablePE.length > 0) {
      insights.push({ type: "observation", icon: "💰", text: `${reasonablePE.length} stocks trade under 25x earnings — re-rating has room before becoming expensive.`, importance: "medium" });
    }
    return insights;
  }

  /** Antifragile archetype: low leverage, positive FCF. */
  private analyzeAntifragile(rows: any[]): Insight[] {
    const insights: Insight[] = [];
    if (!rows.length) return this.noDataInsight();

    const strongCoverage = rows.filter(r => (r.interest_coverage || 0) > 10);
    const cashFlowPositive = rows.filter(r => (r.free_cash_flow || 0) > 0 && (r.fcf_yield || 0) > 2);
    const lowDebt = rows.filter(r => (r.debt_to_equity || 0) < 0.3);
    const profitable = rows.filter(r => (r.operating_margin || 0) > 15);

    insights.push({ type: "observation", icon: "🛡️", text: `Screened for D/E <1x, FCF >0. ${rows.length} antifragile candidates built to withstand stress.`, importance: "high" });
    if (strongCoverage.length > 0) {
      insights.push({ type: "highlight", icon: "🏰", text: `${strongCoverage.length} stocks with interest coverage >10x: ${strongCoverage.slice(0, 3).map(r => r.ticker).join(", ")}. Debt service is trivial.`, importance: "high" });
    }
    if (cashFlowPositive.length > 0) {
      insights.push({ type: "highlight", icon: "💰", text: `${cashFlowPositive.length} stocks generate positive FCF with yield >2%. Self-sustaining regardless of external financing.`, importance: "medium" });
    }
    if (lowDebt.length > 0) {
      insights.push({ type: "observation", icon: "✨", text: `${lowDebt.length} stocks carry D/E <0.3x — near-zero leverage. Maximum financial resilience.`, importance: "medium" });
    }
    if (profitable.length > 0 && lowDebt.length > 0) {
      const overlap = profitable.filter(p => lowDebt.some(l => l.ticker === p.ticker));
      if (overlap.length > 0) {
        insights.push({ type: "action", icon: "💡", text: `${overlap.length} fortress stocks (profitable + near-zero debt): ${overlap.slice(0, 3).map(r => r.ticker).join(", ")}. Core portfolio anchors.`, importance: "high" });
      }
    }
    return insights;
  }

  /** Structural Winners archetype: revenue growth leaders. */
  private analyzeStructuralWinners(rows: any[]): Insight[] {
    const insights: Insight[] = [];
    if (!rows.length) return this.noDataInsight();

    const hypergrowth = rows.filter(r => (r.revenue_growth_yoy || 0) > 20);
    const profitable = rows.filter(r => (r.gross_margin || 0) > 40 && (r.operating_margin || 0) > 10);

    insights.push({ type: "observation", icon: "🚀", text: `Screened for revenue growth >5%. ${rows.length} structural winners riding secular tailwinds.`, importance: "high" });
    if (hypergrowth.length > 0) {
      insights.push({ type: "highlight", icon: "📈", text: `${hypergrowth.length} stocks with revenue growth >20%: ${hypergrowth.slice(0, 3).map(r => r.ticker).join(", ")}. Secular demand drivers in play.`, importance: "high" });
    }
    if (profitable.length > 0) {
      insights.push({ type: "highlight", icon: "✨", text: `${profitable.length} stocks convert growth into profit (margin >40% gross, >10% operating). Growth with unit economics.`, importance: "medium" });
    }
    const expensive = rows.filter(r => (r.pe_ratio || 0) > 50);
    if (expensive.length > 0) {
      insights.push({ type: "risk", icon: "⚠️", text: `${expensive.length} stocks trade above 50x earnings — high expectations priced in. Any growth deceleration risks sharp de-rating.`, importance: "high" });
    }
    return insights;
  }

  /** Capital Allocators archetype: FCF-focused with shareholder returns. */
  private analyzeCapitalAllocators(rows: any[]): Insight[] {
    const insights: Insight[] = [];
    if (!rows.length) return this.noDataInsight();

    const highFCF = rows.filter(r => (r.fcf_yield || 0) > 5);
    const dividendChampions = rows.filter(r => (r.dividend_yield || 0) > 2 && (r.payout_ratio || 100) < 60);
    const delevraged = rows.filter(r => (r.debt_to_equity || 0) < 0.5);
    const buybackCandidates = rows.filter(r => (r.fcf_yield || 0) > 3 && (r.payout_ratio || 100) < 40);

    insights.push({ type: "observation", icon: "💵", text: `Screened for FCF >0, ranked by FCF yield. ${rows.length} capital allocators with cash to deploy.`, importance: "high" });
    if (highFCF.length > 0) {
      insights.push({ type: "highlight", icon: "💰", text: `${highFCF.length} stocks generate FCF yield >5%: ${highFCF.slice(0, 3).map(r => r.ticker).join(", ")}. Substantial free cash flow relative to market cap.`, importance: "high" });
    }
    if (dividendChampions.length > 0) {
      insights.push({ type: "highlight", icon: "🏆", text: `${dividendChampions.length} stocks yield >2% with <60% payout — growing dividends with room to increase.`, importance: "medium" });
    }
    if (buybackCandidates.length > 0) {
      insights.push({ type: "observation", icon: "🔄", text: `${buybackCandidates.length} stocks have FCF yield >3% and <40% payout — excess cash likely funding buybacks.`, importance: "medium" });
    }
    if (delevraged.length > 0 && highFCF.length > 0) {
      const overlap = delevraged.filter(d => highFCF.some(h => h.ticker === d.ticker));
      if (overlap.length > 0) {
        insights.push({ type: "action", icon: "💡", text: `${overlap.length} fortress allocators (low debt + high FCF): ${overlap.slice(0, 3).map(r => r.ticker).join(", ")}. Maximum shareholder optionality.`, importance: "high" });
      }
    }
    return insights;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private noDataInsight(): Insight[] {
    return [{ type: "observation", icon: "📭", text: "No data available for analysis.", importance: "low" }];
  }

  private avg(rows: any[], field: string): number {
    const vals = rows.map(r => r[field] || 0).filter(v => !isNaN(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }

  private avgFiltered(rows: any[], field: string, pred: (v: number) => boolean): number {
    const vals = rows.map(r => r[field] || 0).filter(v => !isNaN(v) && pred(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }

  /** Generic fallback analysis for unknown view types. */
  private analyzeData(rows: any[]): Insight[] {
    const insights: Insight[] = [];
    
    if (rows.length === 0) {
      return this.noDataInsight();
    }

    // Statistical calculations
    const epsGrowthValues = rows.map(r => r.eps_growth_yoy || 0).filter(v => !isNaN(v));
    const peValues = rows.map(r => r.pe_ratio || 0).filter(v => !isNaN(v) && v > 0);
    const marginValues = rows.map(r => r.gross_margin || 0).filter(v => !isNaN(v));

    const avgEpsGrowth = epsGrowthValues.length ? epsGrowthValues.reduce((a, b) => a + b, 0) / epsGrowthValues.length : 0;
    const avgPE = peValues.length ? peValues.reduce((a, b) => a + b, 0) / peValues.length : 0;

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

    if (torqueCandidates.length > 0) {
      const tickers = torqueCandidates.slice(0, 3).map(r => r.ticker).join(", ");
      insights.push({
        type: "highlight",
        icon: "🎯",
        text: `${torqueCandidates.length} torque candidates identified with EPS growth >15% and P/E <20. Top picks: ${tickers}`,
        importance: "high",
      });
    }

    if (avgPE > 0) {
      const valLabel = avgPE > 25 ? "elevated" : avgPE < 15 ? "attractive" : "fair";
      insights.push({
        type: "observation",
        icon: "💰",
        text: `Valuation appears ${valLabel}: Universe P/E averages ${avgPE.toFixed(1)}x. ${cheapStocks.length} stocks trading under 15x earnings.`,
        importance: "medium",
      });
    }

    if (highMargin.length > 0) {
      const pct = Math.round((highMargin.length / rows.length) * 100);
      insights.push({
        type: "highlight",
        icon: "✨",
        text: `${pct}% of universe (${highMargin.length} stocks) have gross margins above 50%, suggesting pricing power and moat characteristics.`,
        importance: "medium",
      });
    }

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
