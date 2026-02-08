/**
 * SearchCombobox - Quick stock search and navigation
 * 
 * Lightweight combobox with debounced search, keyboard navigation,
 * and instant navigation to stock detail view.
 */

import { fetchScreenData } from "../api/client";

export interface SearchResult {
  ticker: string;
  price?: number;
  pe_ratio?: number;
  market_cap?: number;
}

export class SearchCombobox extends HTMLElement {
  private input: HTMLInputElement | null = null;
  private dropdown: HTMLElement | null = null;
  private results: SearchResult[] = [];
  private selectedIndex: number = -1;
  private debounceTimer: number | null = null;
  private isOpen: boolean = false;
  private allTickers: string[] = [];
  private tickersLoaded: boolean = false;

  constructor() {
    super();
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
    // Lazy load tickers after FCP
    requestIdleCallback(() => this.loadTickers(), { timeout: 2000 });
  }

  private render() {
    this.innerHTML = `
      <div class="search-combobox">
        <div class="search-input-wrapper">
          <span class="search-icon">🔍</span>
          <input 
            type="text" 
            class="search-input" 
            placeholder="Search stocks..." 
            autocomplete="off"
            aria-label="Search stocks"
            aria-expanded="false"
            aria-haspopup="listbox"
          />
          <kbd class="search-shortcut">/</kbd>
        </div>
        <div class="search-dropdown" role="listbox" hidden>
          <div class="search-loading">Type to search...</div>
        </div>
      </div>
    `;

    this.input = this.querySelector(".search-input");
    this.dropdown = this.querySelector(".search-dropdown");
  }

  private async loadTickers() {
    if (this.tickersLoaded) return;
    
    try {
      const result = await fetchScreenData({
        columns: ["ticker"],
        limit: 500,
      });
      this.allTickers = result.rows.map((r: any) => r.ticker).filter(Boolean);
      this.tickersLoaded = true;
    } catch (e) {
      console.warn("Failed to preload tickers:", e);
    }
  }

