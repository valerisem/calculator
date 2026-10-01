import React, { useState } from 'react';
import { fmtInt, fmtMoney, fmtPct } from './format.js';

export default function ResultView({ result, agreedPrice, onAgreedPrice, onAdjust }) {
  const [showInternal, setShowInternal] = useState(true);
  const c = result.client;
  const i = result.internal;
  const cur = result.currency;

  return (
    <>
      <div className="card client-card">
        <div className="row between">
          <h2>What the client sees</h2>
          {onAdjust && <button className="small" onClick={onAdjust}>Adjust creators by hand</button>}
        </div>
        <div className="kpis">
          <Kpi label={result.mode === 'package' ? 'Price to quote' : 'Price'} value={fmtMoney(c.price, cur)} strong />
          <Kpi label="Views we promise" value={fmtInt(c.viewsPromised)} />
          <Kpi label="Reach we promise" value={fmtInt(c.reachPromised)} />
          <Kpi label="Cost per 1,000 views" value={fmtMoney(c.cpm, cur, 2)} />
        </div>
        <table className="table">
          <thead>
            <tr><th>Creator size</th><th>Creators</th><th>Videos each</th><th>Videos</th></tr>
          </thead>
          <tbody>
            {c.creators.map((r) => (
              <tr key={r.size}><td>{r.label}</td><td>{r.count}</td><td>{r.videosEach}</td><td>{r.videos}</td></tr>
            ))}
            {c.giftedCreators > 0 && (
              <tr><td>Gifted creators</td><td>{c.giftedCreators}</td><td>–</td><td>{c.giftedPosts}</td></tr>
            )}
            <tr className="total"><td>Total</td><td>{c.totalCreators + c.giftedCreators}</td><td /><td>{c.totalVideos}</td></tr>
          </tbody>
        </table>
        <div className="muted small">
          Cost per view {fmtMoney(c.cpv, cur, 4)}
          {c.boostedViews > 0 && <> · Boosted views (separate line, not in the promise): {fmtInt(c.boostedViews)}</>}
        </div>
      </div>

      {result.warnings?.length > 0 && (
        <div className="callout warn">
          {result.warnings.map((w) => <div key={w}>{w}</div>)}
        </div>
      )}

      <div className="card internal-card">
        <button className="link h2" onClick={() => setShowInternal(!showInternal)}>
          {showInternal ? '▾' : '▸'} Internal only
        </button>
        {showInternal && (
          <>
            <div className="kpis small">
              <Kpi label="Expected margin" value={fmtPct(i.expectedMargin)} warn={i.expectedMargin < 0.4} />
              <Kpi label="Views we expect (P50)" value={fmtInt(i.viewsExpected)} />
              <Kpi label="Upside (P75)" value={fmtInt(i.viewsUpside)} />
              <Kpi label="Creator money % of budget" value={fmtPct(i.creatorMoneyShare)} hint={`Historical median ${fmtPct(i.historicalCreatorMoneyShare, 0)}`} />
            </div>
            <dl className="costs">
              <dt>Creator money</dt><dd>{fmtMoney(i.creatorMoney, cur)}</dd>
              <dt>Allocated to creators</dt><dd>{fmtMoney(i.creatorMoneyAllocated, cur)}</dd>
              <dt>Negotiation buffer</dt><dd>{fmtMoney(i.buffer, cur)}</dd>
              <dt>Boosting / paid media / gifting / other</dt>
              <dd>
                {fmtMoney(i.costs.boosting, cur)} / {fmtMoney(i.costs.paidMedia, cur)} / {fmtMoney(i.costs.gifting, cur)} / {fmtMoney(i.costs.other, cur)}
              </dd>
              <dt>Total delivery cost</dt><dd>{fmtMoney(i.costs.total, cur)}</dd>
            </dl>
            <label className="agreed">
              Agreed price (if different)
              <input type="number" min="0" value={agreedPrice ?? ''} onChange={(e) => onAgreedPrice(e.target.value)} placeholder={String(c.price)} />
              {i.realMargin != null && <span className={i.realMargin < 0.4 ? 'bad' : 'good'}>Real margin {fmtPct(i.realMargin)}</span>}
            </label>

            <h3>Campaign team brief</h3>
            <table className="table">
              <thead>
                <tr><th>Creators</th><th>Size</th><th>Target views / video</th><th>Videos</th><th>First offer / video</th><th>Max fee / video</th></tr>
              </thead>
              <tbody>
                {i.brief.map((b) => (
                  <tr key={b.creators}>
                    <td>{b.creators}</td><td>{b.size}</td><td>{fmtInt(b.targetViewsPerVideo)}</td><td>{b.videos}</td>
                    <td>{fmtMoney(b.firstOfferPerVideo, cur)}</td><td>{fmtMoney(b.maxFeePerVideo, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="muted small">
              Total creator money {fmtMoney(i.creatorMoney, cur)}. Two smaller creators may replace one larger one if their combined expected views and fees are equal or better.
            </div>

            <h3>Rates used</h3>
            <table className="table small">
              <thead>
                <tr><th>Size</th><th>Confidence</th><th>From</th><th>Records</th><th>P50 / P65 cost per video</th><th>Views P25 / P50 / P75</th></tr>
              </thead>
              <tbody>
                {i.sizes.map((s) => (
                  <tr key={s.size} className={s.used ? 'used' : ''}>
                    <td>{s.label}</td>
                    <td><span className={`chip small ${s.confidence.toLowerCase()}`}>{s.confidence}</span></td>
                    <td>{s.level}</td>
                    <td>{s.records}</td>
                    <td>{fmtMoney(s.costP50, cur)} / {fmtMoney(s.costP65, cur)}{s.factor !== 1 ? ` ×${s.factor}` : ''}</td>
                    <td>{fmtInt(s.viewsP25)} / {fmtInt(s.viewsP50)} / {fmtInt(s.viewsP75)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </>
  );
}

function Kpi({ label, value, strong, warn, hint }) {
  return (
    <div className={`kpi ${strong ? 'strong' : ''} ${warn ? 'warn' : ''}`}>
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
    </div>
  );
}
