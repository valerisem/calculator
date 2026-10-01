import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculate, calculateSet } from '../server/engine/calculator.js';
import { DEFAULT_SETTINGS } from '../server/engine/constants.js';
import { optimise } from '../server/engine/optimiser.js';
import { buildRateTable, normaliseMarket, pickArchetype } from '../server/engine/rates.js';
import { simulateViews } from '../server/engine/simulate.js';
import { estimateRates } from '../server/engine/pricing.js';

// Rate card: cost per video entered by the team (GBP).
const card = (market, f = 1) => ({
  [`${market}|TikTok|nano_1k_10k`]: 100 * f,
  [`${market}|TikTok|micro_25k_50k`]: 300 * f,
  [`${market}|TikTok|mid_100k_150k`]: 800 * f,
  [`${market}|TikTok|macro_350k_1m`]: 2000 * f,
});
const settings = { ...DEFAULT_SETTINGS, rateOwnerIds: [], planningRates: { ...card('UK'), ...card('US'), ...card('Germany', 0.5) } };
const fx = { GBP: 1, USD: 1.25, EUR: 1.15 };
const CAMPAIGNS = [100, 101, 102, 103].map((id) => ({ pd_deal_id: id, wide_niche: 'Tech', account_owner_id: 9 }));

// Brute force over small counts, Performance objective.
function bruteForce(options, C, maxEach = 30) {
  let best = { views: -1 };
  const rec = (k, money, views, counts) => {
    if (k === options.length) {
      if (views > best.views) best = { views, counts: [...counts] };
      return;
    }
    for (let m = 0; m <= maxEach && m * options[k].cost <= money; m++) {
      counts.push(m);
      rec(k + 1, money - m * options[k].cost, views + m * options[k].views, counts);
      counts.pop();
    }
  };
  rec(0, C, 0, []);
  return best;
}

test('optimiser matches brute force for Performance', () => {
  const options = [
    { key: 'a', cost: 300, views: 9000 },
    { key: 'b', cost: 725, views: 25000 },
    { key: 'c', cost: 1600, views: 50000 },
  ];
  for (const C of [1000, 2475, 5000, 7300]) {
    const res = optimise({ options, creatorMoney: C, objective: 'Performance' });
    const views = Object.entries(res.counts).reduce((s, [k, m]) => s + m * options.find((o) => o.key === k).views, 0);
    assert.ok(res.allocated <= C);
    assert.equal(views, bruteForce(options, C).views, `C=${C}`);
  }
});

test('optimiser respects max creators, max big and min creators', () => {
  const options = [
    { key: 'nano', cost: 200, views: 3000 },
    { key: 'macro', cost: 3000, views: 200000, big: true },
  ];
  const r1 = optimise({ options, creatorMoney: 10000, objective: 'Performance', maxBig: 1 });
  assert.equal(r1.counts.macro, 1);
  const r2 = optimise({ options, creatorMoney: 10000, objective: 'Performance', maxCreators: 4 });
  assert.ok(Object.values(r2.counts).reduce((a, b) => a + b) <= 4);
  const r3 = optimise({ options, creatorMoney: 10000, objective: 'Content' });
  assert.equal(r3.counts.nano, 50);
  const r4 = optimise({ options, creatorMoney: 1000, objective: 'Performance', minCreators: 10 });
  assert.equal(r4.feasible, false);
});

test('balanced objective rewards using more sizes', () => {
  const options = [
    { key: 'a', cost: 1000, views: 10000 },
    { key: 'b', cost: 1000, views: 9800 },
  ];
  const perf = optimise({ options, creatorMoney: 2000, objective: 'Performance' });
  const bal = optimise({ options, creatorMoney: 2000, objective: 'Balanced' });
  assert.deepEqual(perf.counts, { a: 2 });
  assert.deepEqual(bal.counts, { a: 1, b: 1 });
});

