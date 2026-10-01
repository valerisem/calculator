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
 * @returns {{p10:number,p50:number,p75:number, percentile:(p:number)=>number}}
 */
export function simulateViews(groups, gifted, { runs = 5000, seed = 1 } = {}) {
  const rand = mulberry32(seed);
  const dists = groups.map((g) => ({ ...g, ...fitLogNormal(g) }));
  const gd = gifted && gifted.count > 0 ? { ...gifted, ...fitLogNormal(gifted) } : null;
  const totals = new Float64Array(runs);
  for (let r = 0; r < runs; r++) {
    let total = 0;
    for (const d of dists) {
      for (let i = 0; i < d.count; i++) {
        total += Math.exp(d.mu + d.sigma * normal(rand)) * d.videos;
      }
    }
    if (gd) {
      for (let i = 0; i < gd.count; i++) {
        if (rand() < gd.postingRate) total += Math.exp(gd.mu + gd.sigma * normal(rand));
      }
    }
    totals[r] = total;
  }
  const arr = Array.from(totals);
  return {
    percentile: (p) => percentile(arr, p),
    p10: percentile(arr, 10),
    p50: percentile(arr, 50),
    p75: percentile(arr, 75),
  };
}
