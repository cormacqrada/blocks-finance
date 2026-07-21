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
  company_name?: string;
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
  valuation: ["pe_ratio", "pb_ratio", "ps_ratio", "ev_to_ebitda", "ev_to_fcf"],
  company_info: ["company_name", "sector", "industry"],
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

export interface ValueCompressionScore {
  ticker: string;
  as_of: string;
  operational_stability: number;
  valuation_compression: number;
  shareholder_yield_pct: number;
  ivrv_pct: number;
  market_cap: number;
}

export async function fetchValueCompressionScores(params?: {
  universe?: string[];
  min_stability?: number;
  min_compression?: number;
  limit?: number;
}): Promise<{ rows: ValueCompressionScore[] }> {
  const resp = await fetch(`${API_BASE_URL}/mcp/finance.query_value_compression`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params || {}),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function computeValueCompressionScores(universe?: string[]): Promise<{ computed_count: number }> {
  const resp = await fetch(`${API_BASE_URL}/mcp/finance.compute_value_compression`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ universe }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export interface VRRPosition {
  ticker: string;
  as_of: string;
  vrr_pct: number;
  spread_pct: number;
  velocity: number;
  velocity_label: "fast" | "moderate" | "slow";
  current_price: number | null;
  intrinsic_value: number | null;
  marginal_irr_3yr: number;
  marginal_irr_7yr: number;
  kelly_fraction: number;
  action: "add_aggressively" | "add_capital" | "hold" | "patience" | "rotate";
  market_cap: number;
}

export interface VRRSummary {
  avg_vrr: number;
  total_positions: number;
  best_opportunity: {
    ticker: string | null;
    marginal_irr_3yr: number | null;
    kelly_fraction: number | null;
  };
  positions_to_add: number;
  positions_to_rotate: number;
}

export interface IRRSimulationPoint {
  capital_pct: number;
  irr: number;
  kelly: number;
  half_kelly: number;
  zone: "deploy" | "diminishing" | "stop";
}

export interface IRRSimulation {
  ticker: string;
  horizon_years: number;
  hurdle_rate: number;
  base_irr: number;
  base_spread: number;
  base_velocity: number;
  velocity_label: string;
  edge_estimate: number;
  current_price: number | null;
  intrinsic_value: number | null;
  market_cap: number;
  points: IRRSimulationPoint[];
}

export async function computeVRR(universe?: string[]): Promise<{ computed_count: number }> {
  const resp = await fetch(`${API_BASE_URL}/mcp/finance.compute_vrr`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ universe }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function fetchVRRPositions(params?: {
  universe?: string[];
  min_vrr?: number;
  action?: string;
  limit?: number;
}): Promise<{ rows: VRRPosition[] }> {
  const resp = await fetch(`${API_BASE_URL}/mcp/finance.query_vrr`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params || {}),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function fetchVRRSummary(params?: {
  universe?: string[];
}): Promise<VRRSummary> {
  const resp = await fetch(`${API_BASE_URL}/mcp/finance.query_vrr_summary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params || {}),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function simulateMarginalIRR(params: {
  ticker: string;
  horizon_years?: number;
  hurdle_rate?: number;
  edge_estimate?: number;
  capital_steps?: number;
}): Promise<IRRSimulation> {
  const resp = await fetch(`${API_BASE_URL}/mcp/finance.simulate_marginal_irr`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// ============================================================================
// Compounding Discount Monitor (Getty Oil inspired)
// ============================================================================

export interface CompoundingDiscountPosition {
  ticker: string;
  as_of: string;
  pb_ratio: number | null;
  bvps_cagr_5yr: number | null;
  bvps_cagr_10yr: number | null;
  look_through_pb: number | null;
  arbitrage_gap: number;
  family_stake_pct: number;
  family_stake_flag: boolean;
  quadrant: string;
  roe: number | null;
  tangible_bvps: number | null;
  net_cash_per_share: number | null;
  market_cap: number;
}

export interface CompoundingDiscountSummary {
  quadrant_counts: Record<string, number>;
  total_in_opportunity: number;
  avg_cagr_opportunity: number;
  avg_pb_opportunity: number;
  best_opportunity: {
    ticker: string | null;
    bvps_cagr_5yr: number | null;
    pb_ratio: number | null;
    look_through_pb: number | null;
  };
  getty_gap_count: number;
}

export interface BVPSTrailPoint {
  year: number;
  bvps: number;
  price: number;
  pb_ratio: number;
}

export interface BVPSTrail {
  ticker: string;
  current_bvps: number;
  current_price: number;
  current_pb: number;
  look_through_pb: number | null;
  bvps_cagr: number;
  years: number;
  points: BVPSTrailPoint[];
}

export async function computeCompoundingDiscount(universe?: string[]): Promise<{ computed_count: number }> {
  const resp = await fetch(`${API_BASE_URL}/mcp/finance.compute_compounding_discount`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ universe }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function fetchCompoundingDiscountPositions(params?: {
  universe?: string[];
  quadrant?: string;
  min_cagr?: number;
  max_pb?: number;
  limit?: number;
}): Promise<{ rows: CompoundingDiscountPosition[] }> {
  const resp = await fetch(`${API_BASE_URL}/mcp/finance.query_compounding_discount`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params || {}),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function fetchCompoundingDiscountSummary(params?: {
  universe?: string[];
}): Promise<CompoundingDiscountSummary> {
  const resp = await fetch(`${API_BASE_URL}/mcp/finance.query_compounding_discount_summary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params || {}),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// ============================================================================
// Price History
// ============================================================================

export interface PricePoint {
  date: string;
  close: number;
}

/**
 * Fetch price history for a ticker.
 * Uses price_history table (populated by /ingest/yfinance) if available;
 * falls back to quarterly snapshots from fundamentals.
 * Response: { ticker, data: [{date, close}], count, source }
 */
export async function fetchPriceHistory(ticker: string): Promise<PricePoint[]> {
  const resp = await fetch(
    `${API_BASE_URL}/api/price_history/${encodeURIComponent(ticker.toUpperCase())}?period=5y`
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  return (json.data || []).filter((p: any) => p.date && p.close != null) as PricePoint[];
}

export async function simulateBVPSTrail(params: {
  ticker: string;
  years?: number;
  steps?: number;
}): Promise<BVPSTrail> {
  const resp = await fetch(`${API_BASE_URL}/mcp/finance.simulate_bvps_trail`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}
