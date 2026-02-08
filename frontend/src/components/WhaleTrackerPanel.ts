/**
 * WhaleTrackerPanel - Institutional Holdings Activity
 * 
 * Shows 13F filing activity from major institutional investors:
 * - New positions (whales initiating)
 * - Increased positions (adding to holdings)
 * - Decreased positions (trimming/exiting)
 * 
 * Data is quarterly (SEC 13F filing requirement)
 */

const API_BASE = (window as any).VITE_API_URL || "http://localhost:8000";

interface WhalePosition {
  ticker: string;
  holder: string;
  shares: number;
  value: number;
  change_shares?: number;
  change_pct?: number;
  report_date?: string;
  price?: number;
}

interface WhaleData {
  filing_frequency: string;
  new_positions: WhalePosition[];
  increased: WhalePosition[];
  decreased: WhalePosition[];
}

export class WhaleTrackerPanel extends HTMLElement {
  private data: WhaleData | null = null;
  private isLoading = false;
  private activeTab: "new" | "increased" | "decreased" = "new";

  connectedCallback() {
    this.render();
    this.loadData();
  }

  private async loadData() {
    this.isLoading = true;
    this.render();

    try {
      const resp = await fetch(`${API_BASE}/api/whale_activity?limit=30`);
      if (resp.ok) {
        this.data = await resp.json();
      }
    } catch (e) {
      console.error("Failed to load whale activity:", e);
    }

    this.isLoading = false;
    this.render();
    this.setupEventListeners();
  }

  private formatValue(value: number): string {
    if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
  }

  private formatShares(shares: number): string {
    if (Math.abs(shares) >= 1e6) return `${(shares / 1e6).toFixed(1)}M`;
    if (Math.abs(shares) >= 1e3) return `${(shares / 1e3).toFixed(0)}K`;
    return shares.toLocaleString();
  }