test('simulation samples history, never extrapolates, and keeps thin-history doubt', () => {
  const sample = [1000, 2000, 3000, 5000, 8000, 10000, 15000, 20000, 40000, 90000];
  const groups = [{ count: 5, videos: 3, sample }];
  const a = simulateViews(groups, null, { runs: 2000, seed: 7 });
  const b = simulateViews(groups, null, { runs: 2000, seed: 7 });
  assert.equal(a.p10, b.p10);
  assert.ok(a.p10 < a.p50 && a.p50 < a.p75);
  // Never above every creator getting the best views actually observed.
  assert.ok(a.percentile(100) <= 5 * 3 * 90000);
  // 100 creators: a 10-observation history leaves much more doubt than a
  // 1,000-observation history with the same shape.
  const big = Array.from({ length: 100 }, () => sample).flat();
  const spread = (s) => {
    const r = simulateViews([{ count: 100, videos: 3, sample: s }], null, { runs: 3000, seed: 3 });
    return (r.p50 - r.p10) / r.p50;
  };
  assert.ok(spread(sample) > 2 * spread(big), `${spread(sample)} vs ${spread(big)}`);
});

function fakeBookings() {
  const rows = [];
  let id = 1;
  const add = (n, followers, fee, videos, views, extra = {}) => {
    for (let i = 0; i < n; i++) {
      rows.push({
        id: id++, campaign_number: String(100 + (i % 4)), platform: 'tiktok', location: 'UK', tiktok_followers: followers,
        avg_views: views * (0.8 + (i % 5) * 0.1), deliverables: videos, fee_gbp: fee * (0.9 + (i % 3) * 0.1),
        board_group: '👍 Final List of Creators', ...extra,
      });
    }
  };
  add(12, 5_000, 300, 3, 4_000);
  add(12, 30_000, 900, 3, 15_000);
  add(6, 120_000, 2400, 3, 40_000);
  add(3, 500_000, 6000, 3, 150_000); // Low at market level
  add(10, 600_000, 6000, 3, 150_000, { location: 'USA' });
  add(4, 30_000, 900, 3, 15_000, { board_group: 'Pass/Not Available' });
  add(1, 10_000, 500, 1, 900_000); // outlier: views > 5x followers
  return rows;
}

test('rate table: groups, outliers, fallback', () => {
  const { archetypes, flags, stats } = buildRateTable(fakeBookings(), CAMPAIGNS, settings);
  assert.equal(flags.length, 1);
  assert.equal(stats.droppedGroup, 4);
  const micro = pickArchetype(archetypes, { market: 'UK', platform: 'TikTok', niche: 'Tech', size: 'micro_25k_50k' });
  assert.equal(micro.level, 1);
  assert.equal(micro.confidence, 'High');
  const macro = pickArchetype(archetypes, { market: 'UK', platform: 'TikTok', niche: 'Tech', size: 'macro_350k_1m' });
  assert.equal(macro.level, 5); // UK has 3 records; platform + size has 13
  // Plenty of bookings from one campaign is not reliable: falls back to broader data.
  const one = fakeBookings().map((x) => ({ ...x, campaign_number: '100' }));
  const single = buildRateTable(one, CAMPAIGNS, settings);
  const m1 = pickArchetype(single.archetypes, { market: 'UK', platform: 'TikTok', niche: 'Tech', size: 'micro_25k_50k' }, settings);
  assert.equal(m1.lowFallback, true);
  assert.equal(m1.level, 6);
  assert.equal(normaliseMarket('USA'), 'US');
  assert.equal(normaliseMarket('Nothing'), null);
});

test('budget to package and package to budget agree', () => {
  const rt = buildRateTable(fakeBookings(), CAMPAIGNS, settings);
  const ctx = { ...rt, settings, fx };
  const base = { market: 'UK', platform: 'TikTok', niche: 'Tech', objective: 'Performance', margin: 0.5, videosPerCreator: 3 };
  const b = calculate({ ...base, mode: 'budget', budget: 20000, currency: 'GBP' }, ctx);
  assert.ok(b.ok, b.error);
  assert.ok(b.internal.creatorMoneyAllocated <= b.internal.creatorMoney);
  assert.ok(b.internal.expectedMargin >= 0.5);
  assert.equal(b.client.viewsPromised % 10000, 0);
  assert.ok(b.internal.viewsExpected > b.client.viewsPromised);

  const pkg = Object.fromEntries(b.client.creators.map((c) => [c.size, c.count]));
  const p = calculate({ ...base, mode: 'package', package: pkg, currency: 'GBP' }, ctx);
  assert.ok(p.ok, p.error);
  assert.ok(p.client.price <= 20000);
  assert.equal(p.client.viewsPromised, b.client.viewsPromised);

  const tooSmall = calculate({ ...base, mode: 'budget', budget: 1000, currency: 'GBP', paidMedia: 1200 }, ctx);
  assert.equal(tooSmall.ok, false);
  assert.match(tooSmall.error, /Budget too small/);

  const usd = calculate({ ...base, mode: 'budget', budget: 25000, currency: 'USD', boosting: 600 }, ctx);
  assert.ok(usd.ok);
  assert.equal(usd.client.boostedViews, 100000); // $600 at $6 per 1,000
});

