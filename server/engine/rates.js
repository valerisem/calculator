import { LEVELS, SIZE_BANDS, sizeBandFor } from './constants.js';
import { median, percentile } from './stats.js';

// ---- normalisation -------------------------------------------------------

const MARKET_ALIASES = {
  usa: 'US', us: 'US', 'united states': 'US', 'united states of america': 'US', america: 'US',
  uk: 'UK', 'united kingdom': 'UK', england: 'UK', scotland: 'UK', wales: 'UK', london: 'UK',
  'midlands-wales': 'UK', 'great britain': 'UK', gb: 'UK',
  ca: 'Canada', canada: 'Canada',
  au: 'Australia', australia: 'Australia',
  nz: 'New Zealand', 'new zealand': 'New Zealand',
  nl: 'Netherlands', netherlands: 'Netherlands', holland: 'Netherlands',
  de: 'Germany', germany: 'Germany',
  fr: 'France', france: 'France',
  es: 'Spain', spain: 'Spain',
  it: 'Italy', italy: 'Italy',
  uae: 'UAE', 'united arab emirates': 'UAE',
};
const EMPTY_MARKETS = new Set(['', 'nothing', 'none', 'n/a', 'na', '-', 'null', 'unknown']);

export function normaliseMarket(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const k = s.toLowerCase();
  if (EMPTY_MARKETS.has(k)) return null;
  if (MARKET_ALIASES[k]) return MARKET_ALIASES[k];
  return s.replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const PLATFORM_FOLLOWERS = [
  ['TikTok', 'tiktok', 'tiktok_followers'],
  ['Instagram', 'instagram', 'instagram_followers'],
  ['YouTube', 'youtube', 'youtube_followers'],
];

// A booking can list several platforms. It counts once, for the first listed
// platform that has a follower count; with no platform listed, for the first
// platform (TikTok, Instagram, YouTube) that has a follower count.
export function resolvePlatform(b) {
  const listed = String(b.platform || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const order = listed.length
    ? listed.map((l) => PLATFORM_FOLLOWERS.find((p) => p[1] === l)).filter(Boolean)
    : PLATFORM_FOLLOWERS;
  for (const [name, , col] of order) {
    const f = Number(b[col]);
    if (f > 0) return { platform: name, followers: f };
  }
  return null;
}

// ---- build ---------------------------------------------------------------

/**
 * Builds the rate table from creator bookings (Monday client boards) joined to
 * campaigns. Returns archetype rows for every fallback level, the records that
 * were flagged as outliers, multi-video factors per size band, and counts.
 */
export function buildRateTable(bookings, campaigns, settings) {
  const campaignByDeal = new Map(campaigns.map((c) => [String(c.pd_deal_id), c]));
  // People whose campaigns feed the rates: the listed owners plus everyone in the
  // listed pods. A campaign counts if one of them is its account owner or SCM.
  const owners = [...(settings.rateOwnerIds || []), ...(settings.ratePodMemberIds || [])].map(Number);
  const kept = new RegExp(settings.keptGroupPattern, 'i');
  const dropped = new RegExp(settings.droppedGroupPattern, 'i');

  const stats = { bookings: bookings.length, notOwner: 0, droppedGroup: 0, noFollowers: 0, flagged: 0, used: 0 };
  const flags = [];
  const records = [];

  for (const b of bookings) {
    const campaign = campaignByDeal.get(String(b.campaign_number));
    if (owners.length && !(campaign && (owners.includes(Number(campaign.account_owner_id)) || owners.includes(Number(campaign.scm_id))))) {
      stats.notOwner++;
      continue;
    }
    const group = b.board_group || '';
    if (!kept.test(group) || dropped.test(group)) {
      stats.droppedGroup++;
      continue;
    }
    const pf = resolvePlatform(b);
    const size = pf && sizeBandFor(pf.followers);
    if (!size) {
      stats.noFollowers++;
      continue;
    }
    const views = Number(b.avg_views) > 0 ? Number(b.avg_views) : null;
    if (views && (views > settings.outlierFollowerMultiple * pf.followers || views > settings.outlierMaxViews)) {
      stats.flagged++;
      flags.push({
        booking_id: b.id,
        reason: views > settings.outlierMaxViews ? 'views_above_max' : 'views_above_follower_multiple',
        views,
        followers: pf.followers,
      });
      continue;
    }
    const fee = Number(b.fee_gbp) > 0 ? Number(b.fee_gbp) : null;
    const videos = Number(b.deliverables) > 0 ? Number(b.deliverables) : null;
    records.push({
      campaign: b.campaign_number || null,
      market: normaliseMarket(b.location),
      platform: pf.platform,
      niche: campaign?.wide_niche || null,
      size,
      views,
      videos,
      costPerVideo: fee && videos ? fee / videos : null,
    });
    stats.used++;
  }

  // Group records at every level.
  const groups = new Map();
  for (const r of records) {
    for (const lvl of LEVELS) {
      if (lvl.dims.some((d) => !r[d])) continue;
      const key = [lvl.level, ...lvl.dims.map((d) => r[d]), r.size].join('|');
      let g = groups.get(key);
      if (!g) {
        g = { level: lvl.level, size: r.size, costs: [], views: [], campaigns: new Set() };
        for (const d of ['market', 'platform', 'niche']) g[d] = lvl.dims.includes(d) ? r[d] : null;
        groups.set(key, g);
      }
      if (r.costPerVideo) g.costs.push(r.costPerVideo);
      if (r.campaign) g.campaigns.add(r.campaign);
      if (r.views) g.views.push(r.views);
    }
  }

  const archetypes = [];
  for (const g of groups.values()) {
    const n = Math.min(g.costs.length, g.views.length);
    archetypes.push({
      level: g.level,
      market: g.market,
      platform: g.platform,
      niche: g.niche,
      size_band: g.size,
      n_cost: g.costs.length,
      n_views: g.views.length,
      confidence: confidenceFor(n, settings),
      cost_p50: percentile(g.costs, 50),
      cost_p65: percentile(g.costs, settings.planningPercentile),
      cost_p80: percentile(g.costs, settings.approvalPercentile ?? 80),
      n_campaigns: g.campaigns.size,
      views_p25: percentile(g.views, 25),
      views_p50: percentile(g.views, 50),
      views_p75: percentile(g.views, 75),
    });
  }

  return { archetypes, flags, factors: multiVideoFactors(records, settings), stats };
}

export function confidenceFor(n, settings) {
  if (n >= settings.confidenceHigh) return 'High';
  if (n >= settings.confidenceMedium) return 'Medium';
  return 'Low';
}

// F(v) = median cost per video at v videos ÷ median cost per video at 1 video,
// within the size band. 1.0 unless both groups have enough records.
function multiVideoFactors(records, settings) {
  const out = {};
  for (const band of SIZE_BANDS) {
    const byV = new Map();
    for (const r of records) {
      if (r.size !== band.key || !r.costPerVideo) continue;
      if (!byV.has(r.videos)) byV.set(r.videos, []);
      byV.get(r.videos).push(r.costPerVideo);
    }
    const one = byV.get(1) || [];
    const factors = {};
    for (const [v, costs] of byV) {
      if (v === 1) continue;
      if (one.length >= settings.confidenceHigh && costs.length >= settings.confidenceHigh) {
        factors[v] = { factor: median(costs) / median(one), n: costs.length };
      }
    }
    out[band.key] = factors;
  }
  return out;
}

export function multiVideoFactor(factors, size, v) {
  if (v === 1) return 1;
  return factors?.[size]?.[v]?.factor ?? 1;
}

// ---- lookup --------------------------------------------------------------

/**
 * Picks the archetype row for one size: the first fallback level that is
 * Medium or High confidence. If none is, the most specific Low row is used and
 * flagged. Values are never combined across levels.
 */
export function pickArchetype(archetypes, { market, platform, niche, size }) {
  const q = { market, platform, niche };
  let firstLow = null;
  for (const lvl of LEVELS) {
    if (lvl.dims.some((d) => !q[d])) continue;
    const row = archetypes.find(
      (a) =>
        a.level === lvl.level &&
        a.size_band === size &&
        lvl.dims.every((d) => a[d] === q[d]) &&
        a.cost_p65 != null &&
        a.views_p50 != null,
    );
    if (!row) continue;
    if (row.confidence !== 'Low') return { ...row, levelLabel: lvl.label, lowFallback: false };
    if (!firstLow) firstLow = { ...row, levelLabel: lvl.label, lowFallback: true };
  }
  return firstLow;
}

/**
 * Picks the row whose views feed the simulation (and so the P10 guarantee).
 * Needs at least `minSample` view records; otherwise falls back to a broader
 * level, down to size only. If even that is short, the broadest row with data
 * is used and flagged.
 */
export function pickViewsRow(archetypes, { market, platform, niche, size }, minSample) {
  const q = { market, platform, niche };
  let broadest = null;
  for (const lvl of LEVELS) {
    if (lvl.dims.some((d) => !q[d])) continue;
    const row = archetypes.find(
      (a) => a.level === lvl.level && a.size_band === size && lvl.dims.every((d) => a[d] === q[d]) && a.views_p50 != null,
    );
    if (!row) continue;
    if (row.n_views >= minSample) return { ...row, levelLabel: lvl.label, thin: false };
    broadest = { ...row, levelLabel: lvl.label, thin: true };
  }
  return broadest;
}
