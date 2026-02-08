/**
 * TorqueRankingTable - Percentile-based torque ranking
 * 
 * Shows rank percentiles instead of raw values to avoid scale distortion.
 * Columns: EPS acceleration, Margin Δ, Operating leverage, FCF snap-through, Composite Score
 */

import { fetchScreenData } from "../api/client";
import { getMetricTooltip, formatMetricName } from "../utils/metricTooltips";

export interface TorqueRankingConfig {
  title?: string;
  limit?: number;
  universe?: string[];
}

interface RankedCompany {
  ticker: string;
  price: number;
  // Raw values
  epsGrowth: number;
  marginDelta: number; // gross_margin as proxy
  opLeverage: number; // operating_margin
  fcfYield: number;
  revenueGrowth: number;
  // Percentiles (0-100)
  epsRank: number;
  marginRank: number;
  leverageRank: number;
  fcfRank: number;
  // Composite
  compositeScore: number;
  compositeRank: number;
}

export class TorqueRankingTable extends HTMLElement {
  private shadow: ShadowRoot;
  private config: TorqueRankingConfig = {};
  private data: RankedCompany[] = [];
  private sortColumn: keyof RankedCompany = "compositeRank";
  private sortAsc: boolean = true;

  static get observedAttributes() {
    return ["config"];
  }

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.render();
    this.fetchData();
  }

  attributeChangedCallback(name: string, _old: string, value: string) {
    if (name === "config" && value) {
      try {
        this.config = JSON.parse(value);
        this.fetchData();
      } catch (e) {
        console.error("Invalid config:", e);
      }
    }
  }

  private async fetchData() {
    try {
      const result = await fetchScreenData({
        filters: [],
        columns: [
          "ticker", "price", "eps_growth_yoy", "gross_margin", 
          "operating_margin", "fcf_yield", "revenue_growth_yoy"
        ],
        formulas: [],
        rank_by: "eps_growth_yoy",
        rank_order: "DESC",
        limit: this.config.limit || 50,
      });

      const rows = result.rows;
      
      // Calculate percentiles for each metric
      const calcPercentiles = (arr: number[]) => {
        const sorted = [...arr].sort((a, b) => a - b);
        return arr.map(v => {
          const idx = sorted.indexOf(v);
          return Math.round((idx / (sorted.length - 1)) * 100);
        });
      };

      const epsValues = rows.map((r: any) => r.eps_growth_yoy || 0);
      const marginValues = rows.map((r: any) => r.gross_margin || 0);
      const leverageValues = rows.map((r: any) => r.operating_margin || 0);
      const fcfValues = rows.map((r: any) => r.fcf_yield || 0);

      const epsPercentiles = calcPercentiles(epsValues);
      const marginPercentiles = calcPercentiles(marginValues);
      const leveragePercentiles = calcPercentiles(leverageValues);
      const fcfPercentiles = calcPercentiles(fcfValues);

      // Build ranked data
      this.data = rows.map((row: any, i: number) => {
        const epsRank = epsPercentiles[i];
        const marginRank = marginPercentiles[i];
        const leverageRank = leveragePercentiles[i];
        const fcfRank = fcfPercentiles[i];
        
        // Composite: weighted average (higher weight on EPS acceleration)
        const compositeScore = Math.round(
          epsRank * 0.35 + 
          marginRank * 0.25 + 
          leverageRank * 0.20 + 
          fcfRank * 0.20
        );

        return {
          ticker: row.ticker,
          price: row.price || 0,
          epsGrowth: row.eps_growth_yoy || 0,
          marginDelta: row.gross_margin || 0,
          opLeverage: row.operating_margin || 0,
          fcfYield: row.fcf_yield || 0,
          revenueGrowth: row.revenue_growth_yoy || 0,
          epsRank,
          marginRank,
          leverageRank,
          fcfRank,
          compositeScore,
          compositeRank: 0, // Will be set after sorting
        };
      });

      // Sort by composite and assign ranks
      this.data.sort((a, b) => b.compositeScore - a.compositeScore);
      this.data.forEach((d, i) => d.compositeRank = i + 1);

      this.renderTable();
    } catch (e) {
      console.error("Failed to fetch torque data:", e);
    }
  }

  private sortBy(column: keyof RankedCompany) {
    if (this.sortColumn === column) {
      this.sortAsc = !this.sortAsc;
    } else {
      this.sortColumn = column;
      this.sortAsc = column === "compositeRank" || column === "ticker";
    }

    this.data.sort((a, b) => {
      const av = a[column];
      const bv = b[column];
      if (typeof av === "string") {
        return this.sortAsc ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      }
      return this.sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });

    this.renderTable();
  }

  private getPercentileClass(pct: number): string {
    if (pct >= 80) return "rank-excellent";
    if (pct >= 60) return "rank-good";
    if (pct >= 40) return "rank-neutral";
    if (pct >= 20) return "rank-poor";
    return "rank-bad";
  }

  private renderTable() {
    const tbody = this.shadow.getElementById("table-body");
    if (!tbody) return;

    tbody.innerHTML = this.data.map(row => `
      <tr>
        <td class="rank-cell">${row.compositeRank}</td>
        <td class="ticker-cell"><span class="ticker-link" data-ticker="${row.ticker}">${row.ticker}</span></td>
        <td class="price-cell">$${row.price.toFixed(2)}</td>
        <td class="percentile-cell">
          <div class="percentile-bar ${this.getPercentileClass(row.epsRank)}">
            <span class="percentile-value">${row.epsRank}%</span>
            <div class="percentile-fill" style="width: ${row.epsRank}%"></div>
          </div>
          <span class="raw-value">${row.epsGrowth.toFixed(1)}%</span>
        </td>
        <td class="percentile-cell">
          <div class="percentile-bar ${this.getPercentileClass(row.marginRank)}">
            <span class="percentile-value">${row.marginRank}%</span>
            <div class="percentile-fill" style="width: ${row.marginRank}%"></div>
          </div>
          <span class="raw-value">${row.marginDelta.toFixed(1)}%</span>
        </td>
        <td class="percentile-cell">
          <div class="percentile-bar ${this.getPercentileClass(row.leverageRank)}">
            <span class="percentile-value">${row.leverageRank}%</span>
            <div class="percentile-fill" style="width: ${row.leverageRank}%"></div>
          </div>
          <span class="raw-value">${row.opLeverage.toFixed(1)}%</span>
        </td>
        <td class="percentile-cell">
          <div class="percentile-bar ${this.getPercentileClass(row.fcfRank)}">
            <span class="percentile-value">${row.fcfRank}%</span>
            <div class="percentile-fill" style="width: ${row.fcfRank}%"></div>
          </div>
          <span class="raw-value">${row.fcfYield.toFixed(1)}%</span>
        </td>
        <td class="composite-cell">
          <div class="composite-score ${this.getPercentileClass(row.compositeScore)}">
            ${row.compositeScore}
          </div>
        </td>
      </tr>
    `).join("");
    
    // Ticker click handlers
    this.shadow.querySelectorAll(".ticker-link").forEach(link => {
      link.addEventListener("click", (e) => {
        const ticker = (e.target as HTMLElement).getAttribute("data-ticker");
        if (ticker) {
          this.dispatchEvent(new CustomEvent("navigate-stock", {
            detail: { ticker },
            bubbles: true,
            composed: true,
          }));
        }
      });
    });
  }

  private render() {
    this.shadow.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: system-ui, -apple-system, sans-serif;
        }
        
        .container {
          background: rgba(15, 23, 42, 0.7);
          border: 1px solid rgba(148, 163, 184, 0.25);
          border-radius: 10px;
          overflow: hidden;
        }
        
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.75rem 1rem;
          background: rgba(15, 23, 42, 0.5);
          border-bottom: 1px solid rgba(148, 163, 184, 0.15);
        }
        
        .title {
          font-size: 0.9rem;
          font-weight: 600;
          color: #e2e8f0;
        }
        
        .subtitle {
          font-size: 0.7rem;
          color: #64748b;
        }
        
        .table-container {
          overflow-x: auto;
          max-height: 500px;
          overflow-y: auto;
        }
        
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.8rem;
        }
        
        th {
          position: sticky;
          top: 0;
          background: rgba(15, 23, 42, 0.98);
          padding: 0.6rem 0.5rem;
          text-align: left;
          font-weight: 600;
          color: #64748b;
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          cursor: pointer;
          user-select: none;
          border-bottom: 1px solid rgba(148, 163, 184, 0.2);
        }
        
        th:hover {
          color: #e2e8f0;
        }
        
        th .sort-arrow {
          margin-left: 0.25rem;
          opacity: 0.5;
        }
        
        td {
          padding: 0.5rem;
          border-bottom: 1px solid rgba(148, 163, 184, 0.08);
          color: #e2e8f0;
        }
        
        tr:hover td {
          background: rgba(59, 130, 246, 0.05);
        }
        
        .rank-cell {
          font-weight: 700;
          font-size: 0.85rem;
          color: #94a3b8;
          width: 40px;
          text-align: center;
        }
        
        .ticker-cell {
          font-weight: 600;
          color: #e2e8f0;
        }
        
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
        
        .price-cell {
          font-family: 'SF Mono', monospace;
          font-size: 0.75rem;
          color: #94a3b8;
        }
        
        .percentile-cell {
          width: 120px;
        }
        
        .percentile-bar {
          position: relative;
          height: 18px;
          background: rgba(30, 41, 59, 0.6);
          border-radius: 4px;
          overflow: hidden;
        }
        
        .percentile-fill {
          position: absolute;
          left: 0;
          top: 0;
          height: 100%;
          border-radius: 4px;
          transition: width 0.3s ease;
        }
        
        .rank-excellent .percentile-fill { background: rgba(74, 222, 128, 0.4); }
        .rank-good .percentile-fill { background: rgba(163, 230, 53, 0.4); }
        .rank-neutral .percentile-fill { background: rgba(251, 191, 36, 0.3); }
        .rank-poor .percentile-fill { background: rgba(251, 146, 60, 0.3); }
        .rank-bad .percentile-fill { background: rgba(248, 113, 113, 0.3); }
        
        .percentile-value {
          position: absolute;
          left: 6px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 0.7rem;
          font-weight: 600;
          color: #e2e8f0;
          z-index: 1;
        }
        
        .raw-value {
          display: block;
          font-size: 0.65rem;
          color: #64748b;
          margin-top: 2px;
          text-align: center;
        }
        
        .composite-cell {
          text-align: center;
        }
        
        .composite-score {
          display: inline-block;
          padding: 0.3rem 0.6rem;
          border-radius: 6px;
          font-weight: 700;
          font-size: 0.85rem;
        }
        
        .composite-score.rank-excellent {
          background: rgba(74, 222, 128, 0.2);
          color: #4ade80;
        }
        .composite-score.rank-good {
          background: rgba(163, 230, 53, 0.2);
          color: #a3e635;
        }
        .composite-score.rank-neutral {
          background: rgba(251, 191, 36, 0.2);
          color: #fbbf24;
        }
        .composite-score.rank-poor {
          background: rgba(251, 146, 60, 0.2);
          color: #fb923c;
        }
        .composite-score.rank-bad {
          background: rgba(248, 113, 113, 0.2);
          color: #f87171;
        }
        
        .formula-hint {
          padding: 0.5rem 1rem;
          background: rgba(30, 41, 59, 0.4);
          border-top: 1px solid rgba(148, 163, 184, 0.1);
          font-size: 0.65rem;
          color: #64748b;
        }
      </style>
      
      <div class="container">
        <div class="header">
          <div>
            <span class="title">${this.config.title || "Torque Ranking Table"}</span>
            <span class="subtitle">Percentile ranks across torque dimensions</span>
          </div>
        </div>
        
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Ticker</th>
                <th>Price</th>
                <th>EPS Accel <span class="sort-arrow">↓</span></th>
                <th>Margin <span class="sort-arrow">↓</span></th>
                <th>Op Leverage <span class="sort-arrow">↓</span></th>
                <th>FCF Yield <span class="sort-arrow">↓</span></th>
                <th>Composite</th>
              </tr>
            </thead>
            <tbody id="table-body">
              <tr><td colspan="8" style="text-align: center; color: #64748b; padding: 2rem;">Loading...</td></tr>
            </tbody>
          </table>
        </div>
        
        <div class="formula-hint">
          <strong>Composite Score:</strong> EPS Accel (35%) + Margin (25%) + Op Leverage (20%) + FCF Yield (20%)
        </div>
      </div>
    `;

    // Add click handlers for sorting
    const headers = this.shadow.querySelectorAll("th");
    const columns: (keyof RankedCompany)[] = ["compositeRank", "ticker", "price", "epsRank", "marginRank", "leverageRank", "fcfRank", "compositeScore"];
    headers.forEach((th, i) => {
      th.addEventListener("click", () => this.sortBy(columns[i]));
    });
  }
}

customElements.define("torque-ranking-table", TorqueRankingTable);
