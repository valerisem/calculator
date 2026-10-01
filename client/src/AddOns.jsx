import React from 'react';

const USAGE_LABELS = { organic: 'Organic only', '30d': '30 days', '3m': '3 months', '6m': '6 months', '12m': '12 months', perpetual: 'Perpetual' };
const fmtCur = (n, cur) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur || 'GBP', maximumFractionDigits: 0 }).format(n || 0);
const EXCLUSIVITY_LABELS = { none: 'None', category: 'Category', competitor: 'Competitor restriction' };

// Add-ons & media: boosting (per platform), paid media, gifting, usage rights, other direct costs.
export default function AddOns({ meta, inputs, setInputs, sizes = [] }) {
  const cur = inputs.currency;
  const settings = { ...meta.settings, ...(inputs.settings || {}) };
  const boosts = inputs.boostingLines || [];
  const pm = inputs.paidMedia && typeof inputs.paidMedia === 'object' ? inputs.paidMedia : { spend: inputs.paidMedia || '' };
  const usage = inputs.usage || { rights: 'organic', paidUsage: false, exclusivity: 'none' };

  const setBoost = (i, patch) => setInputs({ ...inputs, boostingLines: boosts.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const addBoost = () =>
    setInputs({ ...inputs, boostingLines: [...boosts, { platform: inputs.platforms?.[0] || 'TikTok', by: 'budget', budget: '', targetViews: '', cpmUsd: '', treatment: 'margin', feeType: 'percent', fee: '' }] });
  const setPm = (patch) => setInputs({ ...inputs, paidMedia: { feeType: settings.paidMediaFeeType, fee: settings.paidMediaFee, ...pm, ...patch } });
  const setUsage = (patch) => setInputs({ ...inputs, usage: { ...usage, ...patch } });
  const gift = inputs.gifting || { enabled: false };
  const setGift = (patch) => setInputs({ ...inputs, gifting: { ...gift, ...patch } });
  const giftN = Math.max(0, Math.round(Number(gift.creators) || 0));
  const giftRate = gift.postingRate === '' || gift.postingRate == null ? settings.giftedPostingRate : Number(gift.postingRate);
  const giftPosts = Math.floor(giftN * giftRate);
  const giftCost = giftN * ((Number(gift.productCost) || 0) + (Number(gift.shippingCost) || 0));
  const giftCostMissing = giftN > 0 && (gift.productCost === '' || gift.productCost == null) && (gift.shippingCost === '' || gift.shippingCost == null);
  const rates = inputs.rateOverrides || [];
  const setRate = (i, patch) => setInputs({ ...inputs, rateOverrides: rates.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const addRate = () => setInputs({ ...inputs, rateOverrides: [...rates, { platform: '*', market: '*', size: 'micro_25k_50k', costPerVideo: '' }] });
  // Current cost per video for the matching creator types (before usage uplift), for reference.
  const upliftF = 1 + (Number(usage.upliftPct) || 0) / 100;
  const refFor = (r) => {
    const xs = sizes
      .filter((z) => z.size === r.size && (r.platform === '*' || z.platform === r.platform) && (r.market === '*' || z.market === r.market))
      .map((z) => z.historicalPerVideo / upliftF);
    if (!xs.length) return null;
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    return Math.round(lo) === Math.round(hi) ? fmtCur(lo, cur) : `${fmtCur(lo, cur)}–${fmtCur(hi, cur)}`;
  };
  const set1 = (k) => (e) => setInputs({ ...inputs, [k]: e.target.value });

  return (
    <div className="addons">
      <div className="addon">
        <div className="addon-head">
          <h3>Boosting</h3>
          <button className="text-link" onClick={addBoost}>+ Add platform</button>
        </div>
        {boosts.map((b, i) => (
          <div className="addon-line" key={i}>
            <div className="row3">
              <label className="field">
                <span>Platform</span>
                <select className="line" value={b.platform} onChange={(e) => setBoost(i, { platform: e.target.value, cpmUsd: '' })}>
                  {meta.boostPlatforms.map((p) => <option key={p}>{p}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Planning CPM ($)</span>
                <input className="line" type="number" min="0" step="any" placeholder={String(settings.boostingCpmUsd?.[b.platform] ?? settings.boostingCostPer1000Usd)} value={b.cpmUsd ?? ''} onChange={(e) => setBoost(i, { cpmUsd: e.target.value })} />
              </label>
              <button className="icon" aria-label="Remove boosting line" onClick={() => setInputs({ ...inputs, boostingLines: boosts.filter((_, j) => j !== i) })}>×</button>
            </div>
            <div className="row3">
              <div className="field">
                <span>Plan by</span>
                <div className="toggle-group small">
                  <button className={b.by !== 'views' ? 'on' : ''} onClick={() => setBoost(i, { by: 'budget' })}>Budget</button>
                  <button className={b.by === 'views' ? 'on' : ''} onClick={() => setBoost(i, { by: 'views' })}>Target views</button>
                </div>
              </div>
              {b.by === 'views' ? (
                <label className="field"><span>Target boosted views</span><input className="line" type="number" min="0" value={b.targetViews} onChange={(e) => setBoost(i, { targetViews: e.target.value })} /></label>
              ) : (
                <label className="field"><span>Budget, {cur}</span><input className="line" type="number" min="0" value={b.budget} onChange={(e) => setBoost(i, { budget: e.target.value })} /></label>
              )}
            </div>
            <div className="row3">
              <div className="field">
                <span>Margin treatment</span>
                <div className="toggle-group small">
                  <button className={b.treatment !== 'passthrough' ? 'on' : ''} onClick={() => setBoost(i, { treatment: 'margin' })}>Campaign margin</button>
                  <button className={b.treatment === 'passthrough' ? 'on' : ''} onClick={() => setBoost(i, { treatment: 'passthrough' })}>Pass-through + fee</button>
                </div>
              </div>
              {b.treatment === 'passthrough' && (
                <FeeInput cur={cur} type={b.feeType} value={b.fee} onType={(feeType) => setBoost(i, { feeType })} onValue={(fee) => setBoost(i, { fee })} />
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="addon">
        <div className="addon-head"><h3>Paid media</h3><span className="muted small">Pass-through spend + management fee</span></div>
        <div className="row3">
          <label className="field"><span>Platform</span><input className="line" placeholder="e.g. Meta" value={pm.platform || ''} onChange={(e) => setPm({ platform: e.target.value })} /></label>
          <label className="field"><span>Media spend, {cur}</span><input className="line" type="number" min="0" value={pm.spend ?? ''} onChange={(e) => setPm({ spend: e.target.value })} /></label>
          <FeeInput cur={cur} type={pm.feeType ?? settings.paidMediaFeeType} value={pm.fee ?? settings.paidMediaFee} onType={(feeType) => setPm({ feeType })} onValue={(fee) => setPm({ fee })} />
        </div>
      </div>

      <div className="addon">
        <div className="addon-head">
          <h3>Gifting</h3>
          <div className="toggle-group small">
            <button className={!gift.enabled ? 'on' : ''} onClick={() => setGift({ enabled: false })}>Off</button>
            <button className={gift.enabled ? 'on' : ''} onClick={() => setGift({ enabled: true })}>On</button>
          </div>
        </div>
        {gift.enabled && (
          <>
            <div className="row3">
              <label className="field"><span>Creators to gift</span><input className="line" type="number" min="0" value={gift.creators ?? ''} onChange={(e) => setGift({ creators: e.target.value })} /></label>
              <label className="field"><span>Product cost per creator, {cur}</span><input className={`line ${giftCostMissing ? 'missing' : ''}`} type="number" min="0" step="any" value={gift.productCost ?? ''} onChange={(e) => setGift({ productCost: e.target.value })} /></label>
              <label className="field"><span>Shipping / fulfilment per creator, {cur}</span><input className={`line ${giftCostMissing ? 'missing' : ''}`} type="number" min="0" step="any" value={gift.shippingCost ?? ''} onChange={(e) => setGift({ shippingCost: e.target.value })} /></label>
            </div>
            <div className="row3">
              <label className="field"><span>Expected posting rate (%)</span><input className="line" type="number" min="0" max="100" step="any" placeholder={String(Math.round(settings.giftedPostingRate * 100))} value={gift.postingRate === '' || gift.postingRate == null ? '' : Math.round(gift.postingRate * 1000) / 10} onChange={(e) => setGift({ postingRate: e.target.value === '' ? '' : Number(e.target.value) / 100 })} /></label>
              <div className="field"><span>Expected gifted posts</span><div className="line static">{giftPosts}</div></div>
              <div className="field"><span>Internal gifting cost</span><div className="line static">{fmtCur(giftCost, cur)}</div></div>
            </div>
            <div className="row3">
              <label className="field"><span>Client gifting charge, {cur} (optional)</span><input className="line" type="number" min="0" step="any" value={gift.clientCharge ?? ''} onChange={(e) => setGift({ clientCharge: e.target.value })} /></label>
            </div>
          </>
        )}
      </div>

      <div className="addon">
        <div className="addon-head"><h3>Usage rights & exclusivity</h3></div>
        <div className="row3">
          <label className="field">
            <span>Usage rights</span>
            <select className="line" value={usage.rights} onChange={(e) => setUsage({ rights: e.target.value })}>
              {meta.usageRights.map((u) => <option key={u} value={u}>{USAGE_LABELS[u]}</option>)}
            </select>
          </label>
          <div className="field">
            <span>Paid usage / whitelisting</span>
            <div className="toggle-group small">
              <button className={!usage.paidUsage ? 'on' : ''} onClick={() => setUsage({ paidUsage: false })}>No</button>
              <button className={usage.paidUsage ? 'on' : ''} onClick={() => setUsage({ paidUsage: true })}>Yes</button>
            </div>
          </div>
          <label className="field">
            <span>Exclusivity</span>
            <select className="line" value={usage.exclusivity} onChange={(e) => setUsage({ exclusivity: e.target.value })}>
              {meta.exclusivity.map((x) => <option key={x} value={x}>{EXCLUSIVITY_LABELS[x]}</option>)}
            </select>
          </label>
        </div>
        {(usage.rights !== 'organic' || usage.paidUsage || usage.exclusivity !== 'none') && (
          <div className="uplift">
            <label className="field">
              <span>Uplift on creator cost (%) <em>required</em></span>
              <input className={`line ${usage.upliftPct === '' || usage.upliftPct == null ? 'missing' : ''}`} type="number" min="0" step="any" placeholder="e.g. 30" value={usage.upliftPct ?? ''} onChange={(e) => setUsage({ upliftPct: e.target.value })} />
            </label>
            <p className="muted small">
              Internal reference only: one UK finance creator went from about £1,200 to £1,800 per video with extended licensing (+50%). Not applied automatically.
            </p>
          </div>
        )}
      </div>

      <div className="addon">
        <div className="addon-head">
          <h3>Creator rates for this proposal</h3>
          <button className="text-link" onClick={addRate}>+ Override a size</button>
        </div>
        {rates.map((r, i) => (
          <div className="row3 rate-line" key={i}>
            <label className="field">
              <span>Size</span>
              <select className="line" value={r.size} onChange={(e) => setRate(i, { size: e.target.value })}>
                {meta.sizes.map((z) => <option key={z.key} value={z.key}>{z.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Platform · market</span>
              <div className="pair">
                <select className="line" value={r.platform} onChange={(e) => setRate(i, { platform: e.target.value })}>
                  <option value="*">All</option>
                  {(inputs.platforms || []).map((p) => <option key={p}>{p}</option>)}
                </select>
                <select className="line" value={r.market} onChange={(e) => setRate(i, { market: e.target.value })}>
                  <option value="*">All</option>
                  {(inputs.markets || []).map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
            </label>
            <label className="field">
              <span>Cost / video, {cur}{refFor(r) ? ` (now ${refFor(r)})` : ''}</span>
              <input className="line" type="number" min="0" step="any" value={r.costPerVideo ?? ''} onChange={(e) => setRate(i, { costPerVideo: e.target.value })} />
            </label>
            <button className="icon" aria-label="Remove rate override" onClick={() => setInputs({ ...inputs, rateOverrides: rates.filter((_, j) => j !== i) })}>×</button>
          </div>
        ))}
      </div>

      <div className="addon">
        <div className="addon-head"><h3>Brand-lift study / other direct costs</h3></div>
        <label className="field"><span>Amount, {cur}</span><input className="line" type="number" min="0" value={inputs.otherCosts} onChange={set1('otherCosts')} /></label>
      </div>
    </div>
  );
}

function FeeInput({ cur, type, value, onType, onValue }) {
  return (
    <div className="field">
      <span>Management fee</span>
      <div className="fee">
        <input className="line" type="number" min="0" step="any" value={value ?? ''} onChange={(e) => onValue(e.target.value)} />
        <div className="toggle-group small">
          <button className={type !== 'fixed' ? 'on' : ''} onClick={() => onType('percent')}>%</button>
          <button className={type === 'fixed' ? 'on' : ''} onClick={() => onType('fixed')}>{cur}</button>
        </div>
      </div>
    </div>
  );
}

export { USAGE_LABELS, EXCLUSIVITY_LABELS };