  private setupEventListeners() {
    // Tab switching
    this.querySelectorAll(".whale-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        this.activeTab = tab.getAttribute("data-tab") as any;
        this.render();
        this.setupEventListeners();
      });
    });

    // Ticker clicks
    this.querySelectorAll(".whale-ticker").forEach(el => {
      el.addEventListener("click", () => {
        const ticker = el.getAttribute("data-ticker");
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

  private renderPositions(positions: WhalePosition[], type: "new" | "increased" | "decreased"): string {
    if (positions.length === 0) {
      return `<div class="whale-empty">No ${type} positions found. Run SEC EDGAR ingestion to populate.</div>`;
    }

    return positions.slice(0, 15).map(p => {
      const changeIndicator = type === "new" 
        ? `<span class="change-badge new">NEW</span>`
        : type === "increased"
        ? `<span class="change-badge up">+${p.change_pct?.toFixed(1) || 0}%</span>`
        : `<span class="change-badge down">${p.change_pct?.toFixed(1) || 0}%</span>`;

      return `
        <div class="whale-row">
          <div class="whale-main">
            <span class="whale-ticker" data-ticker="${p.ticker}">${p.ticker}</span>
            <span class="whale-holder" title="${p.holder}">${p.holder?.substring(0, 25) || "Unknown"}${(p.holder?.length || 0) > 25 ? "..." : ""}</span>
          </div>
          <div class="whale-details">
            <span class="whale-value">${this.formatValue(p.value || 0)}</span>
            <span class="whale-shares">${this.formatShares(p.shares || 0)} shares</span>
            ${changeIndicator}
          </div>
          ${p.report_date ? `<span class="whale-date">Q${this.getQuarter(p.report_date)} ${new Date(p.report_date).getFullYear()}</span>` : ""}
        </div>
      `;
    }).join("");
  }

  private getQuarter(dateStr: string): number {
    const month = new Date(dateStr).getMonth();
    return Math.floor(month / 3) + 1;
  }

  private render() {
    const positions = this.activeTab === "new" 
      ? this.data?.new_positions || []
      : this.activeTab === "increased"
      ? this.data?.increased || []
      : this.data?.decreased || [];

    this.innerHTML = `
      <style>
        .whale-panel {
          height: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .whale-header {
          padding: 0.75rem 1rem;
          border-bottom: 1px solid rgba(148, 163, 184, 0.15);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .whale-title {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .whale-title h3 {
          margin: 0;
          font-size: 0.95rem;
          color: #e2e8f0;
        }
        .whale-badge {
          font-size: 0.6rem;
          padding: 0.1rem 0.35rem;
          border-radius: 3px;
          background: rgba(139, 92, 246, 0.2);
          color: #a78bfa;
        }
        .whale-tabs {
          display: flex;
          gap: 0.25rem;
          padding: 0.5rem 1rem;
          border-bottom: 1px solid rgba(148, 163, 184, 0.1);
        }
        .whale-tab {
          padding: 0.4rem 0.75rem;
          font-size: 0.75rem;
          border-radius: 4px;
          background: transparent;
          border: 1px solid transparent;
          color: #64748b;
          cursor: pointer;
          transition: all 0.15s;
        }
        .whale-tab:hover {
          color: #94a3b8;
        }
        .whale-tab.active {
          background: rgba(139, 92, 246, 0.15);
          border-color: rgba(139, 92, 246, 0.3);
          color: #a78bfa;
        }
        .whale-content {
          flex: 1;
          overflow-y: auto;
          padding: 0.5rem;
        }
        .whale-row {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          padding: 0.6rem 0.75rem;
          border-radius: 6px;
          background: rgba(30, 41, 59, 0.4);
          margin-bottom: 0.4rem;
          transition: background 0.15s;
        }
        .whale-row:hover {
          background: rgba(30, 41, 59, 0.7);
        }
        .whale-main {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .whale-ticker {
          font-family: ui-monospace, monospace;
          font-weight: 600;
          font-size: 0.8rem;
          color: #60a5fa;
          cursor: pointer;
          padding: 0.1rem 0.3rem;
          border-radius: 3px;
          background: rgba(59, 130, 246, 0.1);
        }
        .whale-ticker:hover {
          background: rgba(59, 130, 246, 0.2);
        }
        .whale-holder {
          font-size: 0.72rem;
          color: #94a3b8;
        }
        .whale-details {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          flex-wrap: wrap;
        }
        .whale-value {
          font-size: 0.8rem;
          font-weight: 600;
          color: #e2e8f0;
        }
        .whale-shares {
          font-size: 0.72rem;
          color: #64748b;
        }
        .change-badge {
          font-size: 0.65rem;
          padding: 0.1rem 0.35rem;
          border-radius: 3px;
          font-weight: 600;
        }
        .change-badge.new {
          background: rgba(139, 92, 246, 0.2);
          color: #a78bfa;
        }
        .change-badge.up {
          background: rgba(34, 197, 94, 0.2);
          color: #4ade80;
        }
        .change-badge.down {
          background: rgba(239, 68, 68, 0.2);
          color: #f87171;
        }
        .whale-date {
          font-size: 0.65rem;
          color: #64748b;
          margin-left: auto;
        }
        .whale-empty {
          text-align: center;
          padding: 2rem;
          color: #64748b;
          font-size: 0.8rem;
        }
        .whale-explainer {
          font-size: 0.7rem;
          color: #64748b;
          padding: 0.5rem 1rem;
          background: rgba(30, 41, 59, 0.3);
          border-bottom: 1px solid rgba(148, 163, 184, 0.1);
        }
        .whale-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 200px;
          color: #64748b;
        }
      </style>

      <div class="whale-panel">
        <div class="whale-header">
          <div class="whale-title">
            <h3>🐋 Whale Tracker</h3>
            <span class="whale-badge">13F Quarterly</span>
          </div>
        </div>

        <div class="whale-explainer">
          <strong>How to read:</strong> Institutional investors (>$100M AUM) must file 13F quarterly. 
          <strong>New positions</strong> = whales initiating. <strong>Increases</strong> = conviction growing. 
          <strong>Decreases</strong> = trimming/exiting.
        </div>

        <div class="whale-tabs">
          <button class="whale-tab ${this.activeTab === "new" ? "active" : ""}" data-tab="new">
            🆕 New (${this.data?.new_positions?.length || 0})
          </button>
          <button class="whale-tab ${this.activeTab === "increased" ? "active" : ""}" data-tab="increased">
            📈 Increased (${this.data?.increased?.length || 0})
          </button>
          <button class="whale-tab ${this.activeTab === "decreased" ? "active" : ""}" data-tab="decreased">
            📉 Decreased (${this.data?.decreased?.length || 0})
          </button>
        </div>

        <div class="whale-content">
          ${this.isLoading 
            ? `<div class="whale-loading">Loading whale activity...</div>`
            : this.renderPositions(positions, this.activeTab)}
        </div>
      </div>
    `;
  }
}

customElements.define("whale-tracker-panel", WhaleTrackerPanel);
