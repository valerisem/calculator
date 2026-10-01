import { NANO_KEY, PLATFORMS, SIZE_BANDS, SIZE_BY_KEY } from './constants.js';
import { optimise } from './optimiser.js';
import { multiVideoFactor, pickArchetype, pickViewsRow } from './rates.js';
import { hashString } from './stats.js';
import { simulateViews } from './simulate.js';

const num = (v, d = 0) => (v === '' || v == null || Number.isNaN(Number(v)) ? d : Number(v));
const optNum = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const round2 = (x) => Math.round(x * 100) / 100;
const round4 = (x) => Math.round(x * 10000) / 10000;

export const USAGE_RIGHTS = ['organic', '30d', '3m', '6m', '12m', 'perpetual'];
export const EXCLUSIVITY = ['none', 'category', 'competitor'];
export const BOOST_PLATFORMS = ['TikTok', 'Instagram', 'YouTube', 'Other'];
export const ADJUSTMENT_REASONS = [
  'Client willingness to pay',
  'Competitive match',
  'Strategic / new logo',
  'Volume or repeat client',
  'Scope or risk',
  'Other',
];
export const PRICING_CONTEXTS = ['New business', 'Test campaign', 'Renewal', 'Upsell', 'Competitive pitch'];

// A creator type in a package: platform | market | size band.
export const comboKey = (platform, market, size) => `${platform}|${market}|${size}`;
const list = (many, one) => [...new Set((Array.isArray(many) ? many : []).concat(one ? [one] : []).filter(Boolean))];
const feeType = (t) => (t === 'fixed' ? 'fixed' : 'percent');

export function normaliseInputs(raw, settings) {
  const platforms = list(raw.platforms, raw.platform).filter((p) => PLATFORMS.includes(p));
  const markets = list(raw.markets, raw.market);
  if (!platforms.length) platforms.push('TikTok');
  // package: { "TikTok|UK|micro_25k_50k": 6 }. A bare size key means the first platform and market.
  const pkg = {};
  for (const [k, n] of Object.entries(raw.package || {})) {
    if (!(num(n) > 0)) continue;
    const parts = k.split('|');
    const [platform, market, size] = parts.length === 3 ? parts : [platforms[0], markets[0], k];
    if (!SIZE_BY_KEY[size] || !PLATFORMS.includes(platform) || !market) continue;
    const key = comboKey(platform, market, size);
    pkg[key] = (pkg[key] || 0) + Math.round(num(n));
  }
  const allowed = Array.isArray(raw.allowedSizes) && raw.allowedSizes.length
    ? raw.allowedSizes.filter((k) => SIZE_BY_KEY[k])
    : SIZE_BANDS.map((b) => b.key);

  // Boosting: one line per platform. Old saves had a single number.
  const boostRaw = Array.isArray(raw.boostingLines)
    ? raw.boostingLines
    : num(raw.boosting) > 0 ? [{ platform: platforms[0], budget: num(raw.boosting) }] : [];
  const boostingLines = boostRaw
    .map((b) => ({
      platform: BOOST_PLATFORMS.includes(b.platform) ? b.platform : 'Other',
      by: b.by === 'views' ? 'views' : 'budget',
      budget: num(b.budget),
      targetViews: num(b.targetViews),
      cpmUsd: optNum(b.cpmUsd),
      treatment: b.treatment === 'passthrough' ? 'passthrough' : 'margin',
      feeType: feeType(b.feeType),
      fee: num(b.fee),
    }))
    .filter((b) => (b.by === 'views' ? b.targetViews > 0 : b.budget > 0));

  // Paid media: pass-through spend plus a management fee. Old saves had a single number.
  const pm = raw.paidMedia && typeof raw.paidMedia === 'object' ? raw.paidMedia : { spend: num(raw.paidMedia) };
  const paidMedia = {
    platform: pm.platform || '',
    spend: num(pm.spend),
    feeType: feeType(pm.feeType ?? settings.paidMediaFeeType),
    fee: pm.fee == null || pm.fee === '' ? num(settings.paidMediaFee) : num(pm.fee),
  };

  const usage = {
    rights: USAGE_RIGHTS.includes(raw.usage?.rights) ? raw.usage.rights : 'organic',
    paidUsage: !!raw.usage?.paidUsage,
    exclusivity: EXCLUSIVITY.includes(raw.usage?.exclusivity) ? raw.usage.exclusivity : 'none',
    // Uplift on creator cost (%), entered per proposal. Required when anything
    // beyond organic-only / no exclusivity is chosen; there is no default.
    upliftPct: optNum(raw.usage?.upliftPct),
  };

  const c = raw.commercial || {};
  const commercial = {
    adjustmentPct: num(c.adjustmentPct),
    finalPrice: optNum(c.finalPrice) ?? optNum(raw.agreedPrice),
    reason: c.reason || '',
    context: c.context || '',
    note: c.note || '',
  };

  return {
    campaign: String(raw.campaign || '').trim(),
    mode: raw.mode === 'package' ? 'package' : 'budget',
    currency: raw.currency || 'GBP',
    budget: num(raw.budget),
    markets,
    platforms,
    niche: raw.niche || null,
    objective: ['Performance', 'Balanced', 'Content'].includes(raw.objective) ? raw.objective : 'Balanced',
    margin: raw.margin == null || raw.margin === '' ? settings.targetMargin : num(raw.margin),
    videosPerCreator: Math.max(1, Math.round(num(raw.videosPerCreator, settings.defaultVideosPerCreator))),
    // Gifting is a per-proposal add-on. Old saves had only a number of gifted creators.
    gifting: (() => {
      const g = raw.gifting && typeof raw.gifting === 'object' ? raw.gifting : { enabled: num(raw.gifted) > 0, creators: num(raw.gifted) };
      return {
        enabled: !!g.enabled,
        creators: Math.max(0, Math.round(num(g.creators))),
        productCost: optNum(g.productCost), // per creator, client currency
        shippingCost: optNum(g.shippingCost), // per creator, client currency
        postingRate: optNum(g.postingRate), // fraction; empty = settings default
        clientCharge: optNum(g.clientCharge), // optional fixed charge to the client
      };
    })(),
    boostingLines,
    paidMedia,
    otherCosts: num(raw.otherCosts),
    usage,
    commercial,
    requiredVideos: optNum(raw.requiredVideos),
    minCreators: optNum(raw.minCreators),
    maxCreators: optNum(raw.maxCreators),
    maxBigCreators: optNum(raw.maxBigCreators),
    allowedSizes: allowed,
    package: pkg,
    // Proposal-only creator cost per video (client currency, before usage uplift).
    // platform / market '*' = all of them.
    rateOverrides: (Array.isArray(raw.rateOverrides) ? raw.rateOverrides : [])
      .map((o) => ({
        platform: PLATFORMS.includes(o.platform) ? o.platform : '*',
        market: o.market && o.market !== '*' ? o.market : '*',
        size: o.size,
        costPerVideo: optNum(o.costPerVideo),
      }))
      .filter((o) => SIZE_BY_KEY[o.size] && o.costPerVideo > 0),
    settings: raw.settings && typeof raw.settings === 'object' ? raw.settings : undefined,
  };
}

