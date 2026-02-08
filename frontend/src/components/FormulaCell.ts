/**
 * FormulaCell - Editable formula cell component inspired by Excel/TradingView.
 * 
 * Features:
 * - Display mode: shows computed value with formatting
 * - Edit mode: inline formula editor with autocomplete
 * - Real-time validation
 * - Syntax highlighting for formulas
 */

import { validateFormula, FIELD_CATEGORIES } from "../api/client";

const ALL_FIELDS = Object.values(FIELD_CATEGORIES).flat();

const FUNCTIONS = [
  "SQRT", "ABS", "MAX", "MIN", "AVG", "SUM", "POW", "LOG", "LOG10", 
  "EXP", "ROUND", "FLOOR", "CEIL", "IF", "COALESCE", "ISNULL", "NULLIF"
];

export class FormulaCell extends HTMLElement {
  private _value: number | null = null;
  private _expression: string = "";
  private _format: "number" | "percent" | "currency" = "number";
  private _isEditing: boolean = false;
  private _isValid: boolean = true;
  private _errors: string[] = [];
  
  private shadow: ShadowRoot;
  private displayEl!: HTMLDivElement;
  private editorEl!: HTMLDivElement;
  private inputEl!: HTMLInputElement;
  private autocompleteEl!: HTMLDivElement;
  private validationEl!: HTMLDivElement;