test('calculator screen: your creators and one recommendation per objective', () => {
  const rt = buildRateTable(fakeBookings(), CAMPAIGNS, settings);
  const ctx = { ...rt, settings, fx };
  const base = { market: 'UK', platform: 'TikTok', niche: 'Tech', margin: 0.5, videosPerCreator: 3, currency: 'GBP' };
  const none = calculateSet(base, ctx);
  assert.equal(none.yours, null);
  assert.equal(none.recommended.length, 0);
  const set = calculateSet({ ...base, budget: 20000, package: { micro_25k_50k: 4 } }, ctx);
  assert.equal(set.yours.mode, 'package');
  assert.equal(set.yours.client.totalCreators, 4);
  assert.deepEqual(set.recommended.map((r) => r.objective), ['Performance', 'Balanced', 'Content']);
  for (const r of set.recommended) {
    assert.ok(r.ok, r.error);
    assert.equal(r.client.price, 20000);
  }
});

test('optimiser: options in the same size group count as one size', () => {
  // Same size in two markets vs a second size. Balanced bonus is per size, not per option.
  const options = [
    { key: 'UK|micro', group: 'micro', cost: 1000, views: 10000 },
    { key: 'DE|micro', group: 'micro', cost: 1000, views: 9990 },
    { key: 'UK|mid', group: 'mid', cost: 1000, views: 9700 },
  ];
  const bal = optimise({ options, creatorMoney: 2000, objective: 'Balanced' });
  // micro + mid: (10000 + 9700) × 1.06 = 20882 beats two micros (20000 × 1.01 = 20200)
  assert.deepEqual(bal.counts, { 'UK|micro': 1, 'UK|mid': 1 });
  const perf = optimise({ options, creatorMoney: 3000, objective: 'Performance' });
  assert.deepEqual(perf.counts, { 'UK|micro': 3 });
  // Brute-force check with groups across budgets.
  const opts = [
    { key: 'a1', group: 'a', cost: 300, views: 9000 },
    { key: 'a2', group: 'a', cost: 350, views: 11000 },
    { key: 'b1', group: 'b', cost: 725, views: 25000 },
  ];
  for (const C of [1000, 2475, 5000]) {
    const res = optimise({ options: opts, creatorMoney: C, objective: 'Performance' });
    const views = Object.entries(res.counts).reduce((s, [k, m]) => s + m * opts.find((o) => o.key === k).views, 0);
    assert.equal(views, bruteForce(opts, C).views, `C=${C}`);
  }
});

test('several markets: lines priced per market, recommendations choose across them', () => {
  const rows = fakeBookings().map((b) => ({ ...b }));
  // A German copy of the data where creators are half the price.
  const de = fakeBookings().map((b, i) => ({ ...b, id: 10_000 + i, location: 'Germany', fee_gbp: b.fee_gbp / 2 }));
  const rt = buildRateTable([...rows, ...de], CAMPAIGNS, settings);
  const ctx = { ...rt, settings, fx };
  const base = { platforms: ['TikTok'], markets: ['UK', 'Germany'], niche: 'Tech', margin: 0.5, videosPerCreator: 3, currency: 'GBP' };
  const uk = calculate({ ...base, mode: 'package', package: { 'TikTok|UK|micro_25k_50k': 4 } }, ctx);
  const ger = calculate({ ...base, mode: 'package', package: { 'TikTok|Germany|micro_25k_50k': 4 } }, ctx);
  assert.ok(ger.client.price < uk.client.price);
  assert.equal(uk.client.creators[0].market, 'UK');
  const rec = calculate({ ...base, mode: 'budget', budget: 20000, objective: 'Performance' }, ctx);
  assert.ok(rec.ok, rec.error);
  assert.ok(rec.client.creators.every((c) => c.market === 'Germany')); // cheaper market wins on views
});

