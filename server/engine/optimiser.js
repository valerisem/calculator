// Exact optimiser for "budget to package" (spec section 4, step 3).
//
// Dynamic programming over creator money in fixed steps (default £25). Package
// costs are rounded UP to whole steps, so any package the search finds is
// affordable at its exact cost. Extra state dimensions are only added when the
// objective or a constraint needs them:
//   n = creators in the package (Content/Balanced, min/max creators, required videos)
//   s = sizes used (Balanced bonus, "+5% per extra size used")
//   b = creators above 350k followers (when a maximum is set)
// Options are grouped by size (`group`); a size can be bought through several
// options (e.g. the same size in different markets or platforms) and still
// counts once towards s. If the state space would be too large, the step is
// widened in £25 increments and the step used is returned.

const NEG = -Infinity;

/**
 * @param {object} p
 * @param {{key:string,group?:string,cost:number,views:number,big?:boolean}[]} p.options per creator: package cost and P25 package views
 * @param {number} p.creatorMoney  C
 * @param {string} p.objective  Performance | Balanced | Content
 * @param {number} [p.step=25]
 * @param {number} [p.minCreators]
 * @param {number} [p.maxCreators]
 * @param {number} [p.maxBig]  maximum creators in big (350k+) sizes
 * @param {number} [p.sizeBonus=0.05]
 * @param {number} [p.creatorBonus=0.01]
 * @param {number} [p.stateBudget=2_000_000]
 */