/**
 * Runs the calculator for one package.
 * @param {object} rawInputs see normaliseInputs
 * @param {{archetypes:object[], factors:object, settings:object, fx:Record<string,number>}} ctx
 *   fx: units of each currency per 1 GBP
 *
 * Costs that carry the campaign margin: creators (with usage/exclusivity
 * uplift), gifting, brand-lift study / other direct costs, and boosting lines
 * set to "campaign margin". Pass-through: paid media spend and boosting lines
 * set to "pass-through"; their management fees are added on top.
 *   standard quote = margin costs ÷ (1 − margin) + pass-through spend + fees
 *   final quote    = standard × (1 + adjustment) or a typed final price
 *   service margin = (quote − pass-through − service costs) ÷ (quote − pass-through)
 *   blended margin = (quote − all delivery costs) ÷ quote (secondary)
 */
export function calculate(rawInputs, ctx) {
  const { archetypes, factors, settings, fx } = ctx;
  const inp = normaliseInputs(rawInputs, settings);
  const rate = fx[inp.currency];
  if (!rate) return fail(`No exchange rate for ${inp.currency}.`);
  const toGbp = (x) => x / rate;
  const fromGbp = (x) => x * rate;
  const usdToClient = (usd) => (usd / (fx.USD || 1)) * rate;
  const warnings = [];
  const M = inp.margin;
  const v = inp.videosPerCreator;
  if (!(M >= 0 && M < 1)) return fail('Target margin must be between 0% and 99%.');
  if (!inp.markets.length) return fail('Choose a market.');

  // Usage rights and exclusivity raise what creators cost us.
  const needsUplift = inp.usage.rights !== 'organic' || inp.usage.paidUsage || inp.usage.exclusivity !== 'none';
  if (needsUplift && inp.usage.upliftPct == null) {
    return fail('Enter the usage rights / exclusivity uplift % for this proposal.');
  }
  const uplift = needsUplift ? inp.usage.upliftPct / 100 : 0;

  // Section 3: cost row (spec fallback) and views row (minimum-sample rule) per creator type.
  const minSample = settings.guaranteeMinSample || 10;
  const combos = {};
  const rateFor = (platform, market, size) => {
    const key = comboKey(platform, market, size);
    if (!(key in combos)) {
      const band = SIZE_BY_KEY[size];
      const q = { market, platform, niche: inp.niche, size };
      const row = pickArchetype(archetypes, q, settings);
      const vrow = row && pickViewsRow(archetypes, q, minSample, settings.minCampaigns ?? 3);
      const F = multiVideoFactor(factors, size, v);
      if (!row || !vrow) {
        combos[key] = null;
        return null;
      }
      // Cost per video at this many videos: historical P65 × F, unless the rate
      // card (Settings) or this proposal sets a planning rate.
      const historical = row.cost_p65 * F;
      const card = planningRate(settings.planningRates, { market, platform, niche: inp.niche, size });
      const own = proposalRate(inp.rateOverrides, { platform, market, size });
      const perVideo = own != null ? toGbp(own) : card != null ? card * F : historical;
      const source = own != null ? 'proposal' : card != null ? 'rate card' : 'historical';
      const scale = historical > 0 ? perVideo / historical : 1; // moves P50 / P80 with the planning rate
      combos[key] = {
        key,
        size,
        platform,
        market,
        label: band.label,
        tier: band.tier,
        big: !!band.big,
        confidence: row.confidence,
        level: row.level,
        levelLabel: row.levelLabel,
        lowFallback: row.lowFallback,
        records: row.n_cost,
        // per video at v videos, with usage uplift
        historicalPerVideo: historical * (1 + uplift),
        rateSource: source,
        costP50: row.cost_p50 * F * scale * (1 + uplift),
        costP65: perVideo * (1 + uplift),
        costP80: row.cost_p80 == null ? null : row.cost_p80 * F * scale * (1 + uplift),
        campaigns: row.n_campaigns ?? null,
        viewsLevel: vrow.levelLabel,
        viewsRecords: vrow.n_views,
        viewsThin: vrow.thin,
        costCampaigns: row.costCampaigns,
        viewsCampaigns: vrow.viewCampaigns,
        // Cleaned historical views per video; older rate builds only have percentiles.
        viewsSample: vrow.views_sample?.length ? vrow.views_sample : [vrow.views_p25, vrow.views_p50, vrow.views_p75].filter((x) => x != null),
        viewsP25: vrow.views_p25,
        viewsP50: vrow.views_p50,
        viewsP75: vrow.views_p75,
        factor: F,
        packageCostGbp: v * perVideo * (1 + uplift),
        packageViewsP25: v * vrow.views_p25,
      };
    }
    return combos[key];
  };

  // Add-ons and media, in GBP.
  // Gifting: internal cost = creators gifted × (product + shipping); paid whether or not they post.
  const gift = inp.gifting;
  const gifted = gift.enabled ? gift.creators : 0;
  inp.gifted = gifted;
  if (gifted > 0 && gift.productCost == null && gift.shippingCost == null) {
    return fail('Enter the internal gifting cost per creator (product and shipping; 0 product cost if the brand supplies it).');
  }
  const giftCostPerCreator = (gift.productCost || 0) + (gift.shippingCost || 0);
  const giftingGbp = toGbp(gifted * giftCostPerCreator);
  const postingRate = gift.postingRate ?? settings.giftedPostingRate;
  // With a client gifting charge, gifting is billed as its own line (no campaign margin on it).
  const giftChargeGbp = gifted > 0 && gift.clientCharge != null ? toGbp(gift.clientCharge) : 0;
  const giftCarriesMargin = gifted > 0 && gift.clientCharge == null;
  const otherGbp = toGbp(inp.otherCosts);
  const boosts = inp.boostingLines.map((b) => {
    const cpmUsd = b.cpmUsd ?? num(settings.boostingCpmUsd?.[b.platform], settings.boostingCostPer1000Usd);
    const cpmClient = usdToClient(cpmUsd);
    const budget = b.by === 'views' ? (b.targetViews / 1000) * cpmClient : b.budget;
    const fee = b.treatment === 'passthrough' ? (b.feeType === 'fixed' ? b.fee : (budget * b.fee) / 100) : 0;
    return { ...b, cpmUsd, budget: round2(budget), fee: round2(fee), views: cpmClient > 0 ? Math.floor((budget / cpmClient) * 1000) : 0 };
  });
  const boostMarginGbp = toGbp(boosts.filter((b) => b.treatment === 'margin').reduce((s, b) => s + b.budget, 0));
  const boostPassGbp = toGbp(boosts.filter((b) => b.treatment === 'passthrough').reduce((s, b) => s + b.budget, 0));
  const boostFeesGbp = toGbp(boosts.reduce((s, b) => s + b.fee, 0));
  const pmSpendGbp = toGbp(inp.paidMedia.spend);
  const pmFeeGbp = inp.paidMedia.spend > 0 ? toGbp(inp.paidMedia.feeType === 'fixed' ? inp.paidMedia.fee : (inp.paidMedia.spend * inp.paidMedia.fee) / 100) : 0;
  const marginAddOnsGbp = (giftCarriesMargin ? giftingGbp : 0) + otherGbp + boostMarginGbp; // carry the campaign margin
  const passGbp = pmSpendGbp + boostPassGbp; // pass-through spend
  const feesGbp = pmFeeGbp + boostFeesGbp; // management fees (revenue)
  const giftedPosts = Math.floor(gifted * postingRate);

  // Simulation set-up, shared by the optimiser (Most views) and the results.
  const nano = gifted > 0 ? rateFor(inp.platforms[0], inp.markets[0], NANO_KEY) : null;
  if (gifted > 0 && !nano) warnings.push('No nano-size rate data, so gifted posts add no views.');
  const groupOf = (l) => ({ count: l.count, videos: v, sample: l.viewsSample });
  const giftedGroup = nano ? { count: gifted, postingRate, sample: nano.viewsSample } : null;
  const seedOf = (c) => hashString(JSON.stringify([c, v, gifted, postingRate, inp.niche]));
  const runs = settings.simulationRuns;
  const pctl = settings.promisePercentile;
  const guaranteeOf = (c, n = runs) =>
    simulateViews(Object.entries(c).map(([k, m]) => groupOf({ ...combos[k], count: m })), giftedGroup, { runs: n, seed: seedOf(c) }).percentile(pctl);

  let counts;
  let standardGbp;
  let creatorMoneyGbp;
  let optimiserStep = null;

  if (inp.mode === 'budget') {
    if (!(inp.budget > 0)) return fail('Enter the client budget.');
    standardGbp = toGbp(inp.budget);
    creatorMoneyGbp = (standardGbp - passGbp - feesGbp - giftChargeGbp) * (1 - M) - marginAddOnsGbp;
    if (creatorMoneyGbp <= 0) return fail('Budget too small for these costs.');
    let options = [];
    for (const size of inp.allowedSizes) {
      for (const platform of inp.platforms) {
        for (const market of inp.markets) {
          const r = rateFor(platform, market, size);
          if (!r) continue;
          // Views per creator (v videos) from the historical sample: mean and variance, for Most views.
          const xs = r.viewsSample;
          const m1 = xs.reduce((a, x) => a + x, 0) / xs.length;
          const mean = v * m1;
          const variance = v * v * (xs.reduce((a, x) => a + (x - m1) ** 2, 0) / xs.length);
          options.push({ key: r.key, group: size, cost: r.packageCostGbp, views: r.packageViewsP25, p50: r.viewsP50, p75: r.viewsP75, mean, variance, big: r.big });
        }
      }
    }
    // Within a size, drop a creator type another one beats on cost and on views at P25, P50 and P75.
    const beats = (q, o) => q.cost <= o.cost && q.views >= o.views && q.p50 >= o.p50 && q.p75 >= o.p75;
    options = options.filter(
      (o) => !options.some((q) => q !== o && q.group === o.group && beats(q, o) && (!beats(o, q) || q.key < o.key)),
    );
    if (!options.length) return fail('No rate data for the allowed sizes in these markets.');
    const minFromVideos = inp.requiredVideos ? Math.ceil(Math.max(0, inp.requiredVideos - giftedPosts) / v) : 0;
    const params = {
      creatorMoney: creatorMoneyGbp,
      objective: inp.objective,
      step: settings.optimiserStepGbp,
      minCreators: Math.max(inp.minCreators || 0, minFromVideos),
      maxCreators: inp.maxCreators,
      maxBig: inp.maxBigCreators,
      sizeBonus: settings.balancedSizeBonus,
      creatorBonus: settings.balancedCreatorBonus,
    };
    let res = optimise({ ...params, options });
    if (res.feasible && inp.objective === 'Performance') res = mostViews(options, params, res, guaranteeOf);
    if (!res.feasible) return fail(res.reason);
    counts = res.counts;
    optimiserStep = res.step;
    if (res.step > settings.optimiserStepGbp) {
      warnings.push(`Large budget: the optimiser searched in £${res.step} steps instead of £${settings.optimiserStepGbp}.`);
    }
  } else {
    counts = {};
    for (const [k, n] of Object.entries(inp.package)) {
      const [platform, market, size] = k.split('|');
      if (!rateFor(platform, market, size)) {
        warnings.push(`No rate data for ${SIZE_BY_KEY[size].label} on ${platform} in ${market}; left out.`);
        continue;
      }
      counts[k] = n;
    }
    if (!Object.keys(counts).length) return fail('Add at least one creator to the package.');
    creatorMoneyGbp = Object.entries(counts).reduce((s, [k, n]) => s + n * combos[k].packageCostGbp, 0);
    // Quote in whole currency units, rounded up so the margin is never below target.
    standardGbp = toGbp(Math.ceil(fromGbp((creatorMoneyGbp + marginAddOnsGbp) / (1 - M) + passGbp + feesGbp + giftChargeGbp)));
  }

  const order = (k) => SIZE_BANDS.findIndex((b) => b.key === combos[k].size);
  const lines = Object.keys(counts)
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    .map((k) => ({ ...combos[k], count: counts[k] }));
  const allocatedGbp = lines.reduce((s, l) => s + l.count * l.packageCostGbp, 0);
  const totalCreators = lines.reduce((s, l) => s + l.count, 0);
  const totalVideos = totalCreators * v + giftedPosts;
  const chargedGiftGbp = giftCarriesMargin ? 0 : giftingGbp; // billed separately, still a delivery cost
  const deliveryGbp = allocatedGbp + marginAddOnsGbp + chargedGiftGbp + passGbp;

  // Commercial adjustment (proposal only): standard quote -> final quote.
  const standard = fromGbp(standardGbp);
  const finalPrice = inp.commercial.finalPrice != null
    ? inp.commercial.finalPrice
    : Math.round(standard * (1 + inp.commercial.adjustmentPct / 100));
  const finalGbp = toGbp(finalPrice);
  // Service gross margin: excludes pass-through spend (paid media, pass-through
  // boosting) from both revenue and cost. This is the margin we warn on.
  // Blended contribution margin includes them and is shown as a secondary metric.
  const serviceCostGbp = allocatedGbp + marginAddOnsGbp + chargedGiftGbp;
  const serviceMargin = (q) => (q - passGbp > 0 ? (q - passGbp - serviceCostGbp) / (q - passGbp) : null);
  const standardMargin = serviceMargin(standardGbp);
  const effectiveMargin = serviceMargin(finalGbp);
  const standardBlended = (standardGbp - deliveryGbp) / standardGbp;
  const effectiveBlended = (finalGbp - deliveryGbp) / finalGbp;

  // Minimum viable package: the fewest creators the requirements allow, all of
  // the cheapest allowed creator type, plus this proposal's add-ons and media.
  const cheapest = Math.min(
    ...inp.allowedSizes.flatMap((size) => inp.platforms.flatMap((p) => inp.markets.map((m) => rateFor(p, m, size)?.packageCostGbp ?? Infinity))),
  );
  const minCreatorsNeeded = Math.max(1, inp.minCreators || 0, inp.requiredVideos ? Math.ceil(Math.max(0, inp.requiredVideos - giftedPosts) / v) : 0);
  const minimumViableGbp = Number.isFinite(cheapest)
    ? (minCreatorsNeeded * cheapest + marginAddOnsGbp) / (1 - M) + passGbp + feesGbp + giftChargeGbp
    : null;
  const adjusted = Math.abs(finalPrice - standard) >= 1;

  // Section 4, step 4: simulation, overall and per tier.
  // Same groups, order and seed as the optimiser's evaluation, so Most views reports what it chose on.
  const seed = seedOf(counts);
  // Tier totals come from the same runs, so no tier's guarantee exceeds the package's.
  const sim = simulateViews(
    Object.entries(counts).map(([k, m]) => ({ ...groupOf({ ...combos[k], count: m }), tag: combos[k].tier })),
    giftedGroup && { ...giftedGroup, tag: 'Gifted' },
    { runs, seed },
  );
  const viewsPromised = Math.floor(sim.percentile(pctl) / 10_000) * 10_000;
  const roundTier = (x) => (x >= 100_000 ? Math.floor(x / 10_000) * 10_000 : Math.floor(x / 1_000) * 1_000);
  const tierSummary = (tier, creators, videos, ts) => ({
    tier,
    creators,
    videos,
    guaranteedViews: roundTier(ts.percentile(pctl)),
    low: Math.round(ts.percentile(25)),
    likely: Math.round(ts.p50),
    high: Math.round(ts.p75),
  });
  // Audit trail per creator type: what each line costs and why.
  const lineAudit = (l) => ({
    key: l.key,
    label: l.label,
    platform: l.platform,
    market: l.market,
    creators: l.count,
    videos: l.count * v,
    costPerVideo: round2(fromGbp(l.costP65)),
    historicalPerVideo: round2(fromGbp(l.historicalPerVideo)),
    rateSource: l.rateSource,
    multiVideoFactor: round4(l.factor),
    costLevel: l.levelLabel,
    costRecords: l.records,
    campaigns: l.costCampaigns,
    costReliable: !l.lowFallback,
    viewsRecords: l.viewsRecords,
    viewsCampaigns: l.viewsCampaigns,
    viewsReliable: !l.viewsThin,
    creatorCost: round2(fromGbp(l.count * l.packageCostGbp)),
    viewsPerVideoP25: Math.round(l.viewsP25),
    viewsPerVideoP50: Math.round(l.viewsP50),
    viewsLevel: l.viewsLevel,
  });
  const tiers = [...new Set(lines.map((l) => l.tier))].map((tier) => {
    const tl = lines.filter((l) => l.tier === tier);
    const creators = tl.reduce((s, l) => s + l.count, 0);
    return {
      ...tierSummary(tier, creators, creators * v, sim.byTag[tier]),
      creatorCost: round2(fromGbp(tl.reduce((s, l) => s + l.count * l.packageCostGbp, 0))),
      lines: tl.map(lineAudit),
    };
  });
  if (giftedGroup && gifted > 0) {
    tiers.push(tierSummary('Gifted', gifted, giftedPosts, sim.byTag.Gifted));
  }

  const boostedViews = boosts.reduce((s, b) => s + b.views, 0);
  if (minimumViableGbp != null && finalGbp < minimumViableGbp - 0.5) {
    warnings.push(`Price is below the minimum viable package for these markets, platforms and requirements (${fmtMoney(fromGbp(minimumViableGbp), inp.currency)}).`);
  }
  if (effectiveMargin != null && effectiveMargin < settings.marginWarning) {
    warnings.push(`Service margin ${(effectiveMargin * 100).toFixed(1)}% is below ${settings.marginWarning * 100}%.`);
  }
  for (const l of lines) {
    if (l.lowFallback) warnings.push(`${l.label} (${l.platform}, ${l.market}): cost from thin data even at "${l.levelLabel}" (${l.records} bookings / ${l.costCampaigns} campaigns).`);
    if (l.viewsThin) warnings.push(`${l.label} (${l.platform}, ${l.market}): views from thin data even at "${l.viewsLevel}" (${l.viewsRecords} observations / ${l.viewsCampaigns} campaigns), so the guarantee is less reliable.`);
  }
  if (viewsPromised === 0) warnings.push('Guaranteed views round down to 0 (under 10,000).');

  // Section 4, step 5: campaign team brief.
  let n0 = 1;
  const brief = lines.map((l) => {
    const from = n0;
    n0 += l.count;
    return {
      creators: l.count === 1 ? `Creator ${from}` : `Creators ${from}–${n0 - 1}`,
      size: l.label,
      platform: l.platform,
      market: l.market,
      count: l.count,
      targetViewsPerVideo: Math.round(l.viewsP50),
      videos: v,
      firstOfferPerVideo: round2(fromGbp(settings.firstOfferShare * l.costP50)),
      // P65: the fee the package is costed at. P80: above it needs approval / re-optimising.
      planningAllowancePerVideo: round2(fromGbp(l.costP65)),
      maxFeePerVideo: round2(fromGbp(l.costP65)),
      approvalThresholdPerVideo: l.costP80 == null ? null : round2(fromGbp(l.costP80)),
    };
  });

  return {
    ok: true,
    mode: inp.mode,
    inputs: inp,
    currency: inp.currency,
    fxPerGbp: rate,
    client: {
      price: round2(finalPrice),
      currency: inp.currency,
      creators: lines.map((l) => ({ key: l.key, size: l.size, label: l.label, tier: l.tier, platform: l.platform, market: l.market, count: l.count, videosEach: v, videos: l.count * v })),
      totalCreators,
      totalVideos,
      giftedCreators: gifted,
      giftedPosts,
      viewsPromised,
      tierGuarantees: tiers.map(({ tier, creators, videos, guaranteedViews }) => ({ tier, creators, videos, guaranteedViews })),
      reachPromised: null, // no historical reach data yet
      cpm: viewsPromised ? round2((finalPrice / viewsPromised) * 1000) : null,
      cpv: viewsPromised ? round4(finalPrice / viewsPromised) : null,
      boostedViews,
      paidMediaPlatform: inp.paidMedia.spend > 0 ? inp.paidMedia.platform : '',
      usage: inp.usage,
    },
    internal: {
      viewsLow: Math.round(sim.percentile(25)),
      viewsExpected: Math.round(sim.p50),
      viewsUpside: Math.round(sim.p75),
      tiers,
      standardPrice: round2(standard),
      finalPrice: round2(finalPrice),
      adjusted,
      adjustmentPct: round4(standard ? (finalPrice / standard - 1) * 100 : 0),
      commercial: inp.commercial,
      standardMargin: standardMargin == null ? null : round4(standardMargin),
      expectedMargin: effectiveMargin == null ? null : round4(effectiveMargin),
      standardBlendedMargin: round4(standardBlended),
      blendedMargin: round4(effectiveBlended),
      marginWarning: settings.marginWarning,
      minimumViablePrice: minimumViableGbp == null ? null : Math.ceil(fromGbp(minimumViableGbp)),
      minimumViableCreators: minCreatorsNeeded,
      creatorMoney: round2(fromGbp(creatorMoneyGbp)),
      creatorMoneyAllocated: round2(fromGbp(allocatedGbp)),
      buffer: round2(fromGbp(Math.max(0, creatorMoneyGbp - allocatedGbp))),
      usageUplift: round4(uplift),
      gifting: gifted > 0 ? { creators: gifted, postingRate, posts: giftedPosts, costPerCreator: round2(giftCostPerCreator), cost: round2(fromGbp(giftingGbp)), clientCharge: gift.clientCharge } : null,
      boosting: boosts,
      costs: {
        creators: round2(fromGbp(allocatedGbp)),
        gifting: round2(fromGbp(giftingGbp)),
        other: inp.otherCosts,
        boostingWithMargin: round2(fromGbp(boostMarginGbp)),
        boostingPassThrough: round2(fromGbp(boostPassGbp)),
        paidMedia: inp.paidMedia.spend,
        fees: round2(fromGbp(feesGbp)),
        total: round2(fromGbp(deliveryGbp)),
      },
      creatorMoneyShare: round4(allocatedGbp / finalGbp),
      historicalCreatorMoneyShare: settings.historicalCreatorMoneyShare,
      optimiserStepGbp: optimiserStep,
      sizes: Object.values(combos).filter(Boolean).map((s) => ({
        key: s.key,
        size: s.size,
        label: s.label,
        platform: s.platform,
        market: s.market,
        confidence: s.confidence,
        level: s.levelLabel,
        records: s.records,
        viewsLevel: s.viewsLevel,
        viewsRecords: s.viewsRecords,
        viewsCampaigns: s.viewsCampaigns,
        viewsThin: s.viewsThin,
        costCampaigns: s.costCampaigns,
        lowFallback: s.lowFallback,
        costP50: round2(fromGbp(s.costP50)),
        costP65: round2(fromGbp(s.costP65)),
        historicalPerVideo: round2(fromGbp(s.historicalPerVideo)),
        rateSource: s.rateSource,
        costP80: s.costP80 == null ? null : round2(fromGbp(s.costP80)),
        campaigns: s.campaigns,
        factor: round4(s.factor),
        packageCost: round2(fromGbp(s.packageCostGbp)),
        viewsP25: Math.round(s.viewsP25),
        viewsP50: Math.round(s.viewsP50),
        viewsP75: Math.round(s.viewsP75),
        used: !!counts[s.key],
      })),
      brief,
    },
    warnings,
  };
}

