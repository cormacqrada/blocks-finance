/**
 * CompanyNewsPanel - Company News Feed
 * 
 * Shows recent news from Finnhub for a specific ticker:
 * - Headlines with summaries
 * - Source attribution
 * - Links to full articles
 */

const API_BASE = (window as any).VITE_API_URL || "http://localhost:8000";

interface NewsItem {
  datetime: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
}

export class CompanyNewsPanel extends HTMLElement {
  private ticker: string | null = null;
  private data: NewsItem[] = [];
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
      const resp = await fetch(`${API_BASE}/api/company_news/${this.ticker}?limit=15`);
      if (resp.ok) {
        const result = await resp.json();
        this.data = result.data || [];
      }
    } catch (e) {
      console.error("Failed to load company news:", e);
    }

    this.isLoading = false;
    this.render();
  }

  private formatDate(dateStr: string): string {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (hours < 1) return "Just now";
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  private render() {
    this.innerHTML = `
      <style>
        .news-panel {
          height: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .news-header {
          padding: 0.75rem 1rem;
          border-bottom: 1px solid rgba(148, 163, 184, 0.15);
        }
        .news-header h3 {
          margin: 0;
          font-size: 0.95rem;
          color: #e2e8f0;
        }
        .news-content {
          flex: 1;
          overflow-y: auto;
          padding: 0.5rem;
        }
        .news-item {
          padding: 0.75rem;
          border-radius: 6px;
          background: rgba(30, 41, 59, 0.4);
          margin-bottom: 0.5rem;
          transition: background 0.15s;
        }
        .news-item:hover {
          background: rgba(30, 41, 59, 0.6);
        }
        .news-headline {
          font-size: 0.85rem;
          font-weight: 500;
          color: #e2e8f0;
          line-height: 1.4;
          margin-bottom: 0.4rem;
        }
        .news-headline a {
          color: inherit;
          text-decoration: none;
        }
        .news-headline a:hover {
          color: #60a5fa;
        }
        .news-summary {
          font-size: 0.75rem;
          color: #94a3b8;
          line-height: 1.4;
          margin-bottom: 0.4rem;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .news-meta {
          display: flex;
          gap: 0.5rem;
          align-items: center;
          font-size: 0.65rem;
          color: #64748b;
        }
        .news-source {
          background: rgba(59, 130, 246, 0.15);
          color: #60a5fa;
          padding: 0.1rem 0.4rem;
          border-radius: 3px;
        }
        .news-empty {
          text-align: center;
          padding: 2rem;
          color: #64748b;
          font-size: 0.8rem;
        }
        .news-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 150px;
          color: #64748b;
        }
      </style>

      <div class="news-panel">
        <div class="news-header">
          <h3>📰 News ${this.ticker ? `- ${this.ticker}` : ""}</h3>
        </div>

        <div class="news-content">
          ${this.isLoading 
            ? `<div class="news-loading">Loading news...</div>`
            : !this.ticker
            ? `<div class="news-empty">Select a stock to view news.</div>`
            : this.data.length === 0
            ? `<div class="news-empty">No news found for ${this.ticker}. Run Finnhub ingestion to populate.</div>`
            : this.data.map(item => `
                <div class="news-item">
                  <div class="news-headline">
                    ${item.url 
                      ? `<a href="${item.url}" target="_blank" rel="noopener">${item.headline}</a>`
                      : item.headline}
                  </div>
                  ${item.summary ? `<div class="news-summary">${item.summary}</div>` : ""}
                  <div class="news-meta">
                    ${item.source ? `<span class="news-source">${item.source}</span>` : ""}
                    <span>${this.formatDate(item.datetime)}</span>
                  </div>
                </div>
              `).join("")}
        </div>
      </div>
    `;
  }
}

customElements.define("company-news-panel", CompanyNewsPanel);
