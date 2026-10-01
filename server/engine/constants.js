// Size bands by followers on the platform used (spec section 3).
// "big" marks the bands above 350k followers, which the "maximum creators
// above 350k" constraint counts.
export const SIZE_BANDS = [
  { key: 'nano_1k_10k', label: 'Nano 1k–10k', tier: 'Nano', min: 1_000, max: 10_000 },
  { key: 'micro_10k_25k', label: 'Micro 10k–25k', tier: 'Micro', min: 10_000, max: 25_000 },
  { key: 'micro_25k_50k', label: 'Micro 25k–50k', tier: 'Micro', min: 25_000, max: 50_000 },
  { key: 'micro_50k_75k', label: 'Micro 50k–75k', tier: 'Micro', min: 50_000, max: 75_000 },
  { key: 'micro_75k_100k', label: 'Micro 75k–100k', tier: 'Micro', min: 75_000, max: 100_000 },
  { key: 'mid_100k_150k', label: 'Mid 100k–150k', tier: 'Mid', min: 100_000, max: 150_000 },
  { key: 'mid_150k_250k', label: 'Mid 150k–250k', tier: 'Mid', min: 150_000, max: 250_000 },
  { key: 'mid_250k_350k', label: 'Mid 250k–350k', tier: 'Mid', min: 250_000, max: 350_000 },
  { key: 'macro_350k_1m', label: 'Macro 350k–1M', tier: 'Macro', min: 350_000, max: 1_000_000, big: true },
  { key: 'celebrity_1m', label: 'Celebrity 1M+', tier: 'Celebrity', min: 1_000_000, max: Infinity, big: true },
];

export const SIZE_BY_KEY = Object.fromEntries(SIZE_BANDS.map((b) => [b.key, b]));
export const NANO_KEY = 'nano_1k_10k';

export function sizeBandFor(followers) {
  if (!followers || followers < 1_000) return null;
  return SIZE_BANDS.find((b) => followers >= b.min && followers < b.max)?.key ?? null;
}

export const PLATFORMS = ['TikTok', 'Instagram', 'YouTube'];
export const OBJECTIVES = ['Performance', 'Balanced', 'Content'];

// Fallback order when an archetype is Low confidence (spec section 3).
export const LEVELS = [
  { level: 1, label: 'market + platform + niche + size', dims: ['market', 'platform', 'niche'] },
  { level: 2, label: 'market + platform + size', dims: ['market', 'platform'] },
  { level: 3, label: 'market + niche + size', dims: ['market', 'niche'] },
  { level: 4, label: 'market + size', dims: ['market'] },
  { level: 5, label: 'platform + size', dims: ['platform'] },
  { level: 6, label: 'size only', dims: [] },
];

// Settings and defaults (spec section 6). Stored in pc_settings and editable
// in the app; these are the values used when nothing is stored.
export const DEFAULT_SETTINGS = {
  targetMargin: 0.5,
  promisePercentile: 10,
  simulationRuns: 5000,
  planningPercentile: 65,
  giftingCostPerCreatorGbp: null, // "Set from Richie's campaigns" — must be entered
  giftedPostingRate: 0.5,
  reachRatio: 0.85,
  boostingCostPer1000Usd: 6,
  firstOfferShare: 0.85,
  balancedSizeBonus: 0.05,
  balancedCreatorBonus: 0.01,
  confidenceHigh: 10,
  confidenceMedium: 5,
  outlierFollowerMultiple: 5,
  outlierMaxViews: 10_000_000,
  minimumBudgetGbp: 5000,
  marginWarning: 0.4,
  optimiserStepGbp: 25,
  historicalCreatorMoneyShare: 0.31,
  defaultVideosPerCreator: 3,
  // Which campaigns feed the rate table: Pipedrive account owners (team.id).
  // 9 = Ritchie Boubouli. Empty list = every campaign.
  rateOwnerIds: [9],
  keptGroupPattern: 'final|approved|live|gifting|gifted',
  droppedGroupPattern: 'pass|maybe|creators? list|dropped out|not available',
};