function fmtMoney(n, cur) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n);
}

/**
 * Most views: the package with the highest guarantee (P10 of the simulated
 * campaign total). The guarantee isn't a sum over creators, so candidates come
 * from the exact optimiser run on additive scores: P25 views, and expected
 * views minus a variance penalty λ (λ found by iterating towards the P10 of a
 * normal approximation, then bracketed). Every candidate is simulated; the
 * best guarantee wins.
 */
function mostViews(options, params, first, guaranteeOf) {
  const found = new Map([[JSON.stringify(first.counts), first]]);
  const add = (res) => {
    if (res.feasible) found.set(JSON.stringify(res.counts), res);
    return res;
  };
  const byKey = Object.fromEntries(options.map((o) => [o.key, o]));
  const Z = 1.2816; // standard normal quantile at 90%
  let lam = 0;
  for (let i = 0; i < 6; i++) {
    const res = add(optimise({ ...params, options: options.map((o) => ({ ...o, views: o.mean - lam * o.variance })) }));
    if (!res.feasible) break;
    const V = Object.entries(res.counts).reduce((s, [k, m]) => s + m * byKey[k].variance, 0);
    const next = V > 0 ? Z / (2 * Math.sqrt(V)) : 0;
    if (Math.abs(next - lam) <= 0.02 * Math.max(next, lam)) break;
    lam = next;
  }
  for (const f of [0.25, 0.5, 2, 4]) {
    add(optimise({ ...params, options: options.map((o) => ({ ...o, views: o.mean - f * lam * o.variance })) }));
  }
  // Screen with fewer runs, then decide between the best three on the full simulation.
  const screened = [...found.values()]
    .map((r) => ({ r, g: guaranteeOf(r.counts, 1000) }))
    .sort((a, b) => b.g - a.g)
    .slice(0, 3);
  let best = null;
  for (const { r } of screened) {
    const g = guaranteeOf(r.counts);
    if (!best || g > best.g) best = { r, g };
  }
  return best.r;
}

