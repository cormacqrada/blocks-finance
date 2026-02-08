// Local RecipeDefinition type (not available from @blocks-ecosystem/runtime)
export interface RecipeDefinition {
  id: string;
  name: string;
  kind: string;
  logic: {
    tools: Array<{ name: string; label: string }>;
    parameters?: Record<string, any>;
  };
  presentation?: {
    defaultView?: string;
    views?: Array<{ type: string; config?: Record<string, any> }>;
  };
}

export type RecipeTrustTier = "core" | "commons" | "thirdParty";

export interface RecipeManifest {
  /** Package that contributes these recipes, e.g. "@blocks-finance/recipes". */
  packageName: string;
  /** Optional human-friendly namespace, e.g. "Finance". */
  namespace?: string;
  recipes: RecipeDefinition[];
}

export interface RecipeSource {
  /** Stable identifier for the source, typically matching the package name. */
  id: string;
  trustTier: RecipeTrustTier;
  manifest: RecipeManifest;
}

export interface RecipeRegistryEntry extends RecipeDefinition {
  /** Which manifest/source this recipe came from. */
  sourceId: string;
  trustTier: RecipeTrustTier;
}

export interface RecipeRegistry {
  entries: RecipeRegistryEntry[];
}

export interface LoadRecipeRegistryOptions {
  sources: RecipeSource[];
  minTrust?: RecipeTrustTier;
}

const TRUST_RANK: Record<RecipeTrustTier, number> = {
  core: 3,
  commons: 2,
  thirdParty: 1,
};

export function loadRecipeRegistry(options: LoadRecipeRegistryOptions): RecipeRegistry {
  const { sources, minTrust = "thirdParty" } = options;
  const minRank = TRUST_RANK[minTrust];
  const byId = new Map<string, RecipeRegistryEntry>();

  for (const source of sources) {
    const rank = TRUST_RANK[source.trustTier];
    if (rank < minRank) continue;

    for (const entry of source.manifest.recipes) {
      const merged: RecipeRegistryEntry = {
        ...entry,
        sourceId: source.id,
        trustTier: source.trustTier,
      };
      const existing = byId.get(entry.id);
      if (!existing) {
        byId.set(entry.id, merged);
        continue;
      }
      const existingRank = TRUST_RANK[existing.trustTier];
      byId.set(entry.id, rank >= existingRank ? merged : existing);
    }
  }

  return { entries: [...byId.values()] };
}

export function listRecipes(
  registry: RecipeRegistry,
  filter?: { kind?: string; trustAtLeast?: RecipeTrustTier },
): RecipeRegistryEntry[] {
  const minRank = filter?.trustAtLeast ? TRUST_RANK[filter.trustAtLeast] : 1;
  return registry.entries.filter((r) => {
    if (filter?.kind && r.kind !== filter.kind) return false;
    if (TRUST_RANK[r.trustTier] < minRank) return false;
    return true;
  });
}

export function getRecipeById(
  registry: RecipeRegistry,
  id: string,
): RecipeRegistryEntry | undefined {
  return registry.entries.find((r) => r.id === id);
}
