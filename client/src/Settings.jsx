import React, { useState } from 'react';
import { api, notify } from './api.js';

const pct = (x) => `${Math.round(Number(x) * 1000) / 10}%`;

// Settings a person can change for their own calculation.
// [key, label, type, sub-key for settings that are small tables]
export const PERSONAL_GROUPS = [
  ['General', [
    ['giftingCostPerCreatorGbp', 'Cost per gift (£)', 'number'],
    ['giftedPostingRate', 'Gifted creators who post (%)', 'percent'],
    ['firstOfferShare', 'First offer, share of typical fee (%)', 'percent'],
    ['marginWarning', 'Warn when margin is below (%)', 'percent'],
    ['minimumBudgetGbp', 'Warn when budget is below (£)', 'number'],
    ['guaranteeMinSample', 'Min. records for a guarantee', 'number'],
  ]],
  ['Boosting CPM ($ per 1,000 views)', [
    ['boostingCpmUsd', 'TikTok', 'number', 'TikTok'],
    ['boostingCpmUsd', 'Instagram', 'number', 'Instagram'],
    ['boostingCpmUsd', 'YouTube', 'number', 'YouTube'],
    ['boostingCpmUsd', 'Other', 'number', 'Other'],
    ['paidMediaFee', 'Default paid media fee (%)', 'number'],
  ]],
];
export const PERSONAL_FIELDS = PERSONAL_GROUPS.flatMap(([, f]) => f);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Collapsible settings strip at the top of the calculator. Changes apply to
 * this calculation straight away; "Save as default" stores them for everyone.
 */
export function SettingsPanel({ defaults, values, onChange, onDefaultsSaved }) {
  const [open, setOpen] = useState(false);
  const [how, setHow] = useState(false);
  const [busy, setBusy] = useState(false);
  const v = { ...defaults, ...values };
  const changed = Object.keys(values).filter((k) => values[k] !== undefined && !same(values[k], defaults[k]));

  const read = (key, sub) => (sub ? v[key]?.[sub] : v[key]);
  const show = (key, type, sub) => {
    const x = read(key, sub);
    return x == null ? '' : type === 'percent' ? Math.round(x * 1000) / 10 : x;
  };
  const set = (key, type, sub) => (e) => {
    const raw = e.target.value;
    const val = raw === '' ? null : type === 'percent' ? Number(raw) / 100 : Number(raw);
    onChange({ ...values, [key]: sub ? { ...v[key], [sub]: val } : val });
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
          Gift {v.giftingCostPerCreatorGbp == null ? 'not set' : `£${v.giftingCostPerCreatorGbp}`} · Boosting CPM TikTok ${v.boostingCpmUsd?.TikTok} · Meta ${v.boostingCpmUsd?.Instagram} · Paid media fee {v.paidMediaFee}% · First offer {pct(v.firstOfferShare)}
          {changed.length > 0 && <em> · {changed.length} changed</em>}
        </span>
        <span className="strip-toggle">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="strip-body">
          {PERSONAL_GROUPS.map(([title, fields]) => (
            <div key={title}>
              <div className="strip-group">{title}</div>
              <div className="strip-grid">
                {fields.map(([key, label, type, sub]) => (
                  <label className="field" key={key + (sub || '')}>
                    <span>{label}</span>
                    <input className="line" type="number" step="any" value={show(key, type, sub)} onChange={set(key, type, sub)} />
                  </label>
                ))}
              </div>
            </div>
          ))}
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
        <div className="formula">Creator cost = videos per creator × planning cost per video × multi-video factor × (1 + usage/exclusivity uplift %)</div>
        <dl>
          <dt>Planning cost per video</dt>
          <dd>What we paid per video for that kind of creator (size, platform, market, niche) in past campaigns: the 65th percentile, so 65% of past bookings cost this or less.</dd>
          <dt>Multi-video factor</dt>
          <dd>The discount creators give for several videos, from past bookings. Stays at 1 until there are 10+ bookings to measure it.</dd>
          <dt>Usage / exclusivity uplift</dt>
          <dd>Entered on each proposal when anything beyond organic-only and no exclusivity is chosen. No default.</dd>
        </dl>
      </div>
      <div className="howto-block">
        <h3>2. Price to quote</h3>
        <div className="formula">Standard quote = (creators + gifting + brand-lift / other + boosting with margin) ÷ (1 − margin) + paid media + pass-through boosting + management fees</div>
        <div className="formula">Final quote = standard quote × (1 + commercial adjustment)</div>
        <p>Paid media is passed through at cost plus a management fee; it never gets the campaign margin.</p>
      </div>
      <div className="howto-block">
        <h3>3. Package from a budget</h3>
        <div className="formula">Creator money = (budget − paid media − pass-through boosting − fees) × (1 − margin) − gifting − brand-lift / other − boosting with margin</div>
        <p>
          <b>Most views</b> fits the most views into the creator money. <b>Balanced</b> also rewards a mix (+{pct(v.balancedSizeBonus)} per extra size, +{pct(v.balancedCreatorBonus)} per extra creator).
          <b> Most videos</b> fits the most videos, then the most views. What's left is the negotiation buffer.
        </p>
      </div>
      <div className="howto-block">
        <h3>4. What the client sees</h3>
        <dl>
          <dt>Guaranteed views (P10), overall and by tier</dt>
          <dd>Beaten in 9 of 10 of 5,000 simulated campaigns. Only segments with at least {v.guaranteeMinSample} view records are used; otherwise a broader benchmark.</dd>
          <dt>Cost per guaranteed view</dt>
          <dd>Final quote ÷ guaranteed views.</dd>
          <dt>Effective CPM</dt>
          <dd>Final quote ÷ guaranteed views × 1,000.</dd>
          <dt>Boosted views</dt>
          <dd>Boosting budget ÷ platform CPM × 1,000, shown separately. Or plan backwards: budget = target views ÷ 1,000 × CPM.</dd>
        </dl>
      </div>
      <div className="howto-block">
        <h3>5. Internal only</h3>
        <dl>
          <dt>Expected performance</dt>
          <dd>Low P25 · likely P50 · high P75 of the simulated campaigns.</dd>
          <dt>Service margin (main)</dt>
          <dd>(quote − pass-through spend − service costs) ÷ (quote − pass-through spend). Flagged below {pct(v.marginWarning)}.</dd>
          <dt>Blended margin (secondary)</dt>
          <dd>(quote − all delivery costs incl. media) ÷ quote. Shown, never used for the warning.</dd>
          <dt>Minimum viable package</dt>
          <dd>Fewest creators the requirements allow, of the cheapest allowed type, plus this proposal's add-ons and media.</dd>
          <dt>Creator brief</dt>
          <dd>First offer {pct(v.firstOfferShare)} of the typical (P50) fee; planning allowance P65; above P80 needs approval.</dd>
          <dt>Gifting</dt>
          <dd>{v.giftingCostPerCreatorGbp == null ? 'Cost not set (counted as £0)' : `£${v.giftingCostPerCreatorGbp} per gifted creator`}; {pct(v.giftedPostingRate)} of them post one video.</dd>
        </dl>
      </div>
    </div>
  );
}
