import { mulberry32, percentile } from './stats.js';

const Z75 = 0.6744897501960817; // standard normal quantile at 75%

// Log-normal fitted to P25/P50/P75 of views per video.
export function fitLogNormal({ p25, p50, p75 }) {
  const mu = Math.log(Math.max(p50, 1));
  const lo = Math.log(Math.max(p25 ?? p50, 1));
  const hi = Math.log(Math.max(p75 ?? p50, 1));
  return { mu, sigma: Math.max(0, (hi - lo) / (2 * Z75)) };
}

function normal(rand) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/**
 * Runs the campaign `runs` times (spec section 4, step 4).
 * @param {{count:number, videos:number, p25:number, p50:number, p75:number}[]} groups paid creators by size
 * @param {{count:number, postingRate:number, p25:number, p50:number, p75:number}|null} gifted
 * Groups may carry a `tag` (e.g. the tier); totals per tag come from the same
 * runs, so a tag's percentile is never above the overall one.
 * @returns {{p10:number,p50:number,p75:number, percentile:(p:number)=>number, byTag:Record<string,{percentile:(p:number)=>number}>}}
 */
export function simulateViews(groups, gifted, { runs = 5000, seed = 1 } = {}) {
  const rand = mulberry32(seed);
  const dists = groups.map((g) => ({ ...g, ...fitLogNormal(g) }));
  const gd = gifted && gifted.count > 0 ? { ...gifted, ...fitLogNormal(gifted) } : null;
  const totals = new Float64Array(runs);
  const tags = [...new Set(dists.map((d) => d.tag).filter((t) => t != null))];
  if (gd && gd.tag != null && !tags.includes(gd.tag)) tags.push(gd.tag);
  const tagTotals = Object.fromEntries(tags.map((t) => [t, new Float64Array(runs)]));
  for (let r = 0; r < runs; r++) {
    let total = 0;
    for (const d of dists) {
      let sub = 0;
      for (let i = 0; i < d.count; i++) {
        sub += Math.exp(d.mu + d.sigma * normal(rand)) * d.videos;
      }
      total += sub;
      if (d.tag != null) tagTotals[d.tag][r] += sub;
    }
    if (gd) {
      let sub = 0;
      for (let i = 0; i < gd.count; i++) {
        if (rand() < gd.postingRate) sub += Math.exp(gd.mu + gd.sigma * normal(rand));
      }
      total += sub;
      if (gd.tag != null) tagTotals[gd.tag][r] += sub;
    }
    totals[r] = total;
  }
  const arr = Array.from(totals);
  const byTag = Object.fromEntries(
    Object.entries(tagTotals).map(([t, xs]) => {
      const a = Array.from(xs);
      return [t, { percentile: (p) => percentile(a, p), p50: percentile(a, 50), p75: percentile(a, 75) }];
    }),
  );
  return {
    byTag,
    percentile: (p) => percentile(arr, p),
    p10: percentile(arr, 10),
    p50: percentile(arr, 50),
    p75: percentile(arr, 75),
  };
}