// Rate card key: market | platform | vertical | size; '' vertical = any vertical.
export const rateCardKey = (market, platform, niche, size) => `${market}|${platform}|${niche || ''}|${size}`;

function planningRate(card, { market, platform, niche, size }) {
  if (!card) return null;
  const x = card[rateCardKey(market, platform, niche, size)] ?? (niche ? card[rateCardKey(market, platform, '', size)] : null);
  return x > 0 ? Number(x) : null;
}

// Most specific proposal override wins: platform + market, then one of them, then all.
function proposalRate(overrides, { platform, market, size }) {
  let best = null;
  let bestScore = -1;
  for (const o of overrides) {
    if (o.size !== size) continue;
    if (o.platform !== '*' && o.platform !== platform) continue;
    if (o.market !== '*' && o.market !== market) continue;
    const score = (o.platform !== '*' ? 2 : 0) + (o.market !== '*' ? 1 : 0);
    if (score > bestScore) {
      best = o.costPerVideo;
      bestScore = score;
    }
  }
  return best;
}

function fail(error) {
  return { ok: false, error };
}

// The calculator screen. "Your creators" is the package the client wants,
// priced as package to budget (section 5). Each recommended package is budget
// to package (section 4) at the client budget, one per objective.
export const RECOMMENDATIONS = [
  { kind: 'performance', name: 'Most views', objective: 'Performance' },
  { kind: 'balanced', name: 'Balanced', objective: 'Balanced' },
  { kind: 'content', name: 'Most videos', objective: 'Content' },
];