test('number of creators fills your creators', async () => {
  const { suggestMix } = await import('../server/engine/calculator.js');
  const rt = buildRateTable(fakeBookings(), CAMPAIGNS, settings);
  const ctx = { ...rt, settings, fx };
  const base = { platforms: ['TikTok'], markets: ['UK'], niche: 'Tech', margin: 0.5, videosPerCreator: 3, currency: 'GBP' };
  const hist = suggestMix(base, 7, ctx);
  assert.equal(Object.values(hist.package).reduce((a, b) => a + b, 0), 7);
  const withBudget = suggestMix({ ...base, budget: 20000 }, 7, ctx);
  assert.equal(Object.values(withBudget.package).reduce((a, b) => a + b, 0), 7);
});

test('paid media is pass-through plus fee; boosting margin treatment; commercial adjustment; tier guarantees', () => {
  const rt = buildRateTable(fakeBookings(), CAMPAIGNS, settings);
  const ctx = { ...rt, settings, fx };
  const base = { markets: ['UK'], platforms: ['TikTok'], niche: 'Tech', margin: 0.5, videosPerCreator: 3, currency: 'GBP', mode: 'package', package: { 'TikTok|UK|micro_25k_50k': 4, 'TikTok|UK|mid_100k_150k': 1 } };
  const plain = calculate(base, ctx);
  // £10,000 media at 10% fee adds exactly £11,000 to the quote, not £20,000.
  const media = calculate({ ...base, paidMedia: { spend: 10000, feeType: 'percent', fee: 10 } }, ctx);
  assert.ok(Math.abs(media.internal.standardPrice - plain.internal.standardPrice - 11000) <= 1);
  // Boosting with campaign margin doubles at 50%; as pass-through + £100 fee it adds budget + fee.
  const boostM = calculate({ ...base, boostingLines: [{ platform: 'TikTok', budget: 1000 }] }, ctx);
  const boostP = calculate({ ...base, boostingLines: [{ platform: 'TikTok', budget: 1000, treatment: 'passthrough', feeType: 'fixed', fee: 100 }] }, ctx);
  assert.ok(Math.abs(boostM.internal.standardPrice - plain.internal.standardPrice - 2000) <= 1);
  assert.ok(Math.abs(boostP.internal.standardPrice - plain.internal.standardPrice - 1100) <= 1);
  // Platform CPM: $6 default; reverse mode from target views.
  const byViews = calculate({ ...base, currency: 'USD', boostingLines: [{ platform: 'Instagram', by: 'views', targetViews: 200000, cpmUsd: 0.5 }] }, ctx);
  assert.equal(byViews.internal.boosting[0].budget, 100);
  assert.equal(byViews.client.boostedViews, 200000);
  // Commercial adjustment keeps the standard quote and changes the final one.
  const up = calculate({ ...base, commercial: { adjustmentPct: 15, reason: 'Client willingness to pay' } }, ctx);
  assert.equal(up.internal.standardPrice, plain.internal.standardPrice);
  assert.equal(up.client.price, Math.round(plain.internal.standardPrice * 1.15));
  assert.ok(up.internal.expectedMargin > plain.internal.expectedMargin);
  // Tier guarantees: one per tier; reach is not produced.
  assert.deepEqual(plain.client.tierGuarantees.map((t) => t.tier), ['Micro', 'Mid']);
  assert.equal(plain.client.reachPromised, null);
  assert.ok(plain.internal.viewsLow <= plain.internal.viewsExpected && plain.internal.viewsExpected <= plain.internal.viewsUpside);
  // Usage uplift is a required proposal input when anything beyond organic / no exclusivity is chosen.
  const missing = calculate({ ...base, usage: { rights: '12m' } }, ctx);
  assert.equal(missing.ok, false);
  assert.match(missing.error, /uplift/);
  const lic = calculate({ ...base, usage: { rights: '12m', upliftPct: 50 } }, ctx);
  assert.ok(Math.abs(lic.internal.costs.creators - plain.internal.costs.creators * 1.5) < 1);
  const organic = calculate({ ...base, usage: { rights: 'organic', upliftPct: 50 } }, ctx);
  assert.equal(organic.internal.costs.creators, plain.internal.costs.creators);
  // Service margin ignores pass-through media; blended margin does not.
  assert.ok(Math.abs(media.internal.standardMargin - plain.internal.standardMargin) < 0.07);
  assert.ok(media.internal.standardBlendedMargin < 0.4);
  assert.ok(!media.warnings.some((w) => /Service margin/.test(w)));
  // P80 approval threshold sits above the P65 planning allowance; campaign counts present.
  for (const b of plain.internal.brief) assert.ok(b.firstOfferPerVideo < b.maxFeePerVideo);
  assert.ok(plain.internal.sizes.every((x) => typeof x.viewsCampaigns === 'number'));
  // Minimum viable package.
  assert.ok(plain.internal.minimumViablePrice > 0 && plain.internal.minimumViablePrice <= plain.client.price);
});

