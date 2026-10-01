import React from 'react';
import { fmtInt, fmtMoney, fmtPct } from './format.js';

// One package option on the right-hand side. view = 'client' | 'internal'.
export default function PackageCard({ title, priceLabel, result, selected, onSelect, view, onUseMix, badge, empty, accent: accentOn = true }) {
  if (!result) {
    return (
      <div className="pkg-card empty">
        <div className="pkg-head">
          <span className="radio" />
          <h3>{title}</h3>
        </div>
        <p className="muted small">{empty}</p>
      </div>
    );
  }
  if (!result.ok) {
    return (
      <div className="pkg-card empty">
        <div className="pkg-head">
          <span className="radio" />
          <h3>{title}</h3>
        </div>
        <p className="error-text small">{result.error}</p>
      </div>
    );
  }
  const c = result.client;
  const i = result.internal;
  const cur = result.currency;
  const accent = accentOn ? 'accent' : '';
  const several = (result.inputs?.platforms?.length || 1) > 1 || (result.inputs?.markets?.length || 1) > 1;
  const mix = c.creators.map((cr) => `${cr.count} ${cr.label}${several ? ` ${cr.platform} ${cr.market}` : ''}`).join(' · ');

  return (
    <div
      className={`pkg-card ${selected ? 'selected' : ''}`}
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect?.()}
    >
      <div className="pkg-head">
        <span className={`radio ${selected ? 'on' : ''}`} />
        <h3>{title}</h3>
        {badge && <span className="badge">{badge}</span>}
      </div>

      {view === 'client' ? (
        <>
          <div className="metrics">
            <Metric label="Views we promise" value={fmtInt(c.viewsPromised)} big className={accent} />
            <Metric label={`${priceLabel}, ${cur}`} value={fmtInt(c.price)} />
            <Metric label="Per 1,000 views" value={fmtMoney(c.cpm, cur, 2)} className={accent} />
          </div>
          <div className="rule" />
          <div className="metrics">
            <Metric label="Creators" value={fmtInt(c.totalCreators + c.giftedCreators)} className={accent} />
            <Metric label="Videos" value={fmtInt(c.totalVideos)} className={accent} />
            <Metric label="Reach" value={fmtInt(c.reachPromised)} className={accent} />
          </div>
          {c.boostedViews > 0 && <div className="muted small">+ {fmtInt(c.boostedViews)} boosted views (separate from the promise)</div>}
        </>
      ) : (
        <>
          <div className="metrics">
            <Metric label="Expected margin" value={fmtPct(i.realMargin ?? i.expectedMargin)} big className={(i.realMargin ?? i.expectedMargin) < 0.4 ? 'bad' : accent} />
            <Metric label={`Creator money, ${cur}`} value={fmtInt(i.creatorMoney)} />
            <Metric label="Buffer" value={fmtMoney(i.buffer, cur)} className={accent} />
          </div>
          <div className="rule" />
          <div className="metrics">
            <Metric label="Views we expect" value={fmtInt(i.viewsExpected)} className={accent} />
            <Metric label="Upside" value={fmtInt(i.viewsUpside)} className={accent} />
            <Metric label="Creator money %" value={fmtPct(i.creatorMoneyShare)} hint={`median ${fmtPct(i.historicalCreatorMoneyShare, 0)}`} />
          </div>
        </>
      )}

      <div className="pkg-foot">
        <span className="muted small mix">{mix}{c.giftedCreators ? ` · ${c.giftedCreators} gifted` : ''}</span>
        {onUseMix && (
          <button className="text-link" onClick={(e) => { e.stopPropagation(); onUseMix(); }}>
            Use this mix
          </button>
        )}
      </div>
      {result.warnings?.length > 0 && (
        <ul className="warnings">
          {result.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
    </div>
  );
}

function Metric({ label, value, big, className = '', hint }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${big ? 'big' : ''} ${className}`}>{value}</div>
      {hint && <div className="metric-hint">{hint}</div>}
    </div>
  );
}

// Internal detail for the selected package: brief and the rates behind it.
export function PackageDetails({ result }) {
  if (!result?.ok) return null;
  const i = result.internal;
  const cur = result.currency;
  return (
    <div className="details">
      <h4>Campaign team brief</h4>
      <table className="table">
        <thead>
          <tr><th>Creators</th><th>Size</th><th>Views / video</th><th>Videos</th><th>First offer</th><th>Max fee</th></tr>
        </thead>
        <tbody>
          {i.brief.map((b) => (
            <tr key={b.creators}>
              <td>{b.creators}</td><td>{b.size}<div className="muted">{b.platform} · {b.market}</div></td><td>{fmtInt(b.targetViewsPerVideo)}</td><td>{b.videos}</td>
              <td>{fmtMoney(b.firstOfferPerVideo, cur)}</td><td>{fmtMoney(b.maxFeePerVideo, cur)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        Fees are per video. Total creator money {fmtMoney(i.creatorMoney, cur)}; allocated {fmtMoney(i.creatorMoneyAllocated, cur)}.
        Two smaller creators may replace one larger one if their combined expected views and fees are equal or better.
      </p>
      <h4>Rates used</h4>
      <table className="table">
        <thead>
          <tr><th>Size</th><th>Confidence</th><th>From</th><th>Cost / video P50 · P65</th><th>Views P25 · P50 · P75</th></tr>
        </thead>
        <tbody>
          {i.sizes.filter((s) => s.used).map((s) => (
            <tr key={s.key}>
              <td>{s.label}<div className="muted">{s.platform} · {s.market}</div></td>
              <td><span className={`conf ${s.confidence.toLowerCase()}`}>{s.confidence}</span> <span className="muted">{s.records}</span></td>
              <td className="muted">{s.level}</td>
              <td>{fmtMoney(s.costP50, cur)} · {fmtMoney(s.costP65, cur)}{s.factor !== 1 ? ` ×${s.factor}` : ''}</td>
              <td>{fmtInt(s.viewsP25)} · {fmtInt(s.viewsP50)} · {fmtInt(s.viewsP75)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        Delivery costs: creators {fmtMoney(i.costs.creators, cur)}, boosting {fmtMoney(i.costs.boosting, cur)}, paid media {fmtMoney(i.costs.paidMedia, cur)},
        gifting {fmtMoney(i.costs.gifting, cur)}, other {fmtMoney(i.costs.other, cur)}.
      </p>
    </div>
  );
}
