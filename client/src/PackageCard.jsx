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
            <Metric label="Guaranteed views" value={fmtInt(c.viewsPromised)} big className={accent} />
            <Metric label={`${priceLabel}, ${cur}`} value={fmtInt(c.price)} />
            <Metric label="Effective CPM" value={fmtMoney(c.cpm, cur, 2)} className={accent} />
          </div>
          <div className="rule" />
          <div className="metrics">
            <Metric label="Creators" value={fmtInt(c.totalCreators + c.giftedCreators)} className={accent} />
            <Metric label="Videos" value={fmtInt(c.totalVideos)} className={accent} />
            <Metric label="Cost per guaranteed view" value={fmtMoney(c.cpv, cur, 3)} className={accent} />
          </div>
          {c.tierGuarantees?.length > 0 && (
            <div className="tiers">
              {c.tierGuarantees.map((t) => (
                <span key={t.tier}><b>{t.tier}</b> {fmtInt(t.creators)} creators · {fmtInt(t.guaranteedViews)} guaranteed</span>
              ))}
            </div>
          )}
          {c.boostedViews > 0 && <div className="muted small">+ {fmtInt(c.boostedViews)} boosted views (separate from the guarantee)</div>}
        </>
      ) : (
        <>
          <div className="metrics">
            <Metric label="Effective margin" value={fmtPct(i.expectedMargin)} big className={i.expectedMargin < (result.marginWarning ?? 0.4) ? 'bad' : accent} />
            <Metric label={`Standard quote, ${cur}`} value={fmtInt(i.standardPrice)} hint={i.adjusted ? `${i.adjustmentPct > 0 ? '+' : ''}${i.adjustmentPct.toFixed(1)}% → ${fmtInt(i.finalPrice)}` : `margin ${fmtPct(i.standardMargin)}`} />
            <Metric label="Buffer" value={fmtMoney(i.buffer, cur)} className={accent} />
          </div>
          <div className="rule" />
          <div className="metrics">
            <Metric label="Low (P25)" value={fmtInt(i.viewsLow)} className={accent} />
            <Metric label="Likely (P50)" value={fmtInt(i.viewsExpected)} className={accent} />
            <Metric label="High (P75)" value={fmtInt(i.viewsUpside)} className={accent} />
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
      <h4>Views by tier</h4>
      <table className="table">
        <thead>
          <tr><th>Tier</th><th>Creators</th><th>Videos</th><th>Guaranteed (P10)</th><th>Low</th><th>Likely</th><th>High</th></tr>
        </thead>
        <tbody>
          {(i.tiers || []).map((t) => (
            <tr key={t.tier}>
              <td>{t.tier}</td><td>{fmtInt(t.creators)}</td><td>{fmtInt(t.videos)}</td><td><b>{fmtInt(t.guaranteedViews)}</b></td>
              <td>{fmtInt(t.low)}</td><td>{fmtInt(t.likely)}</td><td>{fmtInt(t.high)}</td>
            </tr>
          ))}
          <tr>
            <td><b>Total</b></td><td>{fmtInt(result.client.totalCreators + result.client.giftedCreators)}</td><td>{fmtInt(result.client.totalVideos)}</td>
            <td><b>{fmtInt(result.client.viewsPromised)}</b></td><td>{fmtInt(i.viewsLow)}</td><td>{fmtInt(i.viewsExpected)}</td><td>{fmtInt(i.viewsUpside)}</td>
          </tr>
        </tbody>
      </table>
      <p className="muted small">Each tier's guarantee is its own P10, so the tiers add up to less than the overall guarantee.</p>

      <h4>Costs</h4>
      <dl className="cost-list">
        <dt>Creators{i.usageUplift ? ` (incl. +${fmtPct(i.usageUplift, 0)} usage/exclusivity)` : ''}</dt><dd>{fmtMoney(i.costs.creators, cur)}</dd>
        <dt>Gifting</dt><dd>{fmtMoney(i.costs.gifting, cur)}</dd>
        <dt>Brand-lift study / other</dt><dd>{fmtMoney(i.costs.other, cur)}</dd>
        <dt>Boosting with campaign margin</dt><dd>{fmtMoney(i.costs.boostingWithMargin, cur)}</dd>
        <dt>Boosting pass-through</dt><dd>{fmtMoney(i.costs.boostingPassThrough, cur)}</dd>
        <dt>Paid media (pass-through)</dt><dd>{fmtMoney(i.costs.paidMedia, cur)}</dd>
        <dt>Management fees (revenue)</dt><dd>{fmtMoney(i.costs.fees, cur)}</dd>
        <dt><b>Total delivery cost</b></dt><dd><b>{fmtMoney(i.costs.total, cur)}</b></dd>
      </dl>

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
        Fees are per video. Creator money {fmtMoney(i.creatorMoney, cur)}; allocated {fmtMoney(i.creatorMoneyAllocated, cur)}.
      </p>
      <h4>Rates used</h4>
      <table className="table">
        <thead>
          <tr><th>Size</th><th>Cost data</th><th>Views data</th><th>Cost / video P50 · P65</th><th>Views P25 · P50 · P75</th></tr>
        </thead>
        <tbody>
          {i.sizes.filter((s) => s.used).map((s) => (
            <tr key={s.key}>
              <td>{s.label}<div className="muted">{s.platform} · {s.market}</div></td>
              <td><span className={`conf ${s.confidence.toLowerCase()}`}>{s.confidence}</span> <span className="muted">n={s.records} · {s.level}</span></td>
              <td className="muted">n={s.viewsRecords} · {s.viewsLevel}</td>
              <td>{fmtMoney(s.costP50, cur)} · {fmtMoney(s.costP65, cur)}{s.factor !== 1 ? ` ×${s.factor}` : ''}</td>
              <td>{fmtInt(s.viewsP25)} · {fmtInt(s.viewsP50)} · {fmtInt(s.viewsP75)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