export function calculateSet(rawInputs, ctx) {
  const yours = Object.values(rawInputs.package || {}).some((n) => Number(n) > 0)
    ? calculate({ ...rawInputs, mode: 'package' }, ctx)
    : null;
  const budget = Number(rawInputs.budget) > 0 ? Number(rawInputs.budget) : null;
  const recommended = budget
    ? RECOMMENDATIONS.map((r) => ({ ...r, ...calculate({ ...rawInputs, mode: 'budget', objective: r.objective, commercial: {} }, ctx) }))
    : [];
  return { ok: true, yours, recommended: reconcile(recommended) };
}

/**
 * Every recommendation is a feasible package for the same budget and
 * constraints, so Most views must have at least the guaranteed views of any of
 * them, and Most videos at least the videos. If another objective found a
 * better one, that package is used.
 */
export function reconcile(recommended) {
  const ok = recommended.filter((r) => r.ok);
  const better = (kind, metric) => {
    const i = recommended.findIndex((r) => r.kind === kind && r.ok);
    if (i < 0) return;
    const top = ok.reduce((a, b) => (metric(b) > metric(a) ? b : a), recommended[i]);
    if (top !== recommended[i]) {
      const { kind: k, name, objective } = recommended[i];
      recommended[i] = { ...top, kind: k, name, objective, inputs: { ...top.inputs, objective }, takenFrom: top.name };
    }
  };
  better('performance', (r) => r.client.viewsPromised * 1e6 + r.internal.viewsExpected / 1e6);
  better('content', (r) => r.client.totalVideos * 1e12 + r.client.viewsPromised);
  return recommended;
}

