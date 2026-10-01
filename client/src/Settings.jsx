import React, { useState } from 'react';
import { api, notify } from './api.js';

const pct = (x) => `${Math.round(Number(x) * 1000) / 10}%`;

// Settings a person can change for their own calculation.
export const PERSONAL_FIELDS = [
  ['giftingCostPerCreatorGbp', 'Gifting cost per creator (£)', 'number'],
  ['giftedPostingRate', 'Gifted creators who post (%)', 'percent'],
  ['reachRatio', 'Reach as share of views (%)', 'percent'],
  ['boostingCostPer1000Usd', 'Boosting cost per 1,000 views ($)', 'number'],
  ['firstOfferShare', 'First offer, share of typical fee (%)', 'percent'],
  ['marginWarning', 'Warn when margin is below (%)', 'percent'],
  ['minimumBudgetGbp', 'Warn when budget is below (£)', 'number'],
];

/**
 * Collapsible settings strip at the top of the calculator. Changes apply to
 * this calculation straight away; "Save as default" stores them for everyone.
 */
export function SettingsPanel({ defaults, values, onChange, onDefaultsSaved }) {
  const [open, setOpen] = useState(false);
  const [how, setHow] = useState(false);
  const [busy, setBusy] = useState(false);
  const v = { ...defaults, ...values };
  const changed = Object.keys(values).filter((k) => values[k] !== undefined && values[k] !== defaults[k]);

  const show = (key, type) => (v[key] == null ? '' : type === 'percent' ? Math.round(v[key] * 1000) / 10 : v[key]);
  const set = (key, type) => (e) => {
    const raw = e.target.value;
    onChange({ ...values, [key]: raw === '' ? null : type === 'percent' ? Number(raw) / 100 : Number(raw) });
  };

  const saveDefault = async () => {
    setBusy(true);
    try {
      await api('/settings', { method: 'PUT', body: Object.fromEntries(PERSONAL_FIELDS.map(([k]) => [k, v[k]])) });
      notify('Saved as default for everyone');
      onDefaultsSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`settings-strip ${open ? 'open' : ''}`}>
      <button className="strip-head" onClick={() => setOpen(!open)}>
        <span className="strip-title">Settings</span>
        <span className="strip-summary">
          Reach {pct(v.reachRatio)} · Gifting {v.giftingCostPerCreatorGbp == null ? 'not set' : `£${v.giftingCostPerCreatorGbp}`} · Boosting ${v.boostingCostPer1000Usd}/1k · First offer {pct(v.firstOfferShare)}
          {changed.length > 0 && <em> · {changed.length} changed</em>}
        </span>
        <span className="strip-toggle">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="strip-body">
          <div className="strip-grid">
            {PERSONAL_FIELDS.map(([key, label, type]) => (
              <label className="field" key={key}>
                <span>{label}</span>
                <input className="line" type="number" step="any" value={show(key, type)} onChange={set(key, type)} />
              </label>
            ))}
          </div>
          <div className="strip-actions">
            <button className="text-link" onClick={() => setHow(!how)}>{how ? 'Hide' : 'How it’s calculated'}</button>
            {changed.length > 0 && <button className="ghost" onClick={() => onChange({})}>Reset to defaults</button>}
            <button className="ghost" disabled={busy || !changed.length} onClick={saveDefault}>Save as default for everyone</button>
          </div>
          {how && <HowItWorks v={v} />}
        </div>
      )}
    </div>
  );
}

export function HowItWorks({ v }) {
  return (
    <div className="howto-grid">
      <div className="howto-block">
        <h3>1. What one creator costs us</h3>
        <div className="formula">Creator cost = videos per creator × planning cost per video × multi-video factor</div>
        <dl>
          <dt>Planning cost per video</dt>
          <dd>What we paid per video for that kind of creator (size, platform, market, niche) in past campaigns: the 65th percentile, so 65% of past bookings cost this or less.</dd>
          <dt>Multi-video factor</dt>
          <dd>The discount creators give for several videos, from past bookings. Stays at 1 until there are 10+ bookings to measure it.</dd>
        </dl>
      </div>
      <div className="howto-block">
        <h3>2. Price to quote</h3>
        <div className="formula">Price = (creator costs + boosting + paid media + gifting + brand lift / other) ÷ (1 − margin)</div>
        <p>At a 50% margin, a package that costs us £10,000 is quoted at £20,000.</p>
      </div>
      <div className="howto-block">
        <h3>3. Package from a budget</h3>
        <div className="formula">Creator money = budget × (1 − margin) − boosting − paid media − gifting − brand lift / other</div>
        <p>
          <b>Most views</b> fits the most views into the creator money. <b>Balanced</b> also rewards a mix (+{pct(v.balancedSizeBonus)} per extra size, +{pct(v.balancedCreatorBonus)} per extra creator).
          <b> Most videos</b> fits the most videos, then the most views. What's left is the negotiation buffer.
        </p>
      </div>
      <div className="howto-block">
        <h3>4. What the client sees</h3>
        <dl>
          <dt>Guaranteed views</dt>
          <dd>Beaten in 9 of 10 of 5,000 simulated campaigns, rounded down to 10,000.</dd>
          <dt>Minimum reach</dt>
          <dd>Guaranteed views × {pct(v.reachRatio)}.</dd>
          <dt>Cost per view · eCPM</dt>
          <dd>Price ÷ guaranteed views · same × 1,000.</dd>
          <dt>Boosted views</dt>
          <dd>Boosting budget ÷ ${v.boostingCostPer1000Usd} × 1,000, shown separately.</dd>
        </dl>
      </div>
      <div className="howto-block">
        <h3>5. Internal only</h3>
        <dl>
          <dt>Margin</dt>
          <dd>(price − all delivery costs) ÷ price. Flagged below {pct(v.marginWarning)}.</dd>
          <dt>Creator brief</dt>
          <dd>First offer {pct(v.firstOfferShare)} of the typical fee per video; maximum = planning cost per video.</dd>
          <dt>Gifting</dt>
          <dd>{v.giftingCostPerCreatorGbp == null ? 'Cost not set (counted as £0)' : `£${v.giftingCostPerCreatorGbp} per gifted creator`}; {pct(v.giftedPostingRate)} of them post one video.</dd>
        </dl>
      </div>
    </div>
  );
}