test('gifting: internal cost carries margin unless a client charge is set', () => {
  const rt = buildRateTable(fakeBookings(), CAMPAIGNS, settings);
  const ctx = { ...rt, settings, fx };
  const base = { markets: ['UK'], platforms: ['TikTok'], niche: 'Tech', margin: 0.5, videosPerCreator: 3, currency: 'GBP', mode: 'package', package: { 'TikTok|UK|micro_25k_50k': 4 } };
  const plain = calculate(base, ctx);
  const gifting = { enabled: true, creators: 10, productCost: 30, shippingCost: 10 };
  // 10 × (£30 + £10) = £400 cost; at 50% margin the quote rises by £800.
  const g = calculate({ ...base, gifting }, ctx);
  assert.ok(Math.abs(g.internal.standardPrice - plain.internal.standardPrice - 800) <= 1);
  assert.equal(g.internal.gifting.posts, Math.floor(10 * settings.giftedPostingRate));
  assert.equal(g.internal.costs.gifting, 400);
  // With a £500 client charge, the quote rises by the charge and the £400 stays a delivery cost.
  const c = calculate({ ...base, gifting: { ...gifting, clientCharge: 500, postingRate: 0.3 } }, ctx);
  assert.ok(Math.abs(c.internal.standardPrice - plain.internal.standardPrice - 500) <= 1);
  assert.equal(c.internal.gifting.posts, 3);
  assert.ok(Math.abs(c.internal.costs.total - plain.internal.costs.total - 400) <= 1);
  // Off means no gifting at all; missing costs are an error.
  assert.equal(calculate({ ...base, gifting: { ...gifting, enabled: false } }, ctx).internal.gifting, null);
  assert.equal(calculate({ ...base, gifting: { enabled: true, creators: 5 } }, ctx).ok, false);
});

test('Most views has the highest guarantee and Most videos the most videos', () => {
  const rt = buildRateTable(fakeBookings(), CAMPAIGNS, settings);
  const ctx = { ...rt, settings, fx };
  for (const budget of [8000, 20000, 60000]) {
    const set = calculateSet({ market: 'UK', platform: 'TikTok', niche: 'Tech', margin: 0.5, videosPerCreator: 3, currency: 'GBP', budget }, ctx);
    const [views, balanced, videos] = set.recommended;
    assert.ok(views.client.viewsPromised >= balanced.client.viewsPromised, `${budget}: views ${views.client.viewsPromised} < balanced ${balanced.client.viewsPromised}`);
    assert.ok(views.client.viewsPromised >= videos.client.viewsPromised);
    assert.ok(videos.client.totalVideos >= balanced.client.totalVideos && videos.client.totalVideos >= views.client.totalVideos);
    assert.equal(views.objective, 'Performance');
    for (const r of set.recommended) {
      for (const t of r.internal.tiers) assert.ok(t.guaranteedViews <= r.client.viewsPromised + 10_000, `${t.tier} above package`);
    }
  }
});

