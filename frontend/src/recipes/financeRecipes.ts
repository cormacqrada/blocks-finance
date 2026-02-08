import { loadRecipeRegistry } from "./registry";
import type { RecipeManifest, RecipeRegistry, RecipeDefinition } from "./registry";

export const FINANCE_RECIPES_MANIFEST: RecipeManifest = {
  packageName: "@blocks-finance/recipes",
  namespace: "Finance",
  recipes: [
    // === Greenblatt / Magic Formula ===
    {
      id: "recipe:greenblatt-top-n-table",
      name: "Top N Greenblatt Stocks",
      kind: "widget",
      logic: {
        tools: [
          {
            name: "finance.query_greenblatt_scores",
            label: "Query Greenblatt scores",
          },
        ],
        parameters: {
          limit: 20,
        },
      },
      presentation: {
        defaultView: "widget",
        views: [
          {
            type: "widget",
            config: {
              widgetKind: "table",
            },
          },
        ],
      },
    } satisfies RecipeDefinition,
    {
      id: "recipe:greenblatt-ticker-detail",
      name: "Greenblatt Ticker Detail",
      kind: "widget",
      logic: {
        tools: [
          {
            name: "finance.query_greenblatt_scores",
            label: "Query Greenblatt scores",
          },
        ],
        parameters: {
          universe: [],
          limit: 1,
        },
      },
      presentation: {
        defaultView: "widget",
        views: [
          {
            type: "widget",
            config: {
              widgetKind: "detail",
            },
          },
        ],
      },
    } satisfies RecipeDefinition,
    
    // === Margin of Safety Screens ===
    {
      id: "recipe:margin-of-safety-screen",
      name: "Margin of Safety Screen",
      kind: "screener",
      logic: {
        tools: [
          {
            name: "screen.run",
            label: "Run value screen",
          },
        ],
        parameters: {
          filters: [
            { field: "pe_ratio", op: "<", value: 15 },
            { field: "pb_ratio", op: "<", value: 1.5 },
          ],
          rank_by: "pe_ratio",
          rank_order: "ASC",
          columns: ["ticker", "price", "pe_ratio", "pb_ratio", "eps", "book_value_per_share"],
          formulas: ["formula:graham_number", "formula:margin_of_safety"],
          limit: 20,
        },
      },
      presentation: {
        defaultView: "widget",
        views: [
          {
            type: "widget",
            config: {
              widgetKind: "screener",
            },
          },
        ],
      },
    } satisfies RecipeDefinition,
    
    // === Quality + Value Screen ===
    {
      id: "recipe:quality-value-screen",
      name: "Quality + Value Screen",
      kind: "screener",
      logic: {
        tools: [
          {
            name: "screen.run",
            label: "Run quality value screen",
          },
        ],
        parameters: {
          filters: [
            { field: "gross_margin", op: ">", value: 40 },
            { field: "debt_to_equity", op: "<", value: 0.5 },
            { field: "pe_ratio", op: "<", value: 25 },
          ],
          rank_by: "gross_margin",
          rank_order: "DESC",
          columns: ["ticker", "price", "pe_ratio", "gross_margin", "operating_margin", "debt_to_equity"],
          formulas: ["formula:quality_score", "formula:roic"],
          limit: 20,
        },
      },
      presentation: {
        defaultView: "widget",
        views: [
          {
            type: "widget",
            config: {
              widgetKind: "screener",
            },
          },
        ],
      },
    } satisfies RecipeDefinition,
    
    // === Pricing Power Screen ===
    {
      id: "recipe:pricing-power-screen",
      name: "Pricing Power Screen",
      kind: "screener",
      logic: {
        tools: [
          {
            name: "screen.run",
            label: "Run pricing power screen",
          },
        ],
        parameters: {
          filters: [
            { field: "revenue_growth_yoy", op: ">", value: 5 },
            { field: "gross_margin", op: ">", value: 35 },
          ],
          rank_by: "gross_margin",
          rank_order: "DESC",
          columns: ["ticker", "price", "revenue", "revenue_growth_yoy", "gross_margin", "operating_margin"],
          formulas: ["formula:pricing_power_score"],
          limit: 20,
        },
      },
      presentation: {
        defaultView: "widget",
        views: [
          {
            type: "widget",
            config: {
              widgetKind: "screener",
            },
          },
        ],
      },
    } satisfies RecipeDefinition,
    
    // === Torque / Turnaround Screen ===
    {
      id: "recipe:torque-screen",
      name: "Torque / Upside Screen",
      kind: "screener",
      logic: {
        tools: [
          {
            name: "screen.run",
            label: "Run torque screen",
          },
        ],
        parameters: {
          filters: [
            { field: "pe_ratio", op: "<", value: 20 },
            { field: "free_cash_flow", op: ">", value: 0 },
          ],
          rank_by: "eps_growth_yoy",
          rank_order: "DESC",
          columns: ["ticker", "price", "pe_ratio", "eps_growth_yoy", "revenue_growth_yoy", "free_cash_flow"],
          formulas: ["formula:torque_score", "formula:peg_ratio"],
          limit: 20,
        },
      },
      presentation: {
        defaultView: "widget",
        views: [
          {
            type: "widget",
            config: {
              widgetKind: "screener",
            },
          },
        ],
      },
    } satisfies RecipeDefinition,
    
    // === FCF Yield Screen ===
    {
      id: "recipe:fcf-yield-screen",
      name: "Free Cash Flow Yield Screen",
      kind: "screener",
      logic: {
        tools: [
          {
            name: "screen.run",
            label: "Run FCF yield screen",
          },
        ],
        parameters: {
          filters: [
            { field: "fcf_yield", op: ">", value: 5 },
            { field: "debt_to_equity", op: "<", value: 1 },
          ],
          rank_by: "fcf_yield",
          rank_order: "DESC",
          columns: ["ticker", "price", "market_cap", "free_cash_flow", "fcf_yield", "debt_to_equity"],
          formulas: ["formula:fcf_yield"],
          limit: 20,
        },
      },
      presentation: {
        defaultView: "widget",
        views: [
          {
            type: "widget",
            config: {
              widgetKind: "screener",
            },
          },
        ],
      },
    } satisfies RecipeDefinition,
    
    // === Dividend Value Screen ===
    {
      id: "recipe:dividend-value-screen",
      name: "Dividend Value Screen",
      kind: "screener",
      logic: {
        tools: [
          {
            name: "screen.run",
            label: "Run dividend value screen",
          },
        ],
        parameters: {
          filters: [
            { field: "dividend_yield", op: ">", value: 2 },
            { field: "payout_ratio", op: "<", value: 75 },
            { field: "debt_to_equity", op: "<", value: 1 },
          ],
          rank_by: "dividend_yield",
          rank_order: "DESC",
          columns: ["ticker", "price", "dividend_yield", "payout_ratio", "pe_ratio", "debt_to_equity"],
          formulas: [],
          limit: 20,
        },
      },
      presentation: {
        defaultView: "widget",
        views: [
          {
            type: "widget",
            config: {
              widgetKind: "screener",
            },
          },
        ],
      },
    } satisfies RecipeDefinition,
  ],
};

export const FINANCE_RECIPES_REGISTRY: RecipeRegistry = loadRecipeRegistry({
  sources: [
    {
      id: FINANCE_RECIPES_MANIFEST.packageName,
      trustTier: "core",
      manifest: FINANCE_RECIPES_MANIFEST,
    },
  ],
  minTrust: "core",
});
