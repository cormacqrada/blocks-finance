/**
 * API client for blocks-finance backend MCP endpoints.
 */

// Use environment variable for production, fallback to localhost for dev
export const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";
const API_BASE_URL = API_BASE;

export interface Formula {
  id: string;
  name: string;
  expression: string;
  description: string;
  category: string;
  output_format: "number" | "percent" | "currency";
  is_system: boolean;
}

export interface FormulaValidation {
  is_valid: boolean;
  errors: string[];
  fields_used: string[];
  functions_used: string[];
}

export interface ScreenFilter {
  field: string;
  op: ">" | "<" | ">=" | "<=" | "=" | "!=" | "BETWEEN" | "IN";
  value: number | string | number[] | string[];
}

export interface ScreenDefinition {
  id: string;
  name: string;
  description: string;
  filters: ScreenFilter[];
  rank_by: string;
  rank_order: "ASC" | "DESC";
  columns: string[];
  is_system: boolean;
}

export interface ScreenResult {
  rows: Record<string, any>[];
  count: number;
  columns: string[];
}

export interface FundamentalsRow {
  ticker: string;
  as_of: string;
  [key: string]: any;
}

export interface GreenblattScore {
  ticker: string;
  as_of: string;
  earnings_yield: number;
  return_on_capital: number;
  rank: number;
}

// Field categories for UI organization
export const FIELD_CATEGORIES = {
  core: ["ticker", "as_of", "ebit", "enterprise_value", "net_working_capital"],
  revenue: ["revenue", "revenue_growth_yoy"],
  margins: ["gross_margin", "operating_margin", "net_margin"],
  cash_flow: ["free_cash_flow", "fcf_yield"],
  leverage: ["total_debt", "total_equity", "debt_to_equity", "interest_coverage"],
  book_value: ["book_value", "tangible_book_value", "book_value_per_share"],
  market: ["market_cap", "price", "shares_outstanding"],
  valuation: ["pe_ratio", "pb_ratio", "ps_ratio", "ev_to_ebitda"],
  dividends: ["dividend_yield", "payout_ratio"],
  earnings: ["eps", "eps_growth_yoy"],
} as const;

// API Functions

export async function fetchFormulas(category?: string): Promise<{ formulas: Formula[]; fields: string[] }> {
  const url = category
    ? `${API_BASE_URL}/mcp/formula.list?category=${encodeURIComponent(category)}`
    : `${API_BASE_URL}/mcp/formula.list`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function createFormula(formula: Partial<Formula>): Promise<Formula> {
  const resp = await fetch(`${API_BASE_URL}/mcp/formula.create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(formula),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${resp.status}`);
  }
  return resp.json();
}

export async function validateFormula(expression: string): Promise<FormulaValidation> {
  const resp = await fetch(`${API_BASE_URL}/mcp/formula.validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expression }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function evaluateFormula(params: {
  expression?: string;
  formula_id?: string;
  universe?: string[];
  as_of?: string;
}): Promise<{ results: Array<{ ticker: string; as_of: string; value: number | null; error?: string }> }> {
  const resp = await fetch(`${API_BASE_URL}/mcp/formula.evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function runScreen(params: {
  filters?: ScreenFilter[];
  rank_by?: string;
  rank_order?: "ASC" | "DESC";
  columns?: string[];
  formulas?: string[];
  limit?: number;
}): Promise<ScreenResult> {
  const resp = await fetch(`${API_BASE_URL}/mcp/screen.run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// Alias for torque components
export const fetchScreenData = runScreen;

export async function fetchScreens(): Promise<{ screens: ScreenDefinition[] }> {
  const resp = await fetch(`${API_BASE_URL}/mcp/screen.list`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function saveScreen(screen: Partial<ScreenDefinition>): Promise<{ id: string; name: string }> {
  const resp = await fetch(`${API_BASE_URL}/mcp/screen.save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(screen),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function fetchGreenblattScores(params?: {
  universe?: string[];
  limit?: number;
}): Promise<{ rows: GreenblattScore[] }> {
  const resp = await fetch(`${API_BASE_URL}/mcp/finance.query_greenblatt_scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params || {}),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function fetchFundamentalsFields(): Promise<{
  fields: string[];
  categories: Record<string, string[]>;
}> {
  const resp = await fetch(`${API_BASE_URL}/mcp/fundamentals.fields`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function computeAllFormulas(universe?: string[]): Promise<{ computed_count: number }> {
  const resp = await fetch(`${API_BASE_URL}/mcp/formula.compute_all`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ universe }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}
