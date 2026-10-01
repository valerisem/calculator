import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculate } from '../server/engine/calculator.js';
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

  const tooSmall = calculate({ ...base, mode: 'budget', budget: 1000, currency: 'GBP', paidMedia: 600 }, ctx);
  assert.equal(tooSmall.ok, false);
  assert.match(tooSmall.error, /Budget too small/);

  const usd = calculate({ ...base, mode: 'budget', budget: 25000, currency: 'USD', boosting: 600 }, ctx);
  assert.ok(usd.ok);
  assert.equal(usd.client.boostedViews, 100000); // $600 at $6 per 1,000
});
