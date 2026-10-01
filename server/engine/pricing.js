import { SIZE_BANDS } from './constants.js';

/**
 * Estimated cost per video (GBP) for every creator size in one market +
 * platform, for sizes with no cost entered. Order of sources:
 *   1. the rate card (entered by the team): used as is, and as an anchor
 *   2. "history": the reliable historical typical (median) for the exact
 *      market + platform + size
 *   3. "interpolated": between the nearest priced sizes below and above,
 *      proportionally (log scale by size step)
 *   4. "curve": the overall historical size-to-size price curve, scaled to
 *      whatever prices exist for this market + platform (or the platform)
 * Never 0, and no size is left out while any historical cost data exists.
 *
 * @returns {Record<string, {perVideo:number, basis:'rate card'|'history'|'interpolated'|'curve'}>}
 */
export function estimateRates(archetypes, settings, market, platform) {
  const minN = settings.confidenceHigh ?? 10;
  const minC = settings.minCampaigns ?? 3;
  const reliable = (a) => a && a.cost_p50 > 0 && a.n_cost >= minN && (a.n_cost_campaigns ?? 0) >= minC;
  const find = (level, size, m, p) =>
    archetypes.find((a) => a.level === level && a.size_band === size && (m == null || a.market === m) && (p == null || a.platform === p));
  const sizes = SIZE_BANDS.map((b) => b.key);

  // Overall size curve: typical cost by size across all bookings, gaps filled log-linearly.
  const curve = fillLogLinear(sizes.map((s) => {
    const a = find(6, s);
    return a?.cost_p50 > 0 ? a.cost_p50 : null;
  }));

  // Priced sizes for this market + platform: rate card first, then reliable exact history.
  const card = settings.planningRates || {};
  const out = {};
  const priced = sizes.map((s) => {
    const entered = Number(card[`${market}|${platform}|${s}`]);
    if (entered > 0) {
      out[s] = { perVideo: entered, basis: 'rate card' };
      return entered;
    }
    const h = find(2, s, market, platform);
    if (reliable(h)) {
      out[s] = { perVideo: h.cost_p50, basis: 'history' };
      return h.cost_p50;
    }
    return null;
  });

  // Scale of this market + platform against the curve (geometric mean of ratios);
  // without local prices, the platform's reliable prices; otherwise the curve as is.
  const scaleFrom = (prices) => {
    const logs = prices.map((p, i) => (p > 0 && curve[i] > 0 ? Math.log(p / curve[i]) : null)).filter((x) => x != null);
    return logs.length ? Math.exp(logs.reduce((s, x) => s + x, 0) / logs.length) : null;
  };
  const scale = scaleFrom(priced)
    ?? scaleFrom(sizes.map((s) => { const a = find(5, s, null, platform); return reliable(a) ? a.cost_p50 : null; }))
    ?? 1;

  sizes.forEach((s, i) => {
    if (out[s]) return;
    let lo = i - 1;
    while (lo >= 0 && priced[lo] == null) lo--;
    let hi = i + 1;
    while (hi < sizes.length && priced[hi] == null) hi++;
    if (lo >= 0 && hi < sizes.length) {
      const t = (i - lo) / (hi - lo);
      out[s] = { perVideo: Math.exp(Math.log(priced[lo]) + t * (Math.log(priced[hi]) - Math.log(priced[lo]))), basis: 'interpolated' };
    } else if (curve[i] > 0) {
      out[s] = { perVideo: curve[i] * scale, basis: 'curve' };
    }
  });
  for (const s of Object.keys(out)) out[s].perVideo = Math.round(out[s].perVideo * 100) / 100;
  return out;
}

// Fills nulls by log-linear interpolation; ends take the nearest value.
function fillLogLinear(xs) {
  const idx = xs.map((x, i) => (x > 0 ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return xs;
  return xs.map((x, i) => {
    if (x > 0) return x;
    const lo = [...idx].reverse().find((j) => j < i);
    const hi = idx.find((j) => j > i);
    if (lo == null) return xs[hi];
    if (hi == null) return xs[lo];
    const t = (i - lo) / (hi - lo);
    return Math.exp(Math.log(xs[lo]) + t * (Math.log(xs[hi]) - Math.log(xs[lo])));
  });
}
