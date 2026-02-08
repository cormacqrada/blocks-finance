/**
 * InsiderActivityPanel - Insider Trading Activity
 * 
 * Shows recent insider transactions from SEC Form 4 filings:
 * - Buys (bullish signal from insiders)
 * - Sells (may or may not be bearish - often for diversification)
 * - Net sentiment indicator
 * 
 * Can filter by specific ticker or show all activity
 */

const API_BASE = (window as any).VITE_API_URL || "http://localhost:8000";

interface InsiderTransaction {
  filing_date: string;
  trade_date: string;
  insider_name: string;
  insider_title: string;
  transaction_type: string;
  shares: number;
  price: number;
  value: number;
}

export class InsiderActivityPanel extends HTMLElement {
  private ticker: string | null = null;
  private data: InsiderTransaction[] = [];
  private isLoading = false;

  static get observedAttributes() {
    return ["ticker"];
  }

  connectedCallback() {
    this.ticker = this.getAttribute("ticker");
    this.render();
    if (this.ticker) {
      this.loadData();
    }
  }

  attributeChangedCallback(name: string, _old: string, value: string) {
    if (name === "ticker" && value) {
      this.ticker = value.toUpperCase();
      this.loadData();
    }
  }

  private async loadData() {
    if (!this.ticker) return;

    this.isLoading = true;
    this.render();

    try {
      const resp = await fetch(`${API_BASE}/api/insider_transactions/${this.ticker}?limit=20`);
      if (resp.ok) {
        const result = await resp.json();
        this.data = result.data || [];
      }
    } catch (e) {
      console.error("Failed to load insider activity:", e);
    }

    this.isLoading = false;
    this.render();
  }

  private formatValue(value: number): string {
    if (!value) return "—";
    if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
    return `$${value.toLocaleString()}`;
  }

  private formatShares(shares: number): string {
    if (!shares) return "—";
    if (Math.abs(shares) >= 1e6) return `${(shares / 1e6).toFixed(1)}M`;
    if (Math.abs(shares) >= 1e3) return `${(shares / 1e3).toFixed(0)}K`;
    return shares.toLocaleString();
  }

  private getTransactionType(type: string): { label: string; color: string; icon: string } {
    const t = type?.toUpperCase() || "";
    if (t === "P" || t.includes("PURCHASE") || t.includes("BUY")) {
      return { label: "BUY", color: "#4ade80", icon: "📈" };
    }
    if (t === "S" || t.includes("SALE") || t.includes("SELL")) {
      return { label: "SELL", color: "#f87171", icon: "📉" };
    }
    if (t === "A" || t.includes("AWARD") || t.includes("GRANT")) {
      return { label: "GRANT", color: "#a78bfa", icon: "🎁" };
    }
    return { label: type || "OTHER", color: "#94a3b8", icon: "📋" };
  }

  private calculateSentiment(): { buys: number; sells: number; netValue: number; sentiment: string } {
    let buys = 0, sells = 0, buyValue = 0, sellValue = 0;
    
    for (const t of this.data) {
      const type = this.getTransactionType(t.transaction_type);
      if (type.label === "BUY") {
        buys++;
        buyValue += t.value || 0;
      } else if (type.label === "SELL") {
        sells++;
        sellValue += t.value || 0;
      }
    }

    const netValue = buyValue - sellValue;
    let sentiment = "Neutral";
    if (buys > sells * 2) sentiment = "Bullish";
    else if (sells > buys * 2) sentiment = "Bearish";
    else if (buys > sells) sentiment = "Slight Bullish";
    else if (sells > buys) sentiment = "Slight Bearish";

    return { buys, sells, netValue, sentiment };
  }

