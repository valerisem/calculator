import { NANO_KEY, SIZE_BANDS, SIZE_BY_KEY } from './constants.js';
import { optimise } from './optimiser.js';
import { multiVideoFactor, pickArchetype } from './rates.js';
import { hashString } from './stats.js';
import { simulateViews } from './simulate.js';

const num = (v, d = 0) => (v === '' || v == null || Number.isNaN(Number(v)) ? d : Number(v));
const optNum = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

export function normaliseInputs(raw, settings) {
  const allowed = Array.isArray(raw.allowedSizes) && raw.allowedSizes.length
    ? raw.allowedSizes.filter((k) => SIZE_BY_KEY[k])
    : SIZE_BANDS.map((b) => b.key);
  return {
    mode: raw.mode === 'package' ? 'package' : 'budget',
    currency: raw.currency || 'GBP',
    budget: num(raw.budget),
    market: raw.market || null,
    platform: raw.platform || 'TikTok',
    niche: raw.niche || null,
    objective: ['Performance', 'Balanced', 'Content'].includes(raw.objective) ? raw.objective : 'Balanced',
    margin: raw.margin == null || raw.margin === '' ? settings.targetMargin : num(raw.margin),
    videosPerCreator: Math.max(1, Math.round(num(raw.videosPerCreator, settings.defaultVideosPerCreator))),
    gifted: Math.max(0, Math.round(num(raw.gifted))),
    boosting: num(raw.boosting),
    paidMedia: num(raw.paidMedia),
    otherCosts: num(raw.otherCosts),
    requiredVideos: optNum(raw.requiredVideos),
    minCreators: optNum(raw.minCreators),
    maxCreators: optNum(raw.maxCreators),
    maxBigCreators: optNum(raw.maxBigCreators),
    allowedSizes: allowed,
    package: Object.fromEntries(
      Object.entries(raw.package || {})
        .filter(([k, n]) => SIZE_BY_KEY[k] && num(n) > 0)
        .map(([k, n]) => [k, Math.round(num(n))]),
    ),
    agreedPrice: optNum(raw.agreedPrice),
  };
}

/**
 * Runs the calculator.
 * @param {object} rawInputs see normaliseInputs
 * @param {{archetypes:object[], factors:object, settings:object, fx:Record<string,number>}} ctx
 *   fx: units of each currency per 1 GBP
 */
