/**
 * API client for blocks-finance backend MCP endpoints.
 *
 * Resilience: every GET-style call (the query endpoints below) goes through
 * cachedFetch, which implements stale-while-revalidate backed by sessionStorage:
 *   - On refresh, the last successful response is returned INSTANTLY from cache,
 *     so panels render with data instead of spinners while the refetch runs.
 *   - Only the very first load (no cache) waits on the network and may show a
 *     spinner.
 *   - Each request has a 12s timeout and one retry, so a transient backend
 *     slow-down (Render cold start, ingestion in flight) falls back to stale
 *     cache instead of hanging the UI.
 * POST mutations (createFormula, saveScreen, compute*) bypass the cache.
 */

// Use environment variable for production, fallback to localhost for dev
export const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";
const API_BASE_URL = API_BASE;

// ─── Stale-while-revalidate cache layer ─────────────────────────────────────

const CACHE_PREFIX = "bfin-cache:";
const REQUEST_TIMEOUT_MS = 12000;
// In-flight fetches deduplicated by cache key so N panels requesting the same
// endpoint share one network round-trip.
const _inflight: Map<string, Promise<any>> = new Map();

interface CacheEntry {
  ts: number;
  data: any;
}

function _cacheGet(key: string): CacheEntry | null {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry;
  } catch {
    return null;
  }
}

function _cacheSet(key: string, data: any): void {
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // sessionStorage full or unavailable — degrade gracefully, no caching.
  }
}

/**
 * Fetch with a timeout via AbortController. Returns parsed JSON.
 * Throws on non-2xx or network/timeout error.
 */
async function _fetchWithTimeout(url: string, init: RequestInit = {}): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { ...init, signal: ctrl.signal });
    if (!resp.ok) {
      // Try to surface the backend's error detail for non-GETs.
      const body = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status} ${body.slice(0, 120)}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stale-while-revalidate fetch for read endpoints.
 *
 * 1. If a cached entry exists, resolve with it immediately AND kick off a
 *    background refetch that updates the cache (and resolves the returned
 *    promise a second time only if you await the refetch handle).
 * 2. If no cache, perform the network fetch (deduped across concurrent
 *    callers), cache the result, and resolve.
 * 3. On network failure, fall back to stale cache if available; only throw if
 *    there is no cache at all.
 *
 * Returns { data, fromCache } so callers can optionally show a "refreshing"
 * badge when fromCache is true.
 */
export interface CachedResult<T> {
  data: T;
  fromCache: boolean;
}

export async function cachedFetch<T = any>(
  url: string,
  init?: RequestInit,
  opts?: { method?: "GET" | "POST"; body?: any },
): Promise<CachedResult<T>> {
  const method = (opts?.method || (init?.method as string) || "GET").toUpperCase();
  const body = opts?.body ?? (init?.body ? JSON.parse(init.body as string) : undefined);
  const cacheKey = `${method}:${url}:${body ? JSON.stringify(body) : ""}`;

  const cached = _cacheGet(cacheKey);

  const networkFetch = async (): Promise<T> => {
    // Dedupe concurrent identical requests.
    const existing = _inflight.get(cacheKey);
    if (existing) return existing as Promise<T>;
    const p = (async () => {
      const reqInit: RequestInit = init || {};
      if (method === "POST") {
        reqInit.method = "POST";
        reqInit.headers = { "Content-Type": "application/json", ...(reqInit.headers as any) };
        reqInit.body = body !== undefined ? JSON.stringify(body) : reqInit.body;
      }
      // One retry on transient failure before giving up.
      try {
        const data = await _fetchWithTimeout(url, reqInit);
        _cacheSet(cacheKey, data);
        return data as T;
      } catch (err) {
        // Retry once (handles cold-start hiccup / momentary blip).
        const data = await _fetchWithTimeout(url, reqInit);
        _cacheSet(cacheKey, data);
        return data as T;
      }
    })();
    _inflight.set(cacheKey, p);
    try {
      return await p;
    } finally {
      _inflight.delete(cacheKey);
    }
  };

  if (cached) {
    // Revalidate in the background; swallow errors (stale data is still shown).
    networkFetch().catch(() => { /* keep stale cache on failure */ });
    return { data: cached.data as T, fromCache: true };
  }

  // No cache: must wait for the network. On failure, there's nothing to show.
  const data = await networkFetch();
  return { data, fromCache: false };
}

