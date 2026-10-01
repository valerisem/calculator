import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculate, calculateSet } from '../server/engine/calculator.js';
import { DEFAULT_SETTINGS } from '../server/engine/constants.js';
import { optimise } from '../server/engine/optimiser.js';
import { buildRateTable, normaliseMarket, pickArchetype } from '../server/engine/rates.js';
import { simulateViews } from '../server/engine/simulate.js';

const settings = { ...DEFAULT_SETTINGS, giftingCostPerCreatorGbp: 50, rateOwnerIds: [] };
const fx = { GBP: 1, USD: 1.25, EUR: 1.15 };

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

test('simulation percentiles are ordered and deterministic', () => {
  const groups = [{ count: 5, videos: 3, p25: 5000, p50: 10000, p75: 20000 }];
  const a = simulateViews(groups, null, { runs: 2000, seed: 7 });
  const b = simulateViews(groups, null, { runs: 2000, seed: 7 });
  assert.equal(a.p10, b.p10);
  assert.ok(a.p10 < a.p50 && a.p50 < a.p75);
  // median of sum is near 5 × 3 × e^(mu + sigma²/2)… at least above 5×3×P25
  assert.ok(a.p50 > 5 * 3 * 5000);
});

function fakeBookings() {
  const rows = [];
  let id = 1;
  const add = (n, followers, fee, videos, views, extra = {}) => {
    for (let i = 0; i < n; i++) {
      rows.push({
        id: id++, campaign_number: '100', platform: 'tiktok', location: 'UK', tiktok_followers: followers,
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
  const { archetypes, flags, stats } = buildRateTable(fakeBookings(), [{ pd_deal_id: 100, wide_niche: 'Tech', account_owner_id: 9 }], settings);
  assert.equal(flags.length, 1);
  assert.equal(stats.droppedGroup, 4);
  const micro = pickArchetype(archetypes, { market: 'UK', platform: 'TikTok', niche: 'Tech', size: 'micro_25k_50k' });
  assert.equal(micro.level, 1);
  assert.equal(micro.confidence, 'High');
  const macro = pickArchetype(archetypes, { market: 'UK', platform: 'TikTok', niche: 'Tech', size: 'macro_350k_1m' });
  assert.equal(macro.level, 5); // UK has 3 records; platform + size has 13
  assert.equal(normaliseMarket('USA'), 'US');
  assert.equal(normaliseMarket('Nothing'), null);
});

test('budget to package and package to budget agree', () => {
  const rt = buildRateTable(fakeBookings(), [{ pd_deal_id: 100, wide_niche: 'Tech', account_owner_id: 9 }], settings);
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
  const rt = buildRateTable(fakeBookings(), [{ pd_deal_id: 100, wide_niche: 'Tech', account_owner_id: 9 }], settings);
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
  const rt = buildRateTable([...rows, ...de], [{ pd_deal_id: 100, wide_niche: 'Tech', account_owner_id: 9 }], settings);
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
  const rt = buildRateTable(fakeBookings(), [{ pd_deal_id: 100, wide_niche: 'Tech', account_owner_id: 9 }], settings);
  const ctx = { ...rt, settings, fx };
  const base = { platforms: ['TikTok'], markets: ['UK'], niche: 'Tech', margin: 0.5, videosPerCreator: 3, currency: 'GBP' };
  const hist = suggestMix(base, 7, ctx);
  assert.equal(Object.values(hist.package).reduce((a, b) => a + b, 0), 7);
  const withBudget = suggestMix({ ...base, budget: 20000 }, 7, ctx);
  assert.equal(Object.values(withBudget.package).reduce((a, b) => a + b, 0), 7);
});

test('paid media is pass-through plus fee; boosting margin treatment; commercial adjustment; tier guarantees', () => {
  const rt = buildRateTable(fakeBookings(), [{ pd_deal_id: 100, wide_niche: 'Tech', account_owner_id: 9 }], settings);
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
  // Usage uplift raises creator cost.
  const s2 = { ...settings, usageRightsUplift: { ...settings.usageRightsUplift, '12m': 0.5 } };
  const lic = calculate({ ...base, usage: { rights: '12m' } }, { ...ctx, settings: s2 });
  assert.ok(Math.abs(lic.internal.costs.creators - plain.internal.costs.creators * 1.5) < 1);
});
