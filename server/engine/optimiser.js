// Exact optimiser for "budget to package" (spec section 4, step 3).
//
// Dynamic programming over creator money in fixed steps (default £25). Package
// costs are rounded UP to whole steps, so any package the search finds is
// affordable at its exact cost. Extra state dimensions are only added when the
// objective or a constraint needs them:
//   n = creators in the package (Content/Balanced, min/max creators, required videos)
//   s = sizes used (Balanced bonus)
//   b = creators above 350k followers (when a maximum is set)
// If the state space would be too large, the step is widened in £25
// increments and the step used is returned.

const NEG = -Infinity;

/**
 * @param {object} p
 * @param {{key:string,cost:number,views:number,big?:boolean}[]} p.options  per creator: package cost and P25 package views
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

  const needN = objective !== 'Performance' || minCreators > 0 || maxCreators != null;
  const needS = objective === 'Balanced';
  const needB = maxBig != null && options.some((o) => o.big);

  const cheapest = Math.min(...options.map((o) => o.cost));
  const nCap = needN ? Math.min(maxCreators ?? Infinity, Math.floor(C / cheapest)) : 0;
  if (needN && nCap < minCreators) {
    return { feasible: false, reason: `Creator money only covers ${nCap} creators; minimum is ${minCreators}.` };
  }
  const nDim = nCap + 1;
  const sDim = needS ? options.length + 1 : 1;
  const bDim = needB ? maxBig + 1 : 1;
  let U = Math.floor(C / step);
  while ((U + 1) * nDim * sDim * bDim > stateBudget) {
    step += 25;
    U = Math.floor(C / step);
  }
  const total = (U + 1) * nDim * sDim * bDim;
  const idx = (c, n, s, b) => ((c * nDim + n) * sDim + s) * bDim + b;

  let table = new Float64Array(total).fill(NEG);
  table[idx(0, 0, 0, 0)] = 0;
  const units = options.map((o) => Math.ceil(o.cost / step));
  const choices = [];

  options.forEach((o, k) => {
    const u = units[k];
    const dn = needN ? 1 : 0;
    const ds = needS ? 1 : 0;
    const db = needB && o.big ? 1 : 0;
    const A = new Float64Array(total).fill(NEG);
    const cntA = new Uint16Array(total);
    const choice = new Uint16Array(total);
    const next = table.slice();
    for (let c = u; c <= U; c++) {
      for (let n = dn; n < nDim; n++) {
        for (let s = 0; s < sDim; s++) {
          for (let b = db; b < bDim; b++) {
            const i = idx(c, n, s, b);
            let best = NEG;
            let cnt = 0;
            // first creator of this size: comes from the table before this size
            if (s - ds >= 0) {
              const prev = table[idx(c - u, n - dn, s - ds, b - db)];
              if (prev !== NEG) {
                best = prev + o.views;
                cnt = 1;
              }
            }
            // another creator of this size
            const j = idx(c - u, n - dn, s, b - db);
            if (A[j] !== NEG && A[j] + o.views > best) {
              best = A[j] + o.views;
              cnt = cntA[j] + 1;
            }
            if (best !== NEG) {
              A[i] = best;
              cntA[i] = cnt;
              if (best > next[i]) {
                next[i] = best;
                choice[i] = cnt;
              }
            }
          }
        }
      }
    }
    choices.push(choice);
    table = next;
  });

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

  // Walk back through the per-size choices.
  let rem = bestI;
  const decode = (i) => {
    const b = i % bDim;
    const s = Math.floor(i / bDim) % sDim;
    const n = Math.floor(i / (bDim * sDim)) % nDim;
    const c = Math.floor(i / (bDim * sDim * nDim));
    return { c, n, s, b };
  };
  const counts = new Array(options.length).fill(0);
  for (let k = options.length - 1; k >= 0; k--) {
    const m = choices[k][rem];
    counts[k] = m;
    if (m > 0) {
      const st = decode(rem);
      rem = idx(
        st.c - m * units[k],
        st.n - (needN ? m : 0),
        st.s - (needS ? 1 : 0),
        st.b - (needB && options[k].big ? m : 0),
      );
    }
  }

  // Money left over buys one more creator from the cheapest allowed size while it fits.
  let allocated = counts.reduce((sum, m, k) => sum + m * options[k].cost, 0);
  let creators = counts.reduce((a, b) => a + b, 0);
  let bigCount = counts.reduce((a, m, k) => a + (options[k].big ? m : 0), 0);
  const byCost = options.map((o, k) => ({ o, k })).sort((a, b) => a.o.cost - b.o.cost);
  for (;;) {
    if (maxCreators != null && creators >= maxCreators) break;
    const pick = byCost.find(({ o }) => o.cost <= C - allocated && !(o.big && maxBig != null && bigCount >= maxBig));
    if (!pick) break;
    counts[pick.k]++;
    allocated += pick.o.cost;
    creators++;
    if (pick.o.big) bigCount++;
  }

  return {
    feasible: true,
    counts: Object.fromEntries(options.map((o, k) => [o.key, counts[k]]).filter(([, m]) => m > 0)),
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