export function calculate(rawInputs, ctx) {
  const { archetypes, factors, settings, fx } = ctx;
  const inp = normaliseInputs(rawInputs, settings);
  const rate = fx[inp.currency];
  if (!rate) return fail(`No exchange rate for ${inp.currency}.`);
  const toGbp = (x) => x / rate;
  const fromGbp = (x) => x * rate;
  const warnings = [];
  const M = inp.margin;
  const v = inp.videosPerCreator;
  if (!(M >= 0 && M < 1)) return fail('Target margin must be between 0% and 99%.');
  if (!inp.market) return fail('Choose a market.');

  // Section 3: rate row per size, with fallback.
  const sizes = {};
  for (const band of SIZE_BANDS) {
    const row = pickArchetype(archetypes, { market: inp.market, platform: inp.platform, niche: inp.niche, size: band.key });
    if (!row) continue;
    const F = multiVideoFactor(factors, band.key, v);
    sizes[band.key] = {
      size: band.key,
      label: band.label,
      big: !!band.big,
      confidence: row.confidence,
      level: row.level,
      levelLabel: row.levelLabel,
      lowFallback: row.lowFallback,
      records: Math.min(row.n_cost, row.n_views),
      costP50: row.cost_p50,
      costP65: row.cost_p65,
      viewsP25: row.views_p25,
      viewsP50: row.views_p50,
      viewsP75: row.views_p75,
      factor: F,
      packageCostGbp: v * row.cost_p65 * F,
      packageViewsP25: v * row.views_p25,
    };
  }

  const g = settings.giftingCostPerCreatorGbp;
  if (inp.gifted > 0 && g == null) warnings.push('Gifting cost per creator is not set in Settings; gifting is costed at 0.');
  const giftingGbp = inp.gifted * (g || 0);
  const otherGbp = toGbp(inp.boosting) + toGbp(inp.paidMedia) + toGbp(inp.otherCosts) + giftingGbp;
  const giftedPosts = Math.floor(inp.gifted * settings.giftedPostingRate);

  let counts;
  let priceGbp;
  let creatorMoneyGbp;
  let optimiserStep = null;

  if (inp.mode === 'budget') {
    if (!(inp.budget > 0)) return fail('Enter the client budget.');
    priceGbp = toGbp(inp.budget);
    creatorMoneyGbp = priceGbp * (1 - M) - otherGbp;
    if (creatorMoneyGbp <= 0) return fail('Budget too small for these costs.');
    const options = inp.allowedSizes
      .filter((k) => sizes[k])
      .map((k) => ({ key: k, cost: sizes[k].packageCostGbp, views: sizes[k].packageViewsP25, big: sizes[k].big }));
    if (!options.length) return fail('No rate data for the allowed sizes in this market.');
    const minFromVideos = inp.requiredVideos ? Math.ceil(Math.max(0, inp.requiredVideos - giftedPosts) / v) : 0;
    const res = optimise({
      options,
      creatorMoney: creatorMoneyGbp,
      objective: inp.objective,
      step: settings.optimiserStepGbp,
      minCreators: Math.max(inp.minCreators || 0, minFromVideos),
      maxCreators: inp.maxCreators,
      maxBig: inp.maxBigCreators,
      sizeBonus: settings.balancedSizeBonus,
      creatorBonus: settings.balancedCreatorBonus,
    });
    if (!res.feasible) return fail(res.reason);
    counts = res.counts;
    optimiserStep = res.step;
    if (res.step > settings.optimiserStepGbp) {
      warnings.push(`Large budget: the optimiser searched in £${res.step} steps instead of £${settings.optimiserStepGbp}.`);
    }
  } else {
    counts = {};
    for (const [k, n] of Object.entries(inp.package)) {
      if (!sizes[k]) {
        warnings.push(`No rate data for ${SIZE_BY_KEY[k].label} in this market; left out.`);
        continue;
      }
      counts[k] = n;
    }
    if (!Object.keys(counts).length) return fail('Add at least one creator to the package.');
    const K = Object.entries(counts).reduce((s, [k, n]) => s + n * sizes[k].packageCostGbp, 0) + otherGbp;
    priceGbp = K / (1 - M);
    // Quote in whole currency units, rounded up so the margin is never below target.
    priceGbp = toGbp(Math.ceil(fromGbp(priceGbp)));
    creatorMoneyGbp = K - otherGbp;
  }

  const lines = SIZE_BANDS.filter((b) => counts[b.key]).map((b) => ({ ...sizes[b.key], count: counts[b.key] }));
  const allocatedGbp = lines.reduce((s, l) => s + l.count * l.packageCostGbp, 0);
  const totalCreators = lines.reduce((s, l) => s + l.count, 0);
  const totalVideos = totalCreators * v + giftedPosts;

  // Section 4, step 4: simulation.
  const nano = sizes[NANO_KEY];
  if (inp.gifted > 0 && !nano) warnings.push('No nano-size rate data, so gifted posts add no views.');
  const seed = hashString(JSON.stringify([counts, v, inp.gifted, inp.market, inp.platform, inp.niche]));
  const sim = simulateViews(
    lines.map((l) => ({ count: l.count, videos: v, p25: l.viewsP25, p50: l.viewsP50, p75: l.viewsP75 })),
    nano ? { count: inp.gifted, postingRate: settings.giftedPostingRate, p25: nano.viewsP25, p50: nano.viewsP50, p75: nano.viewsP75 } : null,
    { runs: settings.simulationRuns, seed },
  );
  const promiseRaw = sim.percentile(settings.promisePercentile);
  const viewsPromised = Math.floor(promiseRaw / 10_000) * 10_000;
  const price = fromGbp(priceGbp);
  const boostPer1000 = (settings.boostingCostPer1000Usd / (fx.USD || 1)) * rate;
  const deliveryGbp = allocatedGbp + otherGbp;
  const expectedMargin = (priceGbp - deliveryGbp) / priceGbp;
  const realMargin = inp.agreedPrice ? (inp.agreedPrice - fromGbp(deliveryGbp)) / inp.agreedPrice : null;

  if (priceGbp < settings.minimumBudgetGbp) warnings.push(`Budget is below the £${settings.minimumBudgetGbp.toLocaleString('en-GB')} minimum.`);
  if (expectedMargin < settings.marginWarning) warnings.push(`Expected margin ${(expectedMargin * 100).toFixed(1)}% is below ${settings.marginWarning * 100}%.`);
  if (realMargin != null && realMargin < settings.marginWarning) warnings.push(`Margin at the agreed price is ${(realMargin * 100).toFixed(1)}%, below ${settings.marginWarning * 100}%.`);
  for (const l of lines) {
    if (l.lowFallback) warnings.push(`${l.label}: only Low-confidence data (${l.records} records, ${l.levelLabel}).`);
  }
  if (viewsPromised === 0) warnings.push('Views we promise round down to 0 (under 10,000).');

  // Section 4, step 5: campaign team brief.
  let n0 = 1;
  const brief = lines.map((l) => {
    const from = n0;
    n0 += l.count;
    return {
      creators: l.count === 1 ? `Creator ${from}` : `Creators ${from}–${n0 - 1}`,
      size: l.label,
      count: l.count,
      followers: l.label.replace(/^\w+\s/, ''),
      targetViewsPerVideo: Math.round(l.viewsP50),
      videos: v,
      firstOfferPerVideo: round2(fromGbp(settings.firstOfferShare * l.costP50)),
      maxFeePerVideo: round2(fromGbp(l.costP65 * l.factor)),
      text: `${l.count === 1 ? `Creator ${from}` : `Creators ${from}–${n0 - 1}`}: ${l.label}, about ${Math.round(l.viewsP50).toLocaleString('en-GB')} views per video, ${v} videos`,
    };
  });

  return {
    ok: true,
    mode: inp.mode,
    inputs: inp,
    currency: inp.currency,
    fxPerGbp: rate,
    client: {
      price: round2(price),
      currency: inp.currency,
      creators: lines.map((l) => ({ size: l.size, label: l.label, count: l.count, videosEach: v, videos: l.count * v })),
      totalCreators,
      totalVideos,
      giftedCreators: inp.gifted,
      giftedPosts,
      viewsPromised,
      reachPromised: Math.floor(viewsPromised * settings.reachRatio),
      cpm: viewsPromised ? round2((price / viewsPromised) * 1000) : null,
      cpv: viewsPromised ? round4(price / viewsPromised) : null,
      boostedViews: inp.boosting > 0 ? Math.floor((inp.boosting / boostPer1000) * 1000) : 0,
    },
    internal: {
      viewsExpected: Math.round(sim.p50),
      viewsUpside: Math.round(sim.p75),
      creatorMoney: round2(fromGbp(creatorMoneyGbp)),
      creatorMoneyAllocated: round2(fromGbp(allocatedGbp)),
      buffer: round2(fromGbp(Math.max(0, creatorMoneyGbp - allocatedGbp))),
      costs: {
        creators: round2(fromGbp(allocatedGbp)),
        boosting: inp.boosting,
        paidMedia: inp.paidMedia,
        gifting: round2(fromGbp(giftingGbp)),
        other: inp.otherCosts,
        total: round2(fromGbp(deliveryGbp)),
      },
      expectedMargin: round4(expectedMargin),
      agreedPrice: inp.agreedPrice,
      realMargin: realMargin == null ? null : round4(realMargin),
      creatorMoneyShare: round4(creatorMoneyGbp / priceGbp),
      historicalCreatorMoneyShare: settings.historicalCreatorMoneyShare,
      optimiserStepGbp: optimiserStep,
      sizes: Object.values(sizes).map((s) => ({
        size: s.size,
        label: s.label,
        confidence: s.confidence,
        level: s.levelLabel,
        records: s.records,
        costP50: round2(fromGbp(s.costP50)),
        costP65: round2(fromGbp(s.costP65)),
        factor: round4(s.factor),
        packageCost: round2(fromGbp(s.packageCostGbp)),
        viewsP25: Math.round(s.viewsP25),
        viewsP50: Math.round(s.viewsP50),
        viewsP75: Math.round(s.viewsP75),
        used: !!counts[s.size],
      })),
      brief,
    },
    warnings,
  };
}

function fail(error) {
  return { ok: false, error };
}
const round2 = (x) => Math.round(x * 100) / 100;
const round4 = (x) => Math.round(x * 10000) / 10000;