/**
 * Fills "Your creators" from a number of creators.
 * With a client budget: the Balanced package with exactly that many creators.
 * Without one: the creators are split across sizes the way past bookings for
 * these markets and platforms were (rate table records), spread evenly over
 * the chosen markets and platforms.
 */
export function suggestMix(rawInputs, creators, ctx) {
  const N = Math.max(0, Math.round(Number(creators) || 0));
  if (!N) return { ok: true, package: {} };
  const inp = normaliseInputs(rawInputs, ctx.settings);
  if (!inp.markets.length) return { ok: false, error: 'Choose a market.' };
  if (Number(rawInputs.budget) > 0) {
    const r = calculate({ ...rawInputs, mode: 'budget', objective: 'Balanced', minCreators: N, maxCreators: N }, ctx);
    if (r.ok && r.client.totalCreators === N) {
      return { ok: true, package: Object.fromEntries(r.client.creators.map((c) => [c.key, c.count])) };
    }
  }
  const combos = inp.platforms.flatMap((platform) => inp.markets.map((market) => ({ platform, market })));
  const out = {};
  combos.forEach(({ platform, market }, i) => {
    const share = Math.floor(N / combos.length) + (i < N % combos.length ? 1 : 0);
    if (!share) return;
    // Historical size mix: most specific level with data for this market and platform.
    const weights = {};
    for (const level of inp.niche ? [1, 2] : [2]) {
      for (const a of ctx.archetypes) {
        if (a.level !== level || a.market !== market || a.platform !== platform) continue;
        if (level === 1 && a.niche !== inp.niche) continue;
        if (!inp.allowedSizes.includes(a.size_band)) continue;
        weights[a.size_band] = a.n_cost;
      }
      if (Object.keys(weights).length) break;
    }
    const sizes = Object.keys(weights);
    if (!sizes.length) return;
    const total = sizes.reduce((s, k) => s + weights[k], 0);
    // Largest remainder so the counts add up to the share exactly.
    const raw = sizes.map((k) => ({ k, x: (share * weights[k]) / total }));
    raw.forEach((r) => { r.n = Math.floor(r.x); });
    let left = share - raw.reduce((s, r) => s + r.n, 0);
    raw.sort((a, b) => (b.x - b.n) - (a.x - a.n)).forEach((r) => { if (left > 0) { r.n++; left--; } });
    for (const r of raw) if (r.n) out[comboKey(platform, market, r.k)] = r.n;
  });
  return { ok: true, package: out };
}