export function optimise(p) {
  const {
    creatorMoney: C,
    objective,
    minCreators = 0,
    maxCreators = null,
    maxBig = null,
    sizeBonus = 0.05,
    creatorBonus = 0.01,
    stateBudget = 2_000_000,
  } = p;
  let step = p.step || 25;

  let options = p.options.filter((o) => o.cost > 0 && o.cost <= C);
  if (maxBig === 0) options = options.filter((o) => !o.big);
  if (!options.length) return { feasible: false, reason: 'No allowed creator size fits the creator money.' };

  // Groups of options (one group per size), in first-seen order.
  const groups = [];
  const byGroup = new Map();
  for (const o of options) {
    const g = o.group ?? o.key;
    if (!byGroup.has(g)) {
      byGroup.set(g, []);
      groups.push(byGroup.get(g));
    }
    byGroup.get(g).push(o);
  }

  const needN = objective !== 'Performance' || minCreators > 0 || maxCreators != null;
  const needS = objective === 'Balanced';
  const needB = maxBig != null && options.some((o) => o.big);

  const cheapest = Math.min(...options.map((o) => o.cost));
  const nCap = needN ? Math.min(maxCreators ?? Infinity, Math.floor(C / cheapest)) : 0;
  if (needN && nCap < minCreators) {
    return { feasible: false, reason: `Creator money only covers ${nCap} creators; minimum is ${minCreators}.` };
  }
  const nDim = nCap + 1;
  const sDim = needS ? groups.length + 1 : 1;
  const bDim = needB ? maxBig + 1 : 1;
  let U = Math.floor(C / step);
  while ((U + 1) * nDim * sDim * bDim > stateBudget) {
    step += 25;
    U = Math.floor(C / step);
  }
  const total = (U + 1) * nDim * sDim * bDim;
  const idx = (c, n, s, b) => ((c * nDim + n) * sDim + s) * bDim + b;
  const decode = (i) => ({
    b: i % bDim,
    s: Math.floor(i / bDim) % sDim,
    n: Math.floor(i / (bDim * sDim)) % nDim,
    c: Math.floor(i / (bDim * sDim * nDim)),
  });
  const unitsOf = (o) => Math.ceil(o.cost / step);
  const dn = needN ? 1 : 0;
  const ds = needS ? 1 : 0;

  let table = new Float64Array(total).fill(NEG);
  table[idx(0, 0, 0, 0)] = 0;
  // Per group: whether the best state uses the group, and per option how many
  // creators it adds and whether the chain started from "group not used yet".
  const trail = [];

  // Strides for idx(c, n, s, b) = ((c * nDim + n) * sDim + s) * bDim + b.
  const sB = bDim;
  const sS = sDim * bDim;
  const sN = nDim * sDim * bDim;
  const minUnits = Math.min(...options.map(unitsOf));

  // Two working buffers alternate between creator types, so the search does not
  // allocate a fresh table per option.
  const bufs = [new Float64Array(total), new Float64Array(total)];
  let which = 0;

  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    const U0 = table; // states with no creator of this size yet
    let U1 = bufs[which].fill(NEG); // states with at least one
    const steps = [];
    // Sizes used so far can't exceed the groups processed (this one included).
    const sMax = needS ? Math.min(sDim - 1, g + 1) : 0;
    for (const o of group) {
      const u = unitsOf(o);
      const db = needB && o.big ? 1 : 0;
      const w = o.views;
      which ^= 1;
      const A = bufs[which];
      A.set(U1);
      const cnt = new Uint16Array(total);
      const fromU0 = new Uint8Array(total);
      const back = u * sN + dn * sS; // offset to (c - u, n - dn)
      for (let c = u; c <= U; c++) {
        // With c money units you can afford at most c / (cheapest units) creators.
        const nMax = needN ? Math.min(nDim - 1, Math.floor(c / minUnits)) : 0;
        for (let n = dn; n <= nMax; n++) {
          const sTop = needN ? Math.min(sMax, n) : sMax;
          for (let s = 0; s <= sTop; s++) {
            const base = c * sN + n * sS + s * sB;
            for (let b = db; b < bDim; b++) {
              const i = base + b;
              const j = i - back - db; // (c - u, n - dn, s, b - db)
              let best = A[i];
              let k = 0;
              let start = 0;
              // first creator of this size, through this option
              if (s >= ds) {
                const v0 = U0[j - ds * sB];
                if (v0 !== NEG && v0 + w > best) {
                  best = v0 + w;
                  k = 1;
                  start = 1;
                }
              }
              // size already used through an earlier option
              const v1 = U1[j];
              if (v1 !== NEG && v1 + w > best) {
                best = v1 + w;
                k = 1;
                start = 0;
              }
              // another creator through this option
              if (cnt[j] > 0 && A[j] + w > best) {
                best = A[j] + w;
                k = cnt[j] + 1;
                start = fromU0[j];
              }
              if (k > 0) {
                A[i] = best;
                cnt[i] = k;
                fromU0[i] = start;
              }
            }
          }
        }
      }
      steps.push({ o, u, db, cnt, fromU0 });
      U1 = A;
    }
    const used = new Uint8Array(total);
    const next = U0.slice();
    for (let i = 0; i < total; i++) {
      if (U1[i] > next[i]) {
        next[i] = U1[i];
        used[i] = 1;
      }
    }
    trail.push({ used, steps });
    table = next;
  }

  // Pick the best end state under the objective and constraints.
  let bestI = -1;
  let bestScore = null;
  for (let c = 0; c <= U; c++) {
    for (let n = 0; n < nDim; n++) {
      if (needN && n < minCreators) continue;
      for (let s = 0; s < sDim; s++) {
        for (let b = 0; b < bDim; b++) {
          const i = idx(c, n, s, b);
          const v = table[i];
          if (v === NEG || (v === 0 && n === 0 && c === 0)) continue;
          let score;
          if (objective === 'Content') score = [n, v];
          else if (objective === 'Balanced') {
            score = [v * (1 + sizeBonus * Math.max(0, s - 1) + creatorBonus * Math.max(0, n - 1))];
          } else score = [v];
          if (!bestScore || better(score, bestScore)) {
            bestScore = score;
            bestI = i;
          }
        }
      }
    }
  }
  if (bestI < 0) return { feasible: false, reason: 'No package meets the constraints with this creator money.' };

  // Walk back through the groups and their options.
  const counts = new Map();
  let i = bestI;
  for (let g = groups.length - 1; g >= 0; g--) {
    const { used, steps } = trail[g];
    if (!used[i]) continue;
    for (let k = steps.length - 1; k >= 0; k--) {
      const st = steps[k];
      const m = st.cnt[i];
      if (!m) continue;
      counts.set(st.o.key, (counts.get(st.o.key) || 0) + m);
      const start = st.fromU0[i];
      const d = decode(i);
      i = idx(d.c - m * st.u, d.n - m * dn, d.s - (start ? ds : 0), d.b - m * st.db);
      if (start) break; // the chain began before any creator of this size
    }
  }

  // Money left over buys one more creator from the cheapest allowed size while it fits.
  let allocated = 0;
  let creators = 0;
  let bigCount = 0;
  for (const o of options) {
    const m = counts.get(o.key) || 0;
    allocated += m * o.cost;
    creators += m;
    if (o.big) bigCount += m;
  }
  const byCost = [...options].sort((a, b) => a.cost - b.cost);
  for (;;) {
    if (maxCreators != null && creators >= maxCreators) break;
    const pick = byCost.find((o) => o.cost <= C - allocated && !(o.big && maxBig != null && bigCount >= maxBig));
    if (!pick) break;
    counts.set(pick.key, (counts.get(pick.key) || 0) + 1);
    allocated += pick.cost;
    creators++;
    if (pick.big) bigCount++;
  }

  return {
    feasible: true,
    counts: Object.fromEntries(options.map((o) => [o.key, counts.get(o.key) || 0]).filter(([, m]) => m > 0)),
    allocated,
    buffer: C - allocated,
    step,
  };
}

function better(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] > b[i] + 1e-9) return true;
    if (a[i] < b[i] - 1e-9) return false;
  }
  return false;
}
