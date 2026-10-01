import { mulberry32, percentile } from './stats.js';

/**
 * Runs the campaign `runs` times (spec section 4, step 4), sampling the cleaned
 * historical views-per-video observations themselves, so no simulated video
 * gets more views than one actually observed.
 *
 * Thin history is uncertainty too: each run first re-draws the historical
 * sample (a bootstrap, same size as the history), then draws every creator
 * from that re-drawn sample. More creators average out creator-to-creator
 * spread, but not the doubt about a 10-observation history: with few
 * observations the re-drawn samples differ a lot from run to run, and the
 * guarantee stays wide however many creators are booked.
 *
 * @param {{count:number, videos:number, sample:number[], tag?:string}[]} groups paid creators by type
 * @param {{count:number, postingRate:number, sample:number[], tag?:string}|null} gifted
 * Groups with the same `sample` array share the re-drawn history within a run.
 * Totals per `tag` (e.g. the tier) come from the same runs, so a tag's
 * percentile is never above the overall one.
 */
export function simulateViews(groups, gifted, { runs = 5000, seed = 1 } = {}) {
  const rand = mulberry32(seed);
  const all = [...groups.map((g) => ({ ...g, posting: 1 })), ...(gifted && gifted.count > 0 ? [{ ...gifted, videos: 1, posting: gifted.postingRate }] : [])]
    .filter((g) => g.count > 0 && g.sample?.length);
  const samples = [...new Set(all.map((g) => g.sample))];
  const worlds = samples.map((s) => new Float64Array(s.length));
  const worldOf = all.map((g) => worlds[samples.indexOf(g.sample)]);

  const totals = new Float64Array(runs);
  const tags = [...new Set(all.map((g) => g.tag).filter((t) => t != null))];
  const tagTotals = Object.fromEntries(tags.map((t) => [t, new Float64Array(runs)]));
  for (let r = 0; r < runs; r++) {
    // Re-draw each history for this run.
    for (let k = 0; k < samples.length; k++) {
      const s = samples[k];
      const w = worlds[k];
      for (let i = 0; i < s.length; i++) w[i] = s[Math.floor(rand() * s.length)];
    }
    let total = 0;
    for (let j = 0; j < all.length; j++) {
      const g = all[j];
      const w = worldOf[j];
      let sub = 0;
      for (let i = 0; i < g.count; i++) {
        if (g.posting < 1 && rand() >= g.posting) continue;
        sub += w[Math.floor(rand() * w.length)] * g.videos;
      }
      total += sub;
      if (g.tag != null) tagTotals[g.tag][r] += sub;
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