/** Clear all cached responses (e.g. after a manual data refresh). */
export function clearApiCache(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // ignore
  }
}

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
// Query (read) functions use cachedFetch for stale-while-revalidate so a page
// refresh renders the last-good data instantly instead of showing spinners.
// Mutation functions (create/save/compute) stay uncached.

export async function fetchFormulas(category?: string): Promise<{ formulas: Formula[]; fields: string[] }> {
  const url = category
    ? `${API_BASE_URL}/mcp/formula.list?category=${encodeURIComponent(category)}`
    : `${API_BASE_URL}/mcp/formula.list`;
  const { data } = await cachedFetch(url);
  return data;
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
  const { data } = await cachedFetch(
    `${API_BASE_URL}/mcp/formula.validate`,
    undefined,
    { method: "POST", body: { expression } },
  );
  return data;
}

export async function evaluateFormula(params: {
  expression?: string;
  formula_id?: string;
  universe?: string[];
  as_of?: string;
}): Promise<{ results: Array<{ ticker: string; as_of: string; value: number | null; error?: string }> }> {
  const { data } = await cachedFetch(
    `${API_BASE_URL}/mcp/formula.evaluate`,
    undefined,
    { method: "POST", body: params },
  );
  return data;
}

export async function runScreen(params: {
  filters?: ScreenFilter[];
  rank_by?: string;
  rank_order?: "ASC" | "DESC";
  columns?: string[];
  formulas?: string[];
  limit?: number;
}): Promise<ScreenResult> {
  const { data } = await cachedFetch(
    `${API_BASE_URL}/mcp/screen.run`,
    undefined,
    { method: "POST", body: params },
  );
  return data;
}

// Alias for torque components
export const fetchScreenData = runScreen;

export async function fetchScreens(): Promise<{ screens: ScreenDefinition[] }> {
  const { data } = await cachedFetch(`${API_BASE_URL}/mcp/screen.list`);
  return data;
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
  const { data } = await cachedFetch(
    `${API_BASE_URL}/mcp/finance.query_greenblatt_scores`,
    undefined,
    { method: "POST", body: params || {} },
  );
  return data;
}

export async function fetchFundamentalsFields(): Promise<{
  fields: string[];
  categories: Record<string, string[]>;
}> {
  const { data } = await cachedFetch(`${API_BASE_URL}/mcp/fundamentals.fields`);
  return data;
}

export async function computeAllFormulas(universe?: string[]): Promise<{ computed_count: number }> {
  // Mutation: triggers a backend recompute, not a cached read.
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
  const { data } = await cachedFetch(
    `${API_BASE_URL}/mcp/finance.query_value_compression`,
    undefined,
    { method: "POST", body: params || {} },
  );
  return data;
}

export async function computeValueCompressionScores(universe?: string[]): Promise<{ computed_count: number }> {
  // Mutation: triggers a backend recompute.
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
  // Mutation: triggers a backend recompute.
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
  const { data } = await cachedFetch(
    `${API_BASE_URL}/mcp/finance.query_vrr`,
    undefined,
    { method: "POST", body: params || {} },
  );
  return data;
}

export async function fetchVRRSummary(params?: {
  universe?: string[];
}): Promise<VRRSummary> {
  const { data } = await cachedFetch(
    `${API_BASE_URL}/mcp/finance.query_vrr_summary`,
    undefined,
    { method: "POST", body: params || {} },
  );
  return data;
}