test('cost per video comes from the rate card or the proposal; a missing one is provisional', () => {
  const rt = buildRateTable(fakeBookings(), CAMPAIGNS, settings);
  const base = { markets: ['UK'], platforms: ['TikTok'], niche: 'Tech', margin: 0.5, videosPerCreator: 3, currency: 'GBP', mode: 'package', package: { 'TikTok|UK|micro_25k_50k': 2 } };
  // creators × videos × cost per video
  const r = calculate(base, { ...rt, settings, fx });
  assert.equal(r.internal.costs.creators, 2 * 3 * 300);
  assert.equal(r.internal.tiers[0].lines[0].rateSource, 'rate card');
  assert.equal(r.estimatedRates.length, 0);
  // Proposal override (client currency) wins; the most specific line wins.
  const o = calculate({ ...base, currency: 'USD', rateOverrides: [{ size: 'micro_25k_50k', platform: '*', market: '*', costPerVideo: 500 }, { size: 'micro_25k_50k', platform: 'TikTok', market: 'UK', costPerVideo: 1000 }] }, { ...rt, settings, fx });
  assert.equal(o.internal.tiers[0].lines[0].rateSource, 'proposal');
  assert.equal(o.internal.costs.creators, 6000);
  // No cost entered: estimated automatically, never left out, overridable.
  const empty = { ...settings, planningRates: {} };
  const p = calculate(base, { ...rt, settings: empty, fx });
  assert.ok(p.ok);
  assert.equal(p.internal.tiers[0].lines[0].rateSource, 'estimated');
  assert.ok(p.internal.costs.creators > 0);
  assert.deepEqual(p.estimatedRates.map((n) => n.key), ['TikTok|UK|micro_25k_50k']);
  const done = calculate({ ...base, rateOverrides: [{ size: 'micro_25k_50k', platform: 'TikTok', market: 'UK', costPerVideo: 350 }] }, { ...rt, settings: empty, fx });
  assert.equal(done.estimatedRates.length, 0);
  assert.equal(done.internal.costs.creators, 2100);
  // Budget mode: estimated sizes stay in the options.
  const bud = calculate({ ...base, mode: 'budget', budget: 20000, objective: 'Performance' }, { ...rt, settings: { ...settings, planningRates: { 'UK|TikTok|micro_25k_50k': 300 } }, fx });
  assert.ok(bud.ok);
  assert.ok(bud.internal.sizes.some((z) => z.rateSource === 'estimated'));
});

test('estimated cost per video: history, then between priced sizes, then the size curve', () => {
  const row = (level, size, cost, extra = {}) => ({ level, size_band: size, cost_p50: cost, n_cost: 20, n_cost_campaigns: 5, market: null, platform: null, ...extra });
  const curve = ['nano_1k_10k', 'micro_10k_25k', 'micro_25k_50k', 'micro_50k_75k', 'micro_75k_100k', 'mid_100k_150k', 'mid_150k_250k', 'mid_250k_350k', 'macro_350k_1m', 'celebrity_1m']
    .map((sz, i) => row(6, sz, 100 * 2 ** i)); // overall: doubles each size
  const uk = (sz, cost, extra) => row(2, sz, cost, { market: 'UK', platform: 'TikTok', ...extra });
  const archetypes = [
    ...curve,
    uk('micro_10k_25k', 300),
    uk('mid_100k_150k', 2400),
    uk('micro_25k_50k', 999, { n_cost_campaigns: 1 }), // thin: not used
  ];
  const est = estimateRates(archetypes, { ...settings, planningRates: { 'UK|TikTok|mid_250k_350k': 9000 } }, 'UK', 'TikTok');
  assert.deepEqual(est.micro_10k_25k, { perVideo: 300, basis: 'history' });
  assert.deepEqual(est.mid_250k_350k, { perVideo: 9000, basis: 'rate card' });
  // Between 300 (index 1) and 2400 (index 5), proportionally: 300 × 2^(3·1/4·…)
  assert.equal(est.micro_25k_50k.basis, 'interpolated');
  assert.ok(Math.abs(est.micro_25k_50k.perVideo - 300 * 8 ** 0.25) < 0.01);
  // Ends: overall curve scaled to UK TikTok (UK prices are 1.5× the curve here, 9000 is 0.7×).
  assert.equal(est.nano_1k_10k.basis, 'curve');
  assert.equal(est.celebrity_1m.basis, 'curve');
  for (const e of Object.values(est)) assert.ok(e.perVideo > 0);
  assert.equal(Object.keys(est).length, 10);
  // A market with no local prices still gets every size, from the curve.
  const none = estimateRates(curve, settings, 'Brazil', 'TikTok');
  assert.equal(Object.keys(none).length, 10);
  assert.equal(none.nano_1k_10k.perVideo, 100);
});
