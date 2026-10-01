import React, { useEffect, useState } from 'react';
import { fmtInt, fmtMoney, fmtPct } from './format.js';

// Commercial adjustment for one package: standard quote -> final quote, with a reason.
export default function Commercial({ pkg, meta, busy, onSave }) {
  const r = pkg.result;
  const i = r.internal;
  const cur = r.currency;
  const standard = i.standardPrice ?? r.client.price;
  const cost = i.costs?.total ?? 0;
  const pass = (Number(i.costs?.paidMedia) || 0) + (Number(i.costs?.boostingPassThrough) || 0);
  const serviceMargin = (q) => (q - pass > 0 ? (q - pass - (cost - pass)) / (q - pass) : null);
  const init = () => ({
    pct: i.commercial?.finalPrice != null ? '' : i.commercial?.adjustmentPct || '',
    price: i.commercial?.finalPrice ?? '',
    reason: i.commercial?.reason || '',
    context: i.commercial?.context || '',
    note: i.commercial?.note || '',
  });
  const [c, setC] = useState(init);
  useEffect(() => setC(init()), [pkg.id, pkg.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const final = c.price !== '' ? Number(c.price) : Math.round(standard * (1 + (Number(c.pct) || 0) / 100));
  const pct = standard ? (final / standard - 1) * 100 : 0;
  const margin = serviceMargin(final);
  const blended = final ? (final - cost) / final : null;
  const dirty = JSON.stringify(c) !== JSON.stringify(init());
  const adjusted = Math.abs(final - standard) >= 1;

  const save = () =>
    onSave({
      adjustmentPct: c.price !== '' ? 0 : Number(c.pct) || 0,
      finalPrice: c.price !== '' ? Number(c.price) : null,
      reason: c.reason,
      context: c.context,
      note: c.note,
    });

  return (
    <div className="commercial">
      <h2>Commercial adjustment</h2>
      <div className="quote-row">
        <div><span className="muted small">Calculated standard quote</span><b>{fmtMoney(standard, cur)}</b><span className="muted small">service margin {fmtPct(i.standardMargin)}</span></div>
        <div className="arrow">→</div>
        <div className="final"><span className="muted small">Final quote</span><b>{fmtMoney(final, cur)}</b><span className={margin < (meta.settings.marginWarning ?? 0.4) ? 'bad small' : 'good small'}>service margin {fmtPct(margin)}</span><span className="muted small">blended {fmtPct(blended)}</span></div>
      </div>
      <div className="row2">
        <label className="field">
          <span>Adjustment (%)</span>
          <input className="line" type="number" step="any" placeholder="e.g. 15 or -10" value={c.price !== '' ? pct.toFixed(1) : c.pct} onChange={(e) => setC({ ...c, pct: e.target.value, price: '' })} />
        </label>
        <label className="field">
          <span>or final price, {cur}</span>
          <input className="line" type="number" min="0" placeholder={fmtInt(standard)} value={c.price} onChange={(e) => setC({ ...c, price: e.target.value, pct: '' })} />
        </label>
        <label className="field">
          <span>Reason</span>
          <select className="line" value={c.reason} onChange={(e) => setC({ ...c, reason: e.target.value })}>
            <option value="">{adjusted ? 'Choose…' : '—'}</option>
            {meta.adjustmentReasons.map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Pricing context</span>
          <select className="line" value={c.context} onChange={(e) => setC({ ...c, context: e.target.value })}>
            <option value="">—</option>
            {meta.pricingContexts.map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Note</span>
        <input className="line" value={c.note} onChange={(e) => setC({ ...c, note: e.target.value })} />
      </label>
      <div className="actions">
        <button className="ghost" disabled={busy || !dirty || (adjusted && !c.reason)} onClick={save}>Save adjustment</button>
        {adjusted && !c.reason && <span className="muted small">Choose a reason to save.</span>}
      </div>
    </div>
  );
}