export async function simulateMarginalIRR(params: {
  ticker: string;
  horizon_years?: number;
  hurdle_rate?: number;
  edge_estimate?: number;
  capital_steps?: number;
}): Promise<IRRSimulation> {
  const { data } = await cachedFetch(
    `${API_BASE_URL}/mcp/finance.simulate_marginal_irr`,
    undefined,
    { method: "POST", body: params },
  );
  return data;
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
  // Mutation: triggers a backend recompute.
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
  const { data } = await cachedFetch(
    `${API_BASE_URL}/mcp/finance.query_compounding_discount`,
    undefined,
    { method: "POST", body: params || {} },
  );
  return data;
}

export async function fetchCompoundingDiscountSummary(params?: {
  universe?: string[];
}): Promise<CompoundingDiscountSummary> {
  const { data } = await cachedFetch(
    `${API_BASE_URL}/mcp/finance.query_compounding_discount_summary`,
    undefined,
    { method: "POST", body: params || {} },
  );
  return data;
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
 * Uses price_history table (populated by /ingest/fmp_prices or yfinance) if
 * available; falls back to quarterly snapshots from fundamentals.
 * Response: { ticker, data: [{date, close}], count, source }
 */
export async function fetchPriceHistory(ticker: string): Promise<PricePoint[]> {
  const { data } = await cachedFetch(
    `${API_BASE_URL}/api/price_history/${encodeURIComponent(ticker.toUpperCase())}?period=5y`,
  );
  const json = data as { data?: any[] };
  return (json.data || []).filter((p: any) => p.date && p.close != null) as PricePoint[];
}

// ============================================================================
// Alternative-data + per-ticker history endpoints (cached reads)
// These back the whale / macro / insider / news panels and the per-ticker
// history charts. Routing them through cachedFetch means a dashboard
// re-render (e.g. adding a panel, which destroys + recreates every panel)
// paints the last-good data instantly from sessionStorage instead of
// flashing a spinner while the network refetch runs in the background.
// ============================================================================

export async function fetchWhaleActivity(limit = 30): Promise<any> {
  const { data } = await cachedFetch(`${API_BASE_URL}/api/whale_activity?limit=${limit}`);
  return data;
}

export async function fetchMacroOverview(): Promise<any> {
  const { data } = await cachedFetch(`${API_BASE_URL}/api/macro_overview`);
  return data;
}

export async function fetchMacroSeries(series: string, period = "2y"): Promise<any> {
  const { data } = await cachedFetch(
    `${API_BASE_URL}/api/macro/${encodeURIComponent(series)}?period=${period}`,
  );
  return data;
}

export async function fetchInsiderTransactions(ticker: string, limit = 20): Promise<any> {
  const { data } = await cachedFetch(
    `${API_BASE_URL}/api/insider_transactions/${encodeURIComponent(ticker.toUpperCase())}?limit=${limit}`,
  );
  return data;
}

export async function fetchCompanyNews(ticker: string, limit = 15): Promise<any> {
  const { data } = await cachedFetch(
    `${API_BASE_URL}/api/company_news/${encodeURIComponent(ticker.toUpperCase())}?limit=${limit}`,
  );
  return data;
}

export async function fetchAnalystRecommendations(ticker: string): Promise<any> {
  const { data } = await cachedFetch(
    `${API_BASE_URL}/api/analyst_recommendations/${encodeURIComponent(ticker.toUpperCase())}`,
  );
  return data;
}

export async function fetchWhaleHoldings(ticker: string): Promise<any> {
  const { data } = await cachedFetch(
    `${API_BASE_URL}/api/whale_holdings/${encodeURIComponent(ticker.toUpperCase())}`,
  );
  return data;
}

export async function fetchEarningsHistory(ticker: string): Promise<any[]> {
  const { data } = await cachedFetch(
    `${API_BASE_URL}/api/earnings_history/${encodeURIComponent(ticker.toUpperCase())}`,
  );
  const json = data as { data?: any[] };
  return json.data || [];
}

export async function simulateBVPSTrail(params: {
  ticker: string;
  years?: number;
  steps?: number;
}): Promise<BVPSTrail> {
  const { data } = await cachedFetch(
    `${API_BASE_URL}/mcp/finance.simulate_bvps_trail`,
    undefined,
    { method: "POST", body: params },
  );
  return data;
}