  static get observedAttributes() {
    return ["value", "expression", "format", "editable"];
  }

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
    this.render();
  }

  connectedCallback() {
    this.setupEventListeners();
  }

  attributeChangedCallback(name: string, _oldValue: string, newValue: string) {
    switch (name) {
      case "value":
        this._value = newValue !== null ? parseFloat(newValue) : null;
        break;
      case "expression":
        this._expression = newValue || "";
        break;
      case "format":
        this._format = (newValue as any) || "number";
        break;
    }
    this.updateDisplay();
  }

  get value() { return this._value; }
  set value(v: number | null) {
    this._value = v;
    this.updateDisplay();
  }

  get expression() { return this._expression; }
  set expression(v: string) {
    this._expression = v;
    this.updateDisplay();
  }

  private render() {
    this.shadow.innerHTML = `
      <style>
        :host {
          display: inline-block;
          min-width: 80px;
          font-family: system-ui, -apple-system, sans-serif;
          font-size: 0.85rem;
        }
        
        .cell {
          position: relative;
          border: 1px solid transparent;
          border-radius: 4px;
          transition: all 0.15s ease;
        }
        
        .cell:hover {
          border-color: rgba(59, 130, 246, 0.4);
          background: rgba(59, 130, 246, 0.05);
        }
        
        .cell.editing {
          border-color: rgba(59, 130, 246, 0.8);
          background: rgba(15, 23, 42, 0.95);
        }
        
        .cell.invalid {
          border-color: rgba(239, 68, 68, 0.6);
        }
        
        .display {
          padding: 0.25rem 0.5rem;
          cursor: pointer;
          white-space: nowrap;
        }
        
        .display .value {
          color: #e2e8f0;
        }
        
        .display .value.positive {
          color: #4ade80;
        }
        
        .display .value.negative {
          color: #f87171;
        }
        
        .display .expression-hint {
          font-size: 0.7rem;
          color: #64748b;
          font-family: 'SF Mono', 'Fira Code', monospace;
        }
        
        .editor {
          display: none;
          padding: 0.25rem;
        }
        
        .cell.editing .display {
          display: none;
        }
        
        .cell.editing .editor {
          display: block;
        }
        
        .editor input {
          width: 100%;
          padding: 0.25rem 0.5rem;
          border: none;
          border-radius: 3px;
          background: rgba(30, 41, 59, 0.8);
          color: #e2e8f0;
          font-family: 'SF Mono', 'Fira Code', monospace;
          font-size: 0.8rem;
          outline: none;
        }
        
        .editor input:focus {
          background: rgba(30, 41, 59, 1);
        }
        
        .autocomplete {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          max-height: 200px;
          overflow-y: auto;
          background: rgba(15, 23, 42, 0.98);
          border: 1px solid rgba(148, 163, 184, 0.3);
          border-radius: 4px;
          margin-top: 2px;
          z-index: 100;
          display: none;
        }
        
        .autocomplete.visible {
          display: block;
        }
        
        .autocomplete-item {
          padding: 0.35rem 0.5rem;
          cursor: pointer;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .autocomplete-item:hover,
        .autocomplete-item.selected {
          background: rgba(59, 130, 246, 0.2);
        }
        
        .autocomplete-item .name {
          color: #e2e8f0;
          font-family: 'SF Mono', 'Fira Code', monospace;
          font-size: 0.75rem;
        }
        
        .autocomplete-item .type {
          color: #64748b;
          font-size: 0.65rem;
          text-transform: uppercase;
        }
        
        .validation {
          font-size: 0.7rem;
          padding: 0.25rem 0.5rem;
          color: #f87171;
          display: none;
        }
        
        .validation.visible {
          display: block;
        }
      </style>
      
      <div class="cell">
        <div class="display">
          <span class="value"></span>
          <div class="expression-hint"></div>
        </div>
        <div class="editor">
          <input type="text" placeholder="Enter formula..." />
        </div>
        <div class="autocomplete"></div>
        <div class="validation"></div>
      </div>
    `;

    this.displayEl = this.shadow.querySelector(".display")!;
    this.editorEl = this.shadow.querySelector(".editor")!;
    this.inputEl = this.shadow.querySelector("input")!;
    this.autocompleteEl = this.shadow.querySelector(".autocomplete")!;
    this.validationEl = this.shadow.querySelector(".validation")!;
  }

  private setupEventListeners() {
    const cell = this.shadow.querySelector(".cell")!;
    
    // Click to edit
    this.displayEl.addEventListener("click", () => {
      if (this.hasAttribute("editable")) {
        this.startEditing();
      }
    });

    // Input handling
    this.inputEl.addEventListener("input", () => {
      this.handleInput();
    });

    this.inputEl.addEventListener("keydown", (e) => {
      this.handleKeydown(e);
    });

    this.inputEl.addEventListener("blur", () => {
      // Delay to allow autocomplete click
      setTimeout(() => this.finishEditing(), 150);
    });

    // Autocomplete click
    this.autocompleteEl.addEventListener("click", (e) => {
      const item = (e.target as HTMLElement).closest(".autocomplete-item");
      if (item) {
        const value = item.getAttribute("data-value");
        if (value) {
          this.insertAutocomplete(value);
        }
      }
    });
  }

  private startEditing() {
    this._isEditing = true;
    const cell = this.shadow.querySelector(".cell")!;
    cell.classList.add("editing");
    this.inputEl.value = this._expression;
    this.inputEl.focus();
    this.inputEl.select();
  }

  private finishEditing() {
    this._isEditing = false;
    const cell = this.shadow.querySelector(".cell")!;
    cell.classList.remove("editing");
    this.autocompleteEl.classList.remove("visible");
    
    if (this._isValid && this.inputEl.value !== this._expression) {
      this._expression = this.inputEl.value;
      this.dispatchEvent(new CustomEvent("formula-change", {
        detail: { expression: this._expression },
        bubbles: true,
      }));
    }
    
    this.updateDisplay();
  }

  private async handleInput() {
    const value = this.inputEl.value;
    const cursorPos = this.inputEl.selectionStart || 0;
    
    // Find current word for autocomplete
    const beforeCursor = value.substring(0, cursorPos);
    const match = beforeCursor.match(/[a-zA-Z_][a-zA-Z0-9_]*$/);
    const currentWord = match ? match[0].toLowerCase() : "";

    if (currentWord.length >= 1) {
      this.showAutocomplete(currentWord);
    } else {
      this.autocompleteEl.classList.remove("visible");
    }

    // Validate
    if (value.trim()) {
      try {
        const result = await validateFormula(value);
        this._isValid = result.is_valid;
        this._errors = result.errors;
        
        const cell = this.shadow.querySelector(".cell")!;
        if (result.is_valid) {
          cell.classList.remove("invalid");
          this.validationEl.classList.remove("visible");
        } else {
          cell.classList.add("invalid");
          this.validationEl.textContent = result.errors.join("; ");
          this.validationEl.classList.add("visible");
        }
      } catch {
        // Ignore validation errors during typing
      }
    }
  }

  private handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      this.finishEditing();
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.inputEl.value = this._expression;
      this.finishEditing();
    } else if (e.key === "Tab" && this.autocompleteEl.classList.contains("visible")) {
      e.preventDefault();
      const selected = this.autocompleteEl.querySelector(".autocomplete-item.selected");
      if (selected) {
        const value = selected.getAttribute("data-value");
        if (value) this.insertAutocomplete(value);
      }
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (this.autocompleteEl.classList.contains("visible")) {
        e.preventDefault();
        this.navigateAutocomplete(e.key === "ArrowDown" ? 1 : -1);
      }
    }
  }

  private showAutocomplete(prefix: string) {
    const matches: Array<{ name: string; type: string }> = [];
    
    // Match fields
    for (const field of ALL_FIELDS) {
      if (field.toLowerCase().startsWith(prefix)) {
        matches.push({ name: field, type: "field" });
      }
    }
    
    // Match functions
    for (const func of FUNCTIONS) {
      if (func.toLowerCase().startsWith(prefix)) {
        matches.push({ name: func, type: "function" });
      }
    }

    if (matches.length === 0) {
      this.autocompleteEl.classList.remove("visible");
      return;
    }

    this.autocompleteEl.innerHTML = matches.slice(0, 10).map((m, i) => `
      <div class="autocomplete-item ${i === 0 ? 'selected' : ''}" data-value="${m.name}">
        <span class="name">${m.name}</span>
        <span class="type">${m.type}</span>
      </div>
    `).join("");
    
    this.autocompleteEl.classList.add("visible");
  }

  private navigateAutocomplete(direction: number) {
    const items = this.autocompleteEl.querySelectorAll(".autocomplete-item");
    const current = this.autocompleteEl.querySelector(".autocomplete-item.selected");
    let index = current ? Array.from(items).indexOf(current) : -1;
    
    index += direction;
    if (index < 0) index = items.length - 1;
    if (index >= items.length) index = 0;
    
    items.forEach((item, i) => {
      item.classList.toggle("selected", i === index);
    });
  }

  private insertAutocomplete(value: string) {
    const input = this.inputEl;
    const cursorPos = input.selectionStart || 0;
    const text = input.value;
    
    // Find start of current word
    const beforeCursor = text.substring(0, cursorPos);
    const match = beforeCursor.match(/[a-zA-Z_][a-zA-Z0-9_]*$/);
    const wordStart = match ? cursorPos - match[0].length : cursorPos;
    
    // Replace current word with selected value
    const newValue = text.substring(0, wordStart) + value + text.substring(cursorPos);
    input.value = newValue;
    
    // Position cursor after inserted value
    const newPos = wordStart + value.length;
    input.setSelectionRange(newPos, newPos);
    
    this.autocompleteEl.classList.remove("visible");
    input.focus();
  }

  private updateDisplay() {
    const valueEl = this.displayEl.querySelector(".value")!;
    const hintEl = this.displayEl.querySelector(".expression-hint")!;
    
    if (this._value !== null && !isNaN(this._value)) {
      let formatted: string;
      switch (this._format) {
        case "percent":
          formatted = `${this._value.toFixed(1)}%`;
          break;
        case "currency":
          formatted = `$${this._value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
          break;
        default:
          formatted = this._value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
      
      valueEl.textContent = formatted;
      valueEl.classList.toggle("positive", this._value > 0);
      valueEl.classList.toggle("negative", this._value < 0);
    } else {
      valueEl.textContent = "—";
      valueEl.classList.remove("positive", "negative");
    }
    
    if (this._expression && this.hasAttribute("show-expression")) {
      hintEl.textContent = `= ${this._expression}`;
    } else {
      hintEl.textContent = "";
    }
  }
}

customElements.define("formula-cell", FormulaCell);
