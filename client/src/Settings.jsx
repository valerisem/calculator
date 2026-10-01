import React, { useEffect, useState } from 'react';
import { api, notify } from './api.js';
import { fmtMoney } from './format.js';

const pct = (x) => `${Math.round(Number(x) * 1000) / 10}%`;

// Settings a person can change for their own calculation.
// [key, label, type, sub-key for settings that are small tables]
export const PERSONAL_GROUPS = [
  ['General', [
    ['giftedPostingRate', 'Default gifted creator posting rate (%)', 'percent'],
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
export function SettingsPanel({ meta, inputs, defaults, values, onChange, onDefaultsSaved, onRatesSaved }) {
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
          Gifted posting {pct(v.giftedPostingRate)} · Boosting CPM TikTok ${v.boostingCpmUsd?.TikTok} · Meta ${v.boostingCpmUsd?.Instagram} · Paid media fee {v.paidMediaFee}% · First offer {pct(v.firstOfferShare)}
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
          <RateCard meta={meta} inputs={inputs} onSaved={onRatesSaved} />
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

/**
 * Creator rate card: the cost per video the team sets for each creator size,
 * per market and platform, for everyone. It is the only creator cost the
 * calculator uses. A historical typical cost shows next to it as guidance only,
 * where there is reliable data.
 */
function RateCard({ meta, inputs, onSaved }) {
  const [q, setQ] = useState({
    market: inputs?.markets?.[0] || meta.markets[0]?.name || 'UK',
    platform: inputs?.platforms?.[0] || 'TikTok',
  });
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const load = () => api(`/rates/card?${new URLSearchParams(q)}`).then((d) => { setData(d); setDraft({}); }).catch(() => setData(null));
  useEffect(() => { load(); }, [q.market, q.platform]);

  const save = async (r) => {
    if (!(r.size in draft)) return;
    const raw = draft[r.size];
    const val = raw === '' ? null : Number(raw);
    if (val === r.costPerVideo) return setDraft({});
    await api('/rates/card', { method: 'PUT', body: { ...q, size: r.size, rate: val } });
    await load();
    onSaved?.();
  };
  const sel = (k) => (e) => setQ({ ...q, [k]: e.target.value });

  return (
    <div className="rate-card-box">
      <div className="rate-head">
        <div className="strip-group">Creator rate card</div>
        <div className="rate-filters">
          <select className="line" value={q.market} onChange={sel('market')}>{meta.markets.map((m) => <option key={m.name}>{m.name}</option>)}</select>
          <select className="line" value={q.platform} onChange={sel('platform')}>{meta.platforms.map((p) => <option key={p}>{p}</option>)}</select>
        </div>
      </div>
      {data && (
        <table className="table rate-card">
          <thead><tr><th>Creator size</th><th>Cost per video</th><th></th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.size}>
                <td>{r.label}</td>
                <td>
                  <span className="rate-input">
                    <span className="cur">£</span>
                    <input
                      className={`line ${r.costPerVideo == null ? 'est' : ''}`}
                      type="number" min="0" step="any" placeholder={r.estimate != null ? String(r.estimate) : 'Enter'}
                      value={r.size in draft ? draft[r.size] : r.costPerVideo ?? ''}
                      onChange={(e) => setDraft({ ...draft, [r.size]: e.target.value })}
                      onBlur={() => save(r)}
                      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    />
                  </span>
                </td>
                <td className="muted small">
                  {r.estimate != null ? <><span className="est-tag">Estimated</span> {r.estimateBasis === 'history' ? 'from history' : r.estimateBasis === 'interpolated' ? 'between priced sizes' : 'from size curve'}</> : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function HowItWorks({ v }) {
  return (
    <div className="howto-grid">
      <div className="howto-block">
        <h3>1. What one creator costs us</h3>
        <div className="formula">Planned creator cost = creators × videos per creator × cost per video × (1 + usage/exclusivity uplift %)</div>
        <dl>
          <dt>Cost per video</dt>
          <dd>In order: this proposal's override, the rate card, then an automatic estimate (labelled Estimated): the typical historical cost for that market, platform and size; otherwise in proportion between the nearest priced sizes; otherwise the overall size-to-size price curve scaled to this market and platform. Every size always has a cost and can be overridden.</dd>
          <dt>Usage / exclusivity uplift</dt>
          <dd>Entered on each proposal when anything beyond organic-only and no exclusivity is chosen. No default.</dd>
        </dl>
      </div>
      <div className="howto-block">
        <h3>2. Price to quote</h3>
        <div className="formula">Standard quote = (creators + gifting without a client charge + brand-lift / other + boosting with margin) ÷ (1 − margin) + paid media + pass-through boosting + management fees + client gifting charge</div>
        <div className="formula">Final quote = standard quote × (1 + commercial adjustment)</div>
        <p>Paid media is passed through at cost plus a management fee; it never gets the campaign margin.</p>
      </div>
      <div className="howto-block">
        <h3>3. Package from a budget</h3>
        <div className="formula">Creator money = (budget − paid media − pass-through boosting − fees − client gifting charge) × (1 − margin) − gifting without a client charge − brand-lift / other − boosting with margin</div>
        <p>
          <b>Most views</b> picks the package with the highest guaranteed (P10) views, and is never below the other two. <b>Balanced</b> also rewards a mix (+{pct(v.balancedSizeBonus)} per extra size, +{pct(v.balancedCreatorBonus)} per extra creator).
          <b> Most videos</b> fits the most videos, then the most views. What's left is the negotiation buffer.
        </p>
      </div>
      <div className="howto-block">
        <h3>4. What the client sees</h3>
        <dl>
          <dt>Guaranteed views (P10), overall and by tier</dt>
          <dd>Beaten in 9 of 10 of 5,000 simulated campaigns. Each simulated campaign re-draws the historical views per video and draws every creator from them, so no video beats views actually observed, and a thin history keeps the guarantee cautious. Data counts as reliable with at least {v.guaranteeMinSample} observations from at least 3 campaigns; otherwise a broader benchmark is used.</dd>
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
          <dd>First offer {pct(v.firstOfferShare)} of the cost per video; the cost per video is the most to pay without approval.</dd>
          <dt>Gifting</dt>
          <dd>Set per proposal: creators × (product + shipping) is a delivery cost. Without a client gifting charge it carries the campaign margin; with one, the charge is added to the quote. By default {pct(v.giftedPostingRate)} of gifted creators post one video.</dd>
        </dl>
      </div>
    </div>
  );
}
