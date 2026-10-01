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
        g = { level: lvl.level, size: r.size, costs: [], views: [], campaigns: new Set(), costCampaigns: new Set(), viewCampaigns: new Set() };
        for (const d of ['market', 'platform', 'niche']) g[d] = lvl.dims.includes(d) ? r[d] : null;
        groups.set(key, g);
      }
      if (r.campaign) g.campaigns.add(r.campaign);
      if (r.costPerVideo) {
        g.costs.push(r.costPerVideo);
        if (r.campaign) g.costCampaigns.add(r.campaign);
      }
      if (r.views) {
        g.views.push(r.views);
        if (r.campaign) g.viewCampaigns.add(r.campaign);
      }
    }
  }

  const archetypes = [];
  for (const g of groups.values()) {
    archetypes.push({
      level: g.level,
      market: g.market,
      platform: g.platform,
      niche: g.niche,
      size_band: g.size,
      n_cost: g.costs.length,
      n_views: g.views.length,
      n_cost_campaigns: g.costCampaigns.size,
      n_views_campaigns: g.viewCampaigns.size,
      confidence: confidenceFor(g.costs.length, g.costCampaigns.size, settings),
      cost_p50: percentile(g.costs, 50),
      cost_p65: percentile(g.costs, settings.planningPercentile),
      cost_p80: percentile(g.costs, settings.approvalPercentile ?? 80),
      n_campaigns: g.campaigns.size,
      views_p25: percentile(g.views, 25),
      views_p50: percentile(g.views, 50),
      views_p75: percentile(g.views, 75),
      // The cleaned views-per-video observations themselves: the simulation samples these.
      views_sample: g.views.length ? g.views.map(Math.round).sort((a, b) => a - b) : null,
    });
  }

  return { archetypes, flags, factors: multiVideoFactors(records, settings), stats };
}

// High = reliable: enough observations from enough distinct campaigns.
export function confidenceFor(n, campaigns, settings) {
  if (n >= settings.confidenceHigh && campaigns >= (settings.minCampaigns ?? 3)) return 'High';
  if (n >= settings.confidenceMedium) return 'Medium';
  return 'Low';
}

const reliable = (n, campaigns, settings) => n >= settings.confidenceHigh && campaigns >= (settings.minCampaigns ?? 3);

// F(v) = median cost per video at v videos ÷ median cost per video over all
// bookings in the size band. The planning cost (P65) is already taken over all
// bookings, whatever their video count, so F is measured against the same base;
// measuring it against 1-video bookings would count the multi-video discount
// twice. 1.0 unless the v-video group has enough records. v videos never cost
// less than one video at the base rate (F(v) ≥ 1/v).
function multiVideoFactors(records, settings) {
  const out = {};
  for (const band of SIZE_BANDS) {
    const all = [];
    const allCampaigns = new Set();
    const byV = new Map();
    for (const r of records) {
      if (r.size !== band.key || !r.costPerVideo) continue;
      all.push(r.costPerVideo);
      allCampaigns.add(r.campaign);
      if (!byV.has(r.videos)) byV.set(r.videos, { costs: [], campaigns: new Set() });
      byV.get(r.videos).costs.push(r.costPerVideo);
      byV.get(r.videos).campaigns.add(r.campaign);
    }
    const factors = {};
    if (reliable(all.length, allCampaigns.size, settings)) {
      const base = median(all);
      for (const [v, { costs, campaigns }] of byV) {
        if (!reliable(costs.length, campaigns.size, settings)) continue;
        factors[v] = { factor: Math.max(1 / v, median(costs) / base), n: costs.length, campaigns: campaigns.size };
      }
    }
    out[band.key] = factors;
  }
  return out;
}

export function multiVideoFactor(factors, size, v) {
  const f = factors?.[size]?.[v]?.factor ?? 1;
  return Math.max(1 / v, f);
}

// ---- lookup --------------------------------------------------------------

/**
 * Picks the cost row for one size: the most specific fallback level that is
 * reliable (enough bookings from enough campaigns). If no level is, the
 * broadest row with cost data is used and flagged. Values are never combined
 * across levels.
 */
export function pickArchetype(archetypes, { market, platform, niche, size }, settings = {}) {
  const q = { market, platform, niche };
  const minN = settings.confidenceHigh ?? 10;
  const minC = settings.minCampaigns ?? 3;
  let broadest = null;
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
    const camps = row.n_cost_campaigns ?? row.n_campaigns ?? 0;
    if (row.n_cost >= minN && camps >= minC) return { ...row, levelLabel: lvl.label, lowFallback: false, costCampaigns: camps };
    broadest = { ...row, levelLabel: lvl.label, lowFallback: true, costCampaigns: camps };
  }
  return broadest;
}

/**
 * Picks the row whose views feed the simulation (and so the guarantee): the
 * most specific level with at least `minSample` view observations from at
 * least minCampaigns campaigns. Otherwise the broadest row with views is used
 * and flagged thin.
 */
export function pickViewsRow(archetypes, { market, platform, niche, size }, minSample, minCampaigns = 3) {
  const q = { market, platform, niche };
  let broadest = null;
  for (const lvl of LEVELS) {
    if (lvl.dims.some((d) => !q[d])) continue;
    const row = archetypes.find(
      (a) => a.level === lvl.level && a.size_band === size && lvl.dims.every((d) => a[d] === q[d]) && a.views_p50 != null,
    );
    if (!row) continue;
    const camps = row.n_views_campaigns ?? row.n_campaigns ?? 0;
    if (row.n_views >= minSample && camps >= minCampaigns) return { ...row, levelLabel: lvl.label, thin: false, viewCampaigns: camps };
    broadest = { ...row, levelLabel: lvl.label, thin: true, viewCampaigns: camps };
  }
  return broadest;
}
