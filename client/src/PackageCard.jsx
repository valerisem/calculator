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
            <Metric label="Service margin" value={fmtPct(i.expectedMargin)} big className={i.expectedMargin < (i.marginWarning ?? 0.4) ? 'bad' : accent} hint={`blended ${fmtPct(i.blendedMargin)}`} />
            <Metric label={`Standard quote, ${cur}`} value={fmtInt(i.standardPrice)} hint={i.adjusted ? `${i.adjustmentPct > 0 ? '+' : ''}${i.adjustmentPct.toFixed(1)}% → ${fmtInt(i.finalPrice)}` : `service margin ${fmtPct(i.standardMargin)}`} />
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
      <h4>By tier: cost and views</h4>
      <table className="table audit">
        <thead>
          <tr><th>Tier / creator type</th><th>Creators</th><th>Videos</th><th>Cost / video</th><th>Creator cost</th><th>Views / video P25 · P50</th><th>Guaranteed (P10)</th><th>Low · likely · high</th></tr>
        </thead>
        <tbody>
          {(i.tiers || []).map((t) => (
            <React.Fragment key={t.tier}>
              <tr className="tier-row">
                <td><b>{t.tier}</b></td><td>{fmtInt(t.creators)}</td><td>{fmtInt(t.videos)}</td><td></td>
                <td>{t.creatorCost != null ? fmtMoney(t.creatorCost, cur) : t.tier === 'Gifted' ? fmtMoney(i.costs.gifting, cur) : ''}</td><td></td>
                <td><b>{fmtInt(t.guaranteedViews)}</b></td><td className="muted">{fmtInt(t.low)} · {fmtInt(t.likely)} · {fmtInt(t.high)}</td>
              </tr>
              {(t.lines || []).map((l) => (
                <tr key={l.key} className="line-row">
                  <td>{l.label}<div className="muted">{l.platform} · {l.market}</div></td>
                  <td>{fmtInt(l.creators)}</td><td>{fmtInt(l.videos)}</td>
                  <td>
                    {fmtMoney(l.costPerVideo, cur)}
                    <div className="muted">
                      {l.rateSource === 'historical' ? `historical P65${l.multiVideoFactor !== 1 ? ` × ${l.multiVideoFactor} multi-video` : ''}` : `${l.rateSource} (historical ${fmtMoney(l.historicalPerVideo, cur)})`}
                    </div>
                  </td>
                  <td>{fmtMoney(l.creatorCost, cur)}</td>
                  <td>{fmtInt(l.viewsPerVideoP25)} · {fmtInt(l.viewsPerVideoP50)}</td>
                  <td></td>
                  <td className="muted small">{l.costRecords} bookings{l.campaigns != null ? ` / ${l.campaigns} campaigns` : ''} · {l.costLevel}</td>
                </tr>
              ))}
            </React.Fragment>
          ))}
          <tr>
            <td><b>Total</b></td><td>{fmtInt(result.client.totalCreators + result.client.giftedCreators)}</td><td>{fmtInt(result.client.totalVideos)}</td><td></td>
            <td><b>{fmtMoney(i.costs.creators, cur)}</b></td><td></td>
            <td><b>{fmtInt(result.client.viewsPromised)}</b></td><td className="muted">{fmtInt(i.viewsLow)} · {fmtInt(i.viewsExpected)} · {fmtInt(i.viewsUpside)}</td>
          </tr>
        </tbody>
      </table>
      <p className="muted small">Each tier's guarantee is its own P10, so the tiers add up to less than the overall guarantee.</p>

      <h4>Costs</h4>
      <dl className="cost-list">
        <dt>Creators{i.usageUplift ? ` (incl. +${fmtPct(i.usageUplift, 0)} usage/exclusivity)` : ''}</dt><dd>{fmtMoney(i.costs.creators, cur)}</dd>
        <dt>Gifting{i.gifting ? ` (${fmtInt(i.gifting.creators)} creators, ~${fmtInt(i.gifting.posts)} posts)` : ''}</dt><dd>{fmtMoney(i.costs.gifting, cur)}</dd>
        {i.gifting?.clientCharge != null && (<><dt>Client gifting charge (revenue)</dt><dd>{fmtMoney(i.gifting.clientCharge, cur)}</dd></>)}
        <dt>Brand-lift study / other</dt><dd>{fmtMoney(i.costs.other, cur)}</dd>
        <dt>Boosting with campaign margin</dt><dd>{fmtMoney(i.costs.boostingWithMargin, cur)}</dd>
        <dt>Boosting pass-through</dt><dd>{fmtMoney(i.costs.boostingPassThrough, cur)}</dd>
        <dt>Paid media (pass-through)</dt><dd>{fmtMoney(i.costs.paidMedia, cur)}</dd>
        <dt>Management fees (revenue)</dt><dd>{fmtMoney(i.costs.fees, cur)}</dd>
        <dt><b>Total delivery cost</b></dt><dd><b>{fmtMoney(i.costs.total, cur)}</b></dd>
        <dt>Service margin · blended margin</dt><dd>{fmtPct(i.expectedMargin)} · {fmtPct(i.blendedMargin)}</dd>
        {i.minimumViablePrice != null && (<><dt>Minimum viable package ({i.minimumViableCreators} creator{i.minimumViableCreators === 1 ? '' : 's'})</dt><dd>{fmtMoney(i.minimumViablePrice, cur)}</dd></>)}
      </dl>

      <h4>Campaign team brief</h4>
      <table className="table">
        <thead>
          <tr><th>Creators</th><th>Size</th><th>Views / video</th><th>Videos</th><th>First offer</th><th>Planning (P65)</th><th>Approval above (P80)</th></tr>
        </thead>
        <tbody>
          {i.brief.map((b) => (
            <tr key={b.creators}>
              <td>{b.creators}</td><td>{b.size}<div className="muted">{b.platform} · {b.market}</div></td><td>{fmtInt(b.targetViewsPerVideo)}</td><td>{b.videos}</td>
              <td>{fmtMoney(b.firstOfferPerVideo, cur)}</td><td>{fmtMoney(b.planningAllowancePerVideo ?? b.maxFeePerVideo, cur)}</td><td>{b.approvalThresholdPerVideo == null ? '–' : fmtMoney(b.approvalThresholdPerVideo, cur)}</td>
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
          <tr><th>Size</th><th>Cost data</th><th>Views data</th><th>Cost / video P50 · planning</th><th>Views P25 · P50 · P75</th></tr>
        </thead>
        <tbody>
          {i.sizes.filter((s) => s.used).map((s) => (
            <tr key={s.key}>
              <td>{s.label}<div className="muted">{s.platform} · {s.market}</div></td>
              <td><span className={`conf ${s.confidence.toLowerCase()}`}>{s.confidence}</span> <span className="muted">{s.records} creators{s.campaigns != null ? ` / ${s.campaigns} campaigns` : ''} · {s.level}</span></td>
              <td className="muted">n={s.viewsRecords} · {s.viewsLevel}</td>
              <td>{fmtMoney(s.costP50, cur)} · {fmtMoney(s.costP65, cur)}</td>
              <td>{fmtInt(s.viewsP25)} · {fmtInt(s.viewsP50)} · {fmtInt(s.viewsP75)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