  private setupEventListeners() {
    if (!this.input || !this.dropdown) return;

    // Input handling with debounce
    this.input.addEventListener("input", (e) => {
      const query = (e.target as HTMLInputElement).value.trim();
      
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      
      if (query.length === 0) {
        this.closeDropdown();
        return;
      }
      
      this.debounceTimer = window.setTimeout(() => {
        this.search(query);
      }, 150); // Short debounce for responsiveness
    });

    // Keyboard navigation
    this.input.addEventListener("keydown", (e) => {
      if (!this.isOpen) {
        if (e.key === "Enter" && this.input?.value) {
          this.navigateToStock(this.input.value.toUpperCase());
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          this.selectNext();
          break;
        case "ArrowUp":
          e.preventDefault();
          this.selectPrev();
          break;
        case "Enter":
          e.preventDefault();
          if (this.selectedIndex >= 0 && this.results[this.selectedIndex]) {
            this.navigateToStock(this.results[this.selectedIndex].ticker);
          } else if (this.input?.value) {
            this.navigateToStock(this.input.value.toUpperCase());
          }
          break;
        case "Escape":
          this.closeDropdown();
          this.input?.blur();
          break;
      }
    });

    // Focus/blur
    this.input.addEventListener("focus", () => {
      if (this.input?.value) {
        this.search(this.input.value);
      }
    });

    // Click outside to close
    document.addEventListener("click", (e) => {
      if (!this.contains(e.target as Node)) {
        this.closeDropdown();
      }
    });

    // Global keyboard shortcut: "/" to focus search
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        this.input?.focus();
      }
    });
  }

  private async search(query: string) {
    const upperQuery = query.toUpperCase();
    
    // Fast local filter first if tickers loaded
    if (this.tickersLoaded && this.allTickers.length > 0) {
      const matches = this.allTickers
        .filter(t => t.startsWith(upperQuery) || t.includes(upperQuery))
        .slice(0, 8);
      
      if (matches.length > 0) {
        // Show quick results immediately
        this.results = matches.map(ticker => ({ ticker }));
        this.renderResults();
        this.openDropdown();
        
        // Then fetch full data in background
        this.fetchFullData(matches);
        return;
      }
    }
    
    // Fallback to API search
    try {
      const result = await fetchScreenData({
        filters: [{ field: "ticker", op: "LIKE" as any, value: `%${upperQuery}%` }],
        columns: ["ticker", "price", "pe_ratio", "market_cap"],
        limit: 8,
      });
      
      this.results = result.rows as SearchResult[];
      this.renderResults();
      this.openDropdown();
    } catch (e) {
      this.results = [];
      this.renderResults();
    }
  }

  private async fetchFullData(tickers: string[]) {
    try {
      const result = await fetchScreenData({
        filters: [{ field: "ticker", op: "IN" as const, value: tickers }],
        columns: ["ticker", "price", "pe_ratio", "market_cap"],
        limit: 8,
      });
      
      // Update results with full data
      this.results = result.rows as SearchResult[];
      this.renderResults();
    } catch (e) {
      // Keep existing results
    }
  }

  private renderResults() {
    if (!this.dropdown) return;

    if (this.results.length === 0) {
      this.dropdown.innerHTML = `
        <div class="search-empty">No stocks found</div>
      `;
      return;
    }

    this.dropdown.innerHTML = this.results.map((r, i) => `
      <div class="search-result ${i === this.selectedIndex ? 'selected' : ''}" 
           data-ticker="${r.ticker}" 
           role="option"
           aria-selected="${i === this.selectedIndex}">
        <span class="result-ticker">${r.ticker}</span>
        <div class="result-meta">
          ${r.price ? `<span class="result-price">$${r.price.toFixed(2)}</span>` : ''}
          ${r.pe_ratio ? `<span class="result-pe">${r.pe_ratio.toFixed(1)}x</span>` : ''}
          ${r.market_cap ? `<span class="result-cap">${this.formatCap(r.market_cap)}</span>` : ''}
        </div>
      </div>
    `).join('');

    // Click handlers
    this.dropdown.querySelectorAll(".search-result").forEach(el => {
      el.addEventListener("click", () => {
        const ticker = el.getAttribute("data-ticker");
        if (ticker) this.navigateToStock(ticker);
      });
    });
  }

  private formatCap(cap: number): string {
    if (cap >= 1e12) return `$${(cap / 1e12).toFixed(1)}T`;
    if (cap >= 1e9) return `$${(cap / 1e9).toFixed(1)}B`;
    if (cap >= 1e6) return `$${(cap / 1e6).toFixed(0)}M`;
    return `$${cap.toLocaleString()}`;
  }

  private openDropdown() {
    if (!this.dropdown || !this.input) return;
    this.dropdown.hidden = false;
    this.input.setAttribute("aria-expanded", "true");
    this.isOpen = true;
    this.selectedIndex = -1;
  }

  private closeDropdown() {
    if (!this.dropdown || !this.input) return;
    this.dropdown.hidden = true;
    this.input.setAttribute("aria-expanded", "false");
    this.isOpen = false;
    this.selectedIndex = -1;
  }

  private selectNext() {
    this.selectedIndex = Math.min(this.selectedIndex + 1, this.results.length - 1);
    this.updateSelection();
  }

  private selectPrev() {
    this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
    this.updateSelection();
  }

  private updateSelection() {
    this.dropdown?.querySelectorAll(".search-result").forEach((el, i) => {
      el.classList.toggle("selected", i === this.selectedIndex);
      el.setAttribute("aria-selected", String(i === this.selectedIndex));
    });
  }

  private navigateToStock(ticker: string) {
    this.closeDropdown();
    if (this.input) this.input.value = "";
    
    // Dispatch navigation event
    this.dispatchEvent(new CustomEvent("navigate-stock", {
      detail: { ticker },
      bubbles: true,
    }));
  }
}

customElements.define("search-combobox", SearchCombobox);