  private render() {
    const { buys, sells, netValue, sentiment } = this.calculateSentiment();
    const sentimentColor = sentiment.includes("Bullish") ? "#4ade80" 
      : sentiment.includes("Bearish") ? "#f87171" : "#94a3b8";

    this.innerHTML = `
      <style>
        .insider-panel {
          height: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .insider-header {
          padding: 0.75rem 1rem;
          border-bottom: 1px solid rgba(148, 163, 184, 0.15);
        }
        .insider-header h3 {
          margin: 0;
          font-size: 0.95rem;
          color: #e2e8f0;
        }
        .insider-explainer {
          font-size: 0.7rem;
          color: #64748b;
          padding: 0.5rem 1rem;
          background: rgba(30, 41, 59, 0.3);
          border-bottom: 1px solid rgba(148, 163, 184, 0.1);
        }
        .insider-summary {
          display: flex;
          gap: 1rem;
          padding: 0.75rem 1rem;
          background: rgba(30, 41, 59, 0.4);
          border-bottom: 1px solid rgba(148, 163, 184, 0.1);
          flex-wrap: wrap;
        }
        .summary-item {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }
        .summary-label {
          font-size: 0.6rem;
          color: #64748b;
          text-transform: uppercase;
        }
        .summary-value {
          font-size: 0.9rem;
          font-weight: 600;
        }
        .insider-content {
          flex: 1;
          overflow-y: auto;
          padding: 0.5rem;
        }
        .insider-row {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
          padding: 0.6rem 0.75rem;
          border-radius: 6px;
          background: rgba(30, 41, 59, 0.4);
          margin-bottom: 0.4rem;
        }
        .insider-row:hover {
          background: rgba(30, 41, 59, 0.6);
        }
        .insider-main {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .insider-type {
          font-size: 0.65rem;
          font-weight: 600;
          padding: 0.15rem 0.4rem;
          border-radius: 3px;
        }
        .insider-name {
          font-size: 0.8rem;
          font-weight: 500;
          color: #e2e8f0;
        }
        .insider-title {
          font-size: 0.7rem;
          color: #64748b;
        }
        .insider-details {
          display: flex;
          gap: 0.75rem;
          align-items: center;
          flex-wrap: wrap;
        }
        .insider-shares {
          font-size: 0.75rem;
          color: #94a3b8;
        }
        .insider-value {
          font-size: 0.75rem;
          font-weight: 600;
          color: #e2e8f0;
        }
        .insider-price {
          font-size: 0.7rem;
          color: #64748b;
        }
        .insider-date {
          font-size: 0.65rem;
          color: #475569;
          margin-left: auto;
        }
        .insider-empty {
          text-align: center;
          padding: 2rem;
          color: #64748b;
          font-size: 0.8rem;
        }
        .insider-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 150px;
          color: #64748b;
        }
      </style>

      <div class="insider-panel">
        <div class="insider-header">
          <h3>👔 Insider Activity ${this.ticker ? `- ${this.ticker}` : ""}</h3>
        </div>

        <div class="insider-explainer">
          <strong>How to read:</strong> Insider <strong>buys are bullish</strong> — insiders put their own money in. 
          Sells are often for diversification or tax planning, so less meaningful. 
          Watch for <strong>clusters of buys</strong>.
        </div>

        ${this.data.length > 0 ? `
          <div class="insider-summary">
            <div class="summary-item">
              <span class="summary-label">Sentiment</span>
              <span class="summary-value" style="color: ${sentimentColor}">${sentiment}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">Buys</span>
              <span class="summary-value" style="color: #4ade80">${buys}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">Sells</span>
              <span class="summary-value" style="color: #f87171">${sells}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">Net Value</span>
              <span class="summary-value" style="color: ${netValue >= 0 ? '#4ade80' : '#f87171'}">${this.formatValue(Math.abs(netValue))}</span>
            </div>
          </div>
        ` : ""}

        <div class="insider-content">
          ${this.isLoading 
            ? `<div class="insider-loading">Loading insider activity...</div>`
            : !this.ticker
            ? `<div class="insider-empty">Select a stock to view insider activity.</div>`
            : this.data.length === 0
            ? `<div class="insider-empty">No insider activity found for ${this.ticker}. Run SEC EDGAR ingestion to populate.</div>`
            : this.data.map(t => {
                const type = this.getTransactionType(t.transaction_type);
                return `
                  <div class="insider-row">
                    <div class="insider-main">
                      <span class="insider-type" style="background: ${type.color}20; color: ${type.color}">${type.icon} ${type.label}</span>
                      <span class="insider-name">${t.insider_name || "Unknown"}</span>
                    </div>
                    ${t.insider_title ? `<span class="insider-title">${t.insider_title}</span>` : ""}
                    <div class="insider-details">
                      <span class="insider-shares">${this.formatShares(t.shares)} shares</span>
                      ${t.price ? `<span class="insider-price">@ $${t.price.toFixed(2)}</span>` : ""}
                      <span class="insider-value">${this.formatValue(t.value)}</span>
                      <span class="insider-date">${t.trade_date || t.filing_date || ""}</span>
                    </div>
                  </div>
                `;
              }).join("")}
        </div>
      </div>
    `;
  }
}

customElements.define("insider-activity-panel", InsiderActivityPanel);
